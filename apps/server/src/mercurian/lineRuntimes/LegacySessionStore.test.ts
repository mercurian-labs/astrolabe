import { assert, it } from "@effect/vitest";
import { PlanId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as LegacySessionStore from "./LegacySessionStore.ts";

const layer = it.layer(
  LegacySessionStore.layer.pipe(Layer.provideMerge(MercurianSqlite.layerMemory)),
);

layer("LegacySessionStore", (it) => {
  it.effect("reads preserved sessions and their renamed repository rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO commit_histories (history_id, created_at) VALUES ('history', '2026-09-03T12:00:00.000Z')`;
      yield* sql`INSERT INTO projects (project_id, name, created_at, updated_at) VALUES ('project', 'Project', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z')`;
      yield* sql`INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at) VALUES ('plan', 'project', 'history', 'Plan', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z')`;
      yield* sql`INSERT INTO commits (commit_id, history_id, kind, author_kind, created_at, payload_json) VALUES ('session-commit', 'history', 'coding-session', 'assistant', '2026-09-03T12:00:00.000Z', '{}')`;
      yield* sql`INSERT INTO repositories (repository_id, name, path, created_at, updated_at) VALUES ('repository', 'server', '/tmp/repository', '2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z')`;
      yield* sql`INSERT INTO coding_sessions
        (commit_id, plan_id, repository_id, thread_id, branch, worktree_path, base_ref, started_at)
        VALUES ('session-commit', 'plan', 'repository', 'legacy-thread', 'mercurian/legacy', '/tmp/legacy', 'main', '2026-09-03T12:00:00.000Z')`;
      yield* sql`INSERT INTO line_runtime_repositories (thread_id, repository_id)
        VALUES ('legacy-thread', 'repository')`;

      const store = yield* LegacySessionStore.LegacySessionStore;
      const byThread = yield* store.getByThreadId(ThreadId.make("legacy-thread"));
      assert.ok(Option.isSome(byThread));
      assert.strictEqual(byThread.value.planId, PlanId.make("plan"));
      assert.strictEqual(byThread.value.repositories?.[0]?.repositoryName, "server");
      assert.ok(Option.isSome(yield* store.getByBranch("mercurian/legacy")));
      assert.strictEqual((yield* store.listByPlan(PlanId.make("plan"))).length, 1);
      yield* store.recordPullRequestState(ThreadId.make("legacy-thread"), "merged");
      const mergedAt = DateTime.makeUnsafe("2026-09-03T13:00:00.000Z");
      yield* store.recordMemoryMergedHome(ThreadId.make("legacy-thread"), mergedAt);
      const updated = Option.getOrThrow(yield* store.getByThreadId(ThreadId.make("legacy-thread")));
      assert.strictEqual(updated.prState, "merged");
      assert.deepStrictEqual(updated.memoryMergedHomeAt, mergedAt);
    }),
  );
});
