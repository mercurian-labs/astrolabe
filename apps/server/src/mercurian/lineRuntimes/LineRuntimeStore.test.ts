import { assert, it } from "@effect/vitest";
import { MercurianCommitId, MercurianRepositoryId, PlanId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as LineRuntimeStore from "./LineRuntimeStore.ts";

const layer = it.layer(
  LineRuntimeStore.layer.pipe(Layer.provideMerge(MercurianSqlite.layerMemory)),
);
const at = (value: string) => DateTime.makeUnsafe(value);

const planId = PlanId.make("plan");
const lineRootCommitId = MercurianCommitId.make("line-root");
const repositoryId = MercurianRepositoryId.make("repository");
const threadId = ThreadId.make("thread");

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO commit_histories (history_id, created_at) VALUES ('history', '2026-08-14T12:00:00.000Z')`;
  yield* sql`INSERT INTO projects (project_id, name, created_at, updated_at) VALUES ('project', 'Project', '2026-08-14T12:00:00.000Z', '2026-08-14T12:00:00.000Z')`;
  yield* sql`INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at) VALUES ('plan', 'project', 'history', 'Plan', '2026-08-14T12:00:00.000Z', '2026-08-14T12:00:00.000Z')`;
  yield* sql`INSERT INTO commits (commit_id, history_id, kind, author_kind, created_at, payload_json) VALUES ('line-root', 'history', 'message', 'human', '2026-08-14T12:00:00.000Z', '{}')`;
  yield* sql`INSERT INTO repositories (repository_id, name, path, created_at, updated_at) VALUES ('repository', 'server', '/tmp/repository', '2026-08-14T12:00:00.000Z', '2026-08-14T12:00:00.000Z')`;
});

layer("LineRuntimeStore", (it) => {
  it.effect("records, queries, and updates a line runtime and its repository facts", () =>
    Effect.gen(function* () {
      yield* seed;
      const store = yield* LineRuntimeStore.LineRuntimeStore;
      yield* store.create({
        planId,
        lineRootCommitId,
        threadId,
        homeRepositoryId: repositoryId,
        branch: "mercurian/ship-it",
        worktreePath: "/tmp/ship-it",
        unreachableRepositories: [],
        repositoryIds: [repositoryId],
        createdAt: at("2026-08-14T12:00:00.000Z"),
      });

      const byLine = yield* store.getOrNone(planId, lineRootCommitId);
      assert.ok(Option.isSome(byLine));
      assert.strictEqual(byLine.value.threadId, threadId);
      assert.strictEqual((yield* store.listByPlan(planId)).length, 1);

      yield* store.updateWorkspace(threadId, {
        branch: "mercurian/renamed",
        worktreePath: "/tmp/renamed-worktree",
      });
      yield* store.recordSnapshot(threadId, {
        snapshotOid: "snapshot",
        kind: "settled",
        branchTipOid: "tip",
        departedRef: null,
        branchMovement: { kind: "added", count: 2 },
      });
      yield* store.recordRepositorySnapshot(threadId, repositoryId, {
        snapshotOid: "member-snapshot",
        kind: "settled",
        branchTipOid: "member-tip",
        departedRef: null,
        branchMovement: { kind: "unchanged" },
      });
      yield* store.attachPullRequest({
        threadId,
        repositoryId,
        prUrl: "https://example.test/pr/1",
      });
      yield* store.recordLineBranchMissing(threadId, "missing-tip");

      const updated = Option.getOrThrow(yield* store.getByThreadId(threadId));
      assert.strictEqual(updated.branch, "mercurian/renamed");
      assert.strictEqual(updated.worktreePath, "/tmp/renamed-worktree");
      assert.strictEqual(updated.snapshotOid, "snapshot");
      assert.deepStrictEqual(updated.branchMovement, { kind: "added", count: 2 });
      assert.strictEqual(updated.lineBranchMissingOid, "missing-tip");
      assert.strictEqual(updated.repositories?.[0]?.prUrl, "https://example.test/pr/1");
    }),
  );
});
