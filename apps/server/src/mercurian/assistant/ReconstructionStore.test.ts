import { assert, it } from "@effect/vitest";
import { MercurianCommitId, PlanId, ThreadId, type PlanReconstruction } from "@t3tools/contracts";
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
  }).pipe(Effect.provide(testLayer)),
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
    yield* store.prepare(threadId, "second", record.id);
    yield* store.finish(threadId, "second", false);
    assert.strictEqual(yield* store.forMessage(threadId, "second"), null);
    assert.strictEqual(yield* store.current(threadId), null);
    assert.strictEqual(yield* store.forMessage(threadId, "legacy"), null);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
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
      yield* first.prepare(threadId, "abandoned", record.id);
      yield* Effect.gen(function* () {
        const reopened = yield* ReconstructionStore;
        assert.deepStrictEqual(yield* reopened.get(record.planId, record.id), record);
        assert.strictEqual(yield* reopened.forMessage(threadId, "submitted"), record.id);
        assert.strictEqual(yield* reopened.forMessage(threadId, "abandoned"), null);
      }).pipe(Effect.provide(Layer.fresh(layer)));
    }).pipe(Effect.provide(testLayer)),
);
