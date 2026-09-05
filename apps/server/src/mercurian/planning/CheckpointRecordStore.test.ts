import { assert, it } from "@effect/vitest";
import { MercurianCommitId, MessageId, PlanId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { CheckpointRecordStore, layer, make } from "./CheckpointRecordStore.ts";
import {
  seed,
  streaming,
  planId,
  threadId,
  turnId,
  query,
  start,
  sessionSet,
  interrupted,
  captured,
  appendResponse,
  appendInterruptedResponse,
  addQuery,
} from "./CheckpointRecordTestUtils.ts";

const database = NodeSqliteClient.layerMemory();
const testLayer = layer.pipe(Layer.provideMerge(database));

for (const state of ["completed", "interrupted"] as const)
  for (const attached of [true, false])
    it.effect(
      `preserves ${state} response ${attached ? "attachment" : "append repair"} before replayed start and session`,
      () =>
        Effect.gen(function* () {
          yield* seed;
          const store = yield* CheckpointRecordStore;
          yield* store.recordQuery(query, threadId);
          yield* state === "interrupted" ? appendInterruptedResponse : appendResponse;
          if (attached) yield* store.response(query);

          yield* store.consume(start());
          const before = yield* store.get(planId, query);
          assert.strictEqual(before?.request?.state, state);
          assert.strictEqual(before?.responseCommitId, "response");
          assert.strictEqual(before?.request?.turnId, undefined);

          yield* store.consume(sessionSet(), MessageId.make(query));
          const after = yield* store.get(planId, query);
          assert.strictEqual(after?.request?.state, state);
          assert.strictEqual(after?.request?.turnId, turnId);
          assert.strictEqual(after?.request?.messageId, MessageId.make(query));
          assert.strictEqual(after?.responseCommitId, "response");
        }).pipe(Effect.provide(testLayer)),
    );

for (const state of ["unanswered", "preparing", "unknown"] as const)
  it.effect(`binds the exact provider turn and submits a ${state} request`, () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      yield* store.recordQuery(query, threadId);
      if (state === "preparing") yield* store.consume(start());
      if (state === "unknown") yield* store.recoverRequest(query, undefined, false);
      yield* store.consume(sessionSet(), MessageId.make(query));
      const record = yield* store.get(planId, query);
      assert.strictEqual(record?.request?.state, "submitted");
      assert.strictEqual(record?.request?.turnId, turnId);
    }).pipe(Effect.provide(testLayer)),
  );

for (const state of ["cancelled", "failed"] as const)
  it.effect(`preserves a ${state} request while binding a replayed exact provider turn`, () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      yield* store.consume(start());
      yield* store.consume(
        state === "cancelled"
          ? interrupted()
          : sessionSet(2, { status: "error", activeTurnId: null, lastError: "failed" }),
      );
      assert.strictEqual((yield* store.get(planId, query))?.request?.state, state);
      yield* store.consume(sessionSet(3), MessageId.make(query));
      const record = yield* store.get(planId, query);
      assert.strictEqual(record?.request?.state, state);
      assert.strictEqual(record?.request?.turnId, turnId);
    }).pipe(Effect.provide(testLayer)),
  );

it.effect(
  "records a raw send as unanswered, accepts by exact query, and settles unsent cancellation",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      yield* store.recordQuery(query, threadId);
      assert.strictEqual((yield* store.get(planId, query))?.request?.state, "unanswered");
      yield* store.consume(start());
      assert.strictEqual((yield* store.get(planId, query))?.request?.state, "preparing");
      yield* store.consume(interrupted());
      const cancelled = yield* store.get(planId, query);
      assert.strictEqual(cancelled?.request?.state, "cancelled");
      assert.strictEqual(cancelled?.request?.turnId, undefined);
      assert.strictEqual(cancelled?.capture, undefined);
      assert.strictEqual(yield* store.eventCursor, 2);
    }).pipe(Effect.provide(testLayer)),
);

