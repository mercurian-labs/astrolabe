import { assert, it } from "@effect/vitest";
import { MercurianCommitId, PlanId, ThreadId, type PlanReconstruction } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../persistence/Migrations.ts";
import { ReconstructionStore, layer } from "./ReconstructionStore.ts";

const database = NodeSqliteClient.layerMemory();
const testLayer = layer.pipe(Layer.provideMerge(database));
const record: PlanReconstruction = {
  id: "reconstruction",
  planId: PlanId.make("plan"),
  version: 1,
  sessionStartMessageCommitId: MercurianCommitId.make("query"),
  throughCommitId: MercurianCommitId.make("old-answer"),
  verbatimFromCommitId: MercurianCommitId.make("query"),
  compacted: {
    throughCommitId: MercurianCommitId.make("old-answer"),
    summary: "\n Exact summary.  \n",
  },
};
const seed = Effect.gen(function* () {
  yield* runMigrations();
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projects (project_id, name, created_at, updated_at) VALUES ('project', 'Project', '', '')`;
  yield* sql`INSERT INTO commit_histories (history_id, created_at) VALUES ('history', '')`;
  yield* sql`INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at) VALUES ('plan', 'project', 'history', 'Plan', '', '')`;
});

it.effect("retains exact immutable evidence, scopes reads, and cascades plan deletion", () =>
  Effect.gen(function* () {
    yield* seed;
    const store = yield* ReconstructionStore;
    yield* store.save(record);
    assert.deepStrictEqual(yield* store.get(record.planId, record.id), record);
    assert.strictEqual(yield* store.get(PlanId.make("another-plan"), record.id), null);
    assert.strictEqual(
      (yield* Effect.result(store.save({ ...record, compacted: null })))._tag,
      "Failure",
    );
    yield* (yield* SqlClient.SqlClient)`DELETE FROM plans WHERE plan_id = 'plan'`;
    assert.strictEqual(yield* store.get(record.planId, record.id), null);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("settlement waits for acknowledgment and never records a failed send", () =>
  Effect.gen(function* () {
    yield* seed;
    const store = yield* ReconstructionStore;
    const threadId = ThreadId.make("thread");
    yield* store.save(record);
    assert.strictEqual(yield* store.current(threadId), null);
    yield* store.prepare(threadId, "first", record.id);
    const settlement = yield* store.forMessage(threadId, "first").pipe(Effect.forkScoped);
    yield* store.finish(threadId, "first", true);
    assert.strictEqual(yield* Fiber.join(settlement), record.id);
    assert.strictEqual(yield* store.current(threadId), record.id);
    yield* store.prepare(threadId, "continuation", record.id);
    yield* store.finish(threadId, "continuation", false);
    assert.strictEqual(yield* store.current(threadId), record.id);
    yield* store.prepare(threadId, "second", record.id, true);
    yield* store.finish(threadId, "second", false);
    assert.strictEqual(yield* store.forMessage(threadId, "second"), null);
    assert.strictEqual(yield* store.current(threadId), null);
    assert.strictEqual(yield* store.forMessage(threadId, "legacy"), null);
  }).pipe(Effect.scoped, Effect.scoped, Effect.provide(testLayer)),
);

it.effect(
  "reopening the store retains submitted facts and treats abandoned preparation as unknown",
  () =>
    Effect.gen(function* () {
      yield* seed;
      const first = yield* ReconstructionStore;
      const threadId = ThreadId.make("thread");
      yield* first.save(record);
      yield* first.prepare(threadId, "submitted", record.id);
      yield* first.finish(threadId, "submitted", true);
      yield* first.prepare(threadId, "abandoned", record.id, true);
      yield* Effect.gen(function* () {
        const reopened = yield* ReconstructionStore;
        assert.deepStrictEqual(yield* reopened.get(record.planId, record.id), record);
        assert.strictEqual(yield* reopened.forMessage(threadId, "submitted"), record.id);
        assert.strictEqual(yield* reopened.forMessage(threadId, "abandoned"), null);
        assert.strictEqual(yield* reopened.current(threadId), null);
      }).pipe(Effect.provide(Layer.fresh(layer)));
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("scope cancellation releases settlement before any submission callback is returned", () =>
  Effect.gen(function* () {
    yield* seed;
    const store = yield* ReconstructionStore;
    const threadId = ThreadId.make("cancelled-thread");
    yield* store.save(record);
    const prepared = yield* Deferred.make<void>();
    const owner = yield* Effect.gen(function* () {
      yield* store.prepare(threadId, "cancelled", record.id, true);
      yield* Deferred.succeed(prepared, undefined);
      return yield* Effect.never;
    }).pipe(Effect.scoped, Effect.forkScoped);
    yield* Deferred.await(prepared);
    const settlement = yield* store.forMessage(threadId, "cancelled").pipe(Effect.forkScoped);
    yield* Fiber.interrupt(owner);
    assert.strictEqual(yield* Fiber.join(settlement), null);
    assert.strictEqual(yield* store.current(threadId), null);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

for (const statement of [
  "INSERT INTO reconstruction_attempts",
  "UPDATE reconstruction_attempts",
] as const) {
  for (const outcome of ["failure", "interruption"] as const) {
    it.effect(`releases settlement on ${outcome} at ${statement}`, () =>
      Effect.gen(function* () {
        yield* seed;
        const sql = yield* SqlClient.SqlClient;
        let intercepted = 0;
        const injectedSql = new Proxy(sql, {
          apply(target, thisArg, args) {
            const fragments: unknown = args[0];
            if (Array.isArray(fragments) && String(fragments[0]).startsWith(statement)) {
              intercepted++;
              return outcome === "interruption"
                ? Effect.interrupt
                : Effect.die(new Error("injected SQL failure"));
            }
            return Reflect.apply(target, thisArg, args);
          },
        });
        yield* Effect.gen(function* () {
          const store = yield* ReconstructionStore;
          const threadId = ThreadId.make("sql-boundary");
          yield* store.save(record);
          const exit = yield* Effect.gen(function* () {
            yield* store.prepare(threadId, "message", record.id, true);
            yield* store.finish(threadId, "message", true);
          }).pipe(Effect.scoped, Effect.exit);
          assert.ok(Exit.isFailure(exit));
          assert.ok(intercepted > 0);
          assert.strictEqual(yield* store.forMessage(threadId, "message"), null);
          assert.strictEqual(yield* store.current(threadId), null);
        }).pipe(
          Effect.provide(
            layer.pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, injectedSql))),
          ),
        );
      }).pipe(Effect.provide(database)),
    );
  }
}

it.effect("a failed SQL acknowledgment releases an already waiting settlement", () =>
  Effect.gen(function* () {
    yield* seed;
    const sql = yield* SqlClient.SqlClient;
    const store = yield* ReconstructionStore;
    const threadId = ThreadId.make("update-failure");
    yield* store.save(record);
    yield* store.prepare(threadId, "message", record.id, true);
    const settlement = yield* store.forMessage(threadId, "message").pipe(Effect.forkScoped);
    yield* sql`CREATE TRIGGER reject_submission BEFORE UPDATE ON reconstruction_attempts BEGIN SELECT RAISE(FAIL, 'submission failed'); END`;
    const result = yield* Effect.result(store.finish(threadId, "message", true));
    assert.strictEqual(result._tag, "Failure");
    assert.strictEqual(yield* Fiber.join(settlement), null);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);

it.effect("a handled prepare SQL failure releases settlement before the caller scope closes", () =>
  Effect.gen(function* () {
    yield* seed;
    const sql = yield* SqlClient.SqlClient;
    const store = yield* ReconstructionStore;
    const threadId = ThreadId.make("prepare-failure");
    yield* store.save(record);
    yield* sql`CREATE TRIGGER reject_attempt BEFORE INSERT ON reconstruction_attempts BEGIN SELECT RAISE(FAIL, 'prepare failed'); END`;
    const result = yield* Effect.result(store.prepare(threadId, "message", record.id, true));
    assert.strictEqual(result._tag, "Failure");
    assert.strictEqual(yield* store.forMessage(threadId, "message"), null);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
