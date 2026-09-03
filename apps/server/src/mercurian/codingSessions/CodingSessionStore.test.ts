import { assert, it } from "@effect/vitest";
import { MercurianCommitId, MercurianRepositoryId, PlanId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as CodingSessionStore from "./CodingSessionStore.ts";

const layer = it.layer(
  CodingSessionStore.layer.pipe(Layer.provideMerge(MercurianSqlite.layerMemory)),
);
const at = (value: string) => DateTime.makeUnsafe(value);

const record = {
  commitId: MercurianCommitId.make("session-commit"),
  planId: PlanId.make("plan"),
  repositoryId: MercurianRepositoryId.make("repository"),
  threadId: ThreadId.make("thread"),
  branch: "mercurian/ship-it-12345678",
  worktreePath: "/tmp/ship-it",
  baseRef: "main",
  startedAt: at("2026-08-14T12:00:00.000Z"),
  endedAt: null,
  outcome: null,
  prUrl: null,
  settledCommitOid: null,
  partial: false,
  snapshotOid: null,
  snapshotKind: null,
  departedRef: null,
  branchMovement: null,
  lineBranchMissingOid: null,
  unreachableRepositories: [],
} as const;

const seedPlanAndCommit = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO commit_histories (history_id, created_at) VALUES ('history', '2026-08-14T12:00:00.000Z')`;
  yield* sql`INSERT INTO projects (project_id, name, created_at, updated_at) VALUES ('project', 'Project', '2026-08-14T12:00:00.000Z', '2026-08-14T12:00:00.000Z')`;
  yield* sql`INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at) VALUES ('plan', 'project', 'history', 'Plan', '2026-08-14T12:00:00.000Z', '2026-08-14T12:00:00.000Z')`;
  yield* sql`INSERT INTO commits (commit_id, history_id, kind, author_kind, created_at, payload_json) VALUES ('session-commit', 'history', 'coding-session', 'human', '2026-08-14T12:00:00.000Z', '{}')`;
});

layer("CodingSessionStore", (it) => {
  it.effect("records, queries, and updates the keyed mutable facts", () =>
    Effect.gen(function* () {
      yield* seedPlanAndCommit;
      const store = yield* CodingSessionStore.CodingSessionStore;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO repositories (repository_id, name, path, created_at, updated_at) VALUES ('repository', 'server', '/tmp/repository', '2026-08-14T12:00:00.000Z', '2026-08-14T12:00:00.000Z')`;
      yield* store.record(record);
      yield* store.recordRepositoriesInTransaction(record.threadId, [record.repositoryId]);

      assert.strictEqual((yield* store.listForPlan(record.planId)).length, 1);
      const byThread = yield* store.getByThreadId(record.threadId);
      assert.ok(Option.isSome(byThread));
      assert.strictEqual(byThread.value.commitId, record.commitId);
      const byWorktree = yield* store.getByWorktreePath(record.worktreePath);
      assert.ok(Option.isSome(byWorktree));
      assert.strictEqual(byWorktree.value.threadId, record.threadId);

      yield* store.recordSnapshot(record.threadId, {
        snapshotOid: "snapshot-one",
        kind: "settled",
        branchTipOid: "branch-tip",
        departedRef: null,
        branchMovement: { kind: "added", count: 2 },
      });
      let snapshotted = yield* store.getByThreadId(record.threadId);
      assert.ok(Option.isSome(snapshotted));
      assert.strictEqual(snapshotted.value.partial, 0);
      assert.strictEqual(snapshotted.value.settledCommitOid, "branch-tip");
      yield* store.recordSnapshot(record.threadId, {
        snapshotOid: "snapshot-partial",
        kind: "partial",
        branchTipOid: "partial-branch-tip",
        departedRef: null,
        branchMovement: { kind: "unchanged" },
      });
      yield* store.recordSnapshot(record.threadId, {
        snapshotOid: "snapshot-external",
        kind: "external",
        branchTipOid: "external-branch-tip",
        departedRef: null,
        branchMovement: { kind: "added", count: 1 },
      });
      snapshotted = yield* store.getByThreadId(record.threadId);
      assert.ok(Option.isSome(snapshotted));
      assert.strictEqual(snapshotted.value.partial, 1);
      assert.strictEqual(snapshotted.value.snapshotKind, "external");
      assert.strictEqual(snapshotted.value.settledCommitOid, "external-branch-tip");

      yield* store.recordLineBranchMissing(record.threadId, "missing-tip");
      const missing = yield* store.getByThreadId(record.threadId);
      assert.ok(Option.isSome(missing));
      assert.strictEqual(missing.value.lineBranchMissingOid, "missing-tip");
      yield* store.recordLineBranchMissing(record.threadId, null);

      yield* store.updateBranch(record.threadId, "renamed/session");
      const change = yield* store.changes.pipe(
        Stream.runHead,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* store.recordRepositorySnapshot(record.threadId, record.repositoryId, {
        snapshotOid: "member-snapshot",
        kind: "settled",
        branchTipOid: "member-tip",
        departedRef: "refs/heads/elsewhere",
        branchMovement: { kind: "rewritten" },
      });
      yield* store.attachPullRequest({
        threadId: record.threadId,
        repositoryId: record.repositoryId,
        prUrl: "https://example.test/pr/1",
      });
      const announcedPlan = yield* Fiber.join(change);
      assert.deepStrictEqual(Option.getOrNull(announcedPlan), record.planId);
      yield* store.end({
        threadId: record.threadId,
        endedAt: at("2026-08-14T13:00:00.000Z"),
        outcome: "completed",
      });
      const [updated] = yield* store.listAll;
      assert.strictEqual(updated?.branch, "renamed/session");
      assert.strictEqual(updated?.prUrl, null);
      assert.deepStrictEqual(updated?.repositories, [
        {
          repositoryId: record.repositoryId,
          repositoryName: "server",
          snapshotOid: "member-snapshot",
          snapshotKind: "settled",
          branchTipOid: "member-tip",
          departedRef: "refs/heads/elsewhere",
          branchMovement: { kind: "rewritten" },
          prUrl: "https://example.test/pr/1",
        },
      ]);
      assert.strictEqual(updated?.outcome, "completed");
      assert.strictEqual(updated?.snapshotOid, "snapshot-external");
      assert.strictEqual(updated?.settledCommitOid, "external-branch-tip");
      assert.deepStrictEqual(updated?.branchMovement, { kind: "added", count: 1 });
      assert.strictEqual(DateTime.formatIso(updated!.endedAt!), "2026-08-14T13:00:00.000Z");
      yield* sql`DELETE FROM repositories WHERE repository_id = 'repository'`;
      const [stored] = yield* store.listForPlan(record.planId);
      assert.strictEqual(stored?.repositoryId, record.repositoryId);
    }),
  );
});