for (const responseFirst of [true, false])
  it.effect(
    `keeps one query owner with ${responseFirst ? "response" : "capture"} first and repairs an append crash`,
    () =>
      Effect.gen(function* () {
        yield* seed;
        const store = yield* CheckpointRecordStore;
        yield* store.consume(start());
        if (responseFirst) yield* appendResponse;
        yield* store.consume(captured());
        if (!responseFirst) yield* appendResponse;
        yield* Effect.gen(function* () {
          const reopened = yield* CheckpointRecordStore;
          yield* reopened.repair;
          const record = yield* reopened.get(planId, query);
          assert.strictEqual(record?.responseCommitId, "response");
          assert.strictEqual(record?.request?.turnId, turnId);
          assert.strictEqual(record?.capture?.repositories?.[0]?.afterSnapshotOid, "after");
          const revision = record?.revision;
          yield* reopened.consume(captured());
          yield* reopened.repair;
          assert.strictEqual((yield* reopened.get(planId, query))?.revision, revision);
          assert.strictEqual((yield* reopened.snapshot(planId)).checkpoints.length, 1);
        }).pipe(Effect.provide(Layer.fresh(layer)));
      }).pipe(Effect.provide(testLayer)),
  );

it.effect(
  "retains unresolved legacy capture, resolves only exact correlation, and survives restart",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      yield* store.recordQuery(query, threadId);
      const event = captured();
      if (event.type !== "thread.turn-diff-completed") return;
      const { requestMessageId: _, ...payload } = event.payload;
      yield* store.consume({ ...event, payload });
      assert.strictEqual((yield* store.get(planId, query))?.capture, undefined);
      yield* Effect.gen(function* () {
        const reopened = yield* CheckpointRecordStore;
        assert.strictEqual((yield* reopened.unresolved).length, 1);
        yield* reopened.resolve(threadId, turnId, MessageId.make(query));
        assert.strictEqual((yield* reopened.get(planId, query))?.capture?.status, "ready");
        assert.strictEqual((yield* reopened.unresolved).length, 0);
      }).pipe(Effect.provide(Layer.fresh(layer)));
    }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "preserves successful repositories and partial facts against weaker late placeholders",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      yield* store.consume(
        captured(1, {
          partial: true,
          snapshotKind: "partial",
          status: "error",
          repositories: [
            {
              repositoryId: "good",
              repositoryName: "Good",
              afterSnapshotOid: "snapshot",
              branchTipOid: "tip",
              captureStatus: "ready",
              summaryStatus: "ready",
              files: [{ path: "a", kind: "added", additions: 1, deletions: 0 }],
            },
            {
              repositoryId: "bad",
              repositoryName: "Bad",
              captureStatus: "error",
              captureError: "failed",
              summaryStatus: "unavailable",
              files: [],
            },
          ],
        }),
      );
      const before = yield* store.get(planId, query);
      yield* store.consume(
        captured(2, {
          captureTerminal: false,
          status: "missing",
          repositories: [],
          partial: false,
        }),
      );
      const after = yield* store.get(planId, query);
      assert.deepStrictEqual(after?.capture, before?.capture);
      assert.strictEqual(after?.capture?.repositories?.[0]?.files.length, 1);
      assert.strictEqual(after?.capture?.partial, true);
      assert.strictEqual(after?.request?.state, "interrupted");
      assert.strictEqual(after?.request?.turnId, turnId);
    }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "supports standalone acts without turns, scopes lookup, and rolls back event cursor on conflicts",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      yield* addQuery("merge");
      const merge = MercurianCommitId.make("merge");
      const record = yield* store.attach({
        ownerCommitId: merge,
        lineRootCommitId: query,
        capture: { status: "ready", terminal: true, files: [], repositories: [] },
      });
      assert.strictEqual(record?.request, undefined);
      assert.strictEqual(yield* store.get(PlanId.make("other-plan"), merge), null);
      yield* store.consume(captured(1));
      yield* addQuery("other-query");
      const conflict = yield* Effect.result(
        store.consume(captured(2, { requestMessageId: MessageId.make("other-query") })),
      );
      assert.strictEqual(conflict._tag, "Failure");
      assert.strictEqual(yield* store.eventCursor, 1);
      assert.strictEqual((yield* store.getByTurn(threadId, turnId))?.ownerCommitId, query);
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual((yield* sql`SELECT * FROM checkpoint_records`).length, 2);
    }).pipe(Effect.provide(testLayer)),
);

