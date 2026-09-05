import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import LegacyMemoryReviews from "./017_MemoryAmendmentReviews.ts";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("019_MemoryAmendmentReviewsCompatibility", (it) => {
  it.effect("upgrades the branch-era 017 history without losing reviews or legacy threads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 16 });
      yield* LegacyMemoryReviews;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (17, 'MemoryAmendmentReviews')
      `;
      yield* sql`
        INSERT INTO commit_histories (history_id, created_at)
        VALUES ('legacy-history', CURRENT_TIMESTAMP)
      `;
      yield* sql`
        INSERT INTO projects (project_id, name, created_at, updated_at)
        VALUES ('legacy-project', 'Legacy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;
      yield* sql`
        INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at)
        VALUES (
          'legacy-plan', 'legacy-project', 'legacy-history', 'Legacy plan',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      yield* sql`
        INSERT INTO commits (
          commit_id, history_id, kind, author_kind, created_at, payload_json
        ) VALUES (
          'legacy-line', 'legacy-history', 'coding-session', 'assistant',
          CURRENT_TIMESTAMP, '{}'
        )
      `;
      yield* sql`
        INSERT INTO repositories (repository_id, name, path, created_at, updated_at)
        VALUES (
          'memory-repository', 'Memory repository', '/tmp/memory-repository',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      yield* sql`
        INSERT INTO coding_sessions (
          commit_id, plan_id, repository_id, thread_id, branch, worktree_path, base_ref, started_at
        ) VALUES (
          'legacy-line', 'legacy-plan', 'memory-repository', 'legacy-thread', 'mercurian/legacy',
          '/tmp/legacy', 'mercurian/legacy', CURRENT_TIMESTAMP
        )
      `;
      yield* sql`
        INSERT INTO coding_session_repositories (
          thread_id, repository_id, snapshot_oid, snapshot_kind, branch_tip_oid,
          departed_ref, branch_movement, pr_url
        ) VALUES (
          'legacy-thread', 'memory-repository', 'legacy-snapshot', 'settled',
          'legacy-tip', 'refs/heads/main', '{"kind":"unchanged"}',
          'https://example.test/legacy/pull/1'
        )
      `;
      yield* sql`
        INSERT INTO memory_amendment_reviews (
          line_root_commit_id, repository_id, commit_oid, reviewed_at
        ) VALUES ('legacy-line', 'memory-repository', 'reviewed-commit', CURRENT_TIMESTAMP)
      `;

      yield* runMigrations();

      const reviews = yield* sql<{ readonly commitOid: string }>`
        SELECT commit_oid AS "commitOid" FROM memory_amendment_reviews
      `;
      assert.deepStrictEqual(reviews, [{ commitOid: "reviewed-commit" }]);
      const sessions = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId" FROM coding_sessions
      `;
      assert.deepStrictEqual(sessions, [{ threadId: "legacy-thread" }]);
      const members = yield* sql<{
        readonly threadId: string;
        readonly repositoryId: string;
        readonly snapshotOid: string | null;
        readonly branchTipOid: string | null;
      }>`
        SELECT thread_id AS "threadId", repository_id AS "repositoryId",
          snapshot_oid AS "snapshotOid", branch_tip_oid AS "branchTipOid"
        FROM line_runtime_repositories
      `;
      assert.deepStrictEqual(members, [
        {
          threadId: "legacy-thread",
          repositoryId: "memory-repository",
          snapshotOid: "legacy-snapshot",
          branchTipOid: "legacy-tip",
        },
      ]);
      const lineColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(line_runtimes)`;
      assert.ok(lineColumns.some(({ name }) => name === "fork_parent_commit_id"));
      assert.ok(lineColumns.some(({ name }) => name === "pr_state"));
      assert.ok(lineColumns.some(({ name }) => name === "memory_merged_home_at"));
      const applied = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name FROM effect_sql_migrations
        WHERE migration_id >= 17 ORDER BY migration_id
      `;
      assert.deepStrictEqual(applied, [
        { migrationId: 17, name: "MemoryAmendmentReviews" },
        { migrationId: 18, name: "LineRuntimeBirth" },
        { migrationId: 19, name: "MemoryAmendmentReviewsCompatibility" },
        { migrationId: 20, name: "ProjectStorage" },
        { migrationId: 21, name: "DocumentOrigins" },
        { migrationId: 22, name: "DocumentOperations" },
        { migrationId: 23, name: "ReconstructionRecords" },
        { migrationId: 24, name: "CheckpointRecords" },
      ]);
    }),
  );
});