it.effect("replays a self-contained terminal failure after runtime/projection cleanup", () =>
  Effect.gen(function* () {
    yield* seed;
    const store = yield* CheckpointRecordStore;
    yield* store.consume(
      captured(1, {
        status: "error",
        summaryStatus: "unavailable",
        repositories: [],
        summaryError: "workspace unavailable",
      }),
    );
    const record = yield* store.get(planId, query);
    assert.strictEqual(record?.capture?.terminal, true);
    assert.strictEqual(record?.capture?.status, "error");
    assert.strictEqual((yield* store.getByTurn(threadId, turnId))?.ownerCommitId, query);
  }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "does not create records or unresolved captures for unrelated orchestration threads",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      yield* store.consume(
        captured(1, { requestMessageId: MessageId.make("not-a-mercurian-query") }),
      );
      assert.deepStrictEqual((yield* store.snapshot(planId)).checkpoints, []);
      assert.deepStrictEqual(yield* store.unresolved, []);
    }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "ends abandoned preparation on restart without fabricating capture or a provider turn",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      yield* store.consume(start());
      yield* store.recoverRequest(query, undefined, false);
      const unknown = yield* store.get(planId, query);
      assert.strictEqual(unknown?.request?.state, "unknown");
      assert.strictEqual(unknown?.request?.turnId, undefined);
      assert.strictEqual(unknown?.capture, undefined);
      yield* store.consume(
        captured(2, { partial: true, snapshotKind: "partial", status: "missing" }),
      );
      const recovered = yield* store.get(planId, query);
      assert.strictEqual(recovered?.request?.state, "interrupted");
      assert.strictEqual(recovered?.capture?.partial, true);
      assert.strictEqual(recovered?.request?.turnId, turnId);
    }).pipe(Effect.provide(testLayer)),
);

it.effect("a late interruption naming an older provider turn cannot cancel a new preparation", () =>
  Effect.gen(function* () {
    yield* seed;
    const store = yield* CheckpointRecordStore;
    yield* store.consume(captured(1));
    yield* addQuery("next-query");
    const nextStart = start(2);
    if (nextStart.type !== "thread.turn-start-requested") return;
    yield* store.consume({
      ...nextStart,
      payload: { ...nextStart.payload, messageId: MessageId.make("next-query") },
    });
    const late = interrupted(3);
    if (late.type !== "thread.turn-interrupt-requested") return;
    yield* store.consume({ ...late, payload: { ...late.payload, turnId } });
    assert.strictEqual(
      (yield* store.get(planId, MercurianCommitId.make("next-query")))?.request?.state,
      "preparing",
    );
    assert.strictEqual((yield* store.get(planId, query))?.capture?.terminal, true);
  }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "ignored streaming events neither enter a SQL transaction nor move the durable cursor",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* CheckpointRecordStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.consume(start());
      const before = yield* sql<{ changes: number }>`SELECT total_changes() AS changes`;
      yield* store.consume(streaming(2));
      assert.deepStrictEqual(yield* sql`SELECT total_changes() AS changes`, before);
      assert.strictEqual(yield* store.eventCursor, 1);
      yield* store.consume(captured(3));
      assert.strictEqual(yield* store.eventCursor, 3);
      assert.strictEqual((yield* store.get(planId, query))?.capture?.terminal, true);
    }).pipe(Effect.provide(testLayer)),
);

it.effect("ignored events do not access SQL at all", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    let accesses = 0;
    const traced = new Proxy(sql, {
      apply(target, thisArg, args) {
        accesses++;
        return Reflect.apply(target, thisArg, args);
      },
      get(target, key, receiver) {
        if (key === "withTransaction") {
          return new Proxy(target.withTransaction, {
            apply(transaction, thisArg, args) {
              accesses++;
              return Reflect.apply(transaction, thisArg, args);
            },
          });
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const store = yield* make.pipe(Effect.provideService(SqlClient.SqlClient, traced));
    accesses = 0;
    yield* store.consume(streaming());
    assert.strictEqual(accesses, 0);
  }).pipe(Effect.provide(database)),
);
