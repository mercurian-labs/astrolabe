import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { migrationEntries, runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("018_LineRuntimeBirth", (it) => {
  it.effect("allows pending line runtimes and records project and visit ownership", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual(migrationEntries.length, 19);
      assert.strictEqual(migrationEntries.at(-1)?.[0], 19);
      yield* runMigrations({ toMigrationInclusive: 17 });
      yield* sql`
        INSERT INTO commit_histories (history_id, created_at)
        VALUES ('existing-history', CURRENT_TIMESTAMP)
      `;
      yield* sql`
        INSERT INTO projects (project_id, name, created_at, updated_at)
        VALUES ('existing-project', 'Existing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;
      yield* sql`
        INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at)
        VALUES (
          'existing-plan', 'existing-project', 'existing-history', 'Existing plan',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      yield* sql`
        INSERT INTO commits (
          commit_id, history_id, kind, author_kind, created_at, payload_json
        ) VALUES (
          'existing-line', 'existing-history', 'coding-session', 'assistant',
          CURRENT_TIMESTAMP, '{}'
        )
      `;
      yield* sql`
        INSERT INTO repositories (repository_id, name, path, created_at, updated_at)
        VALUES (
          'existing-repository', 'Existing repository', '/tmp/existing-repository',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      yield* sql`
        INSERT INTO line_runtimes (
          plan_id, line_root_commit_id, thread_id, home_repository_id, branch, worktree_path,
          created_at, updated_at
        ) VALUES (
          'existing-plan', 'existing-line', 'existing-thread', 'existing-repository',
          'mercurian/existing', '/tmp/existing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      yield* sql`
        INSERT INTO line_runtime_repositories (
          thread_id, repository_id, snapshot_oid, snapshot_kind, branch_tip_oid,
          departed_ref, branch_movement, pr_url
        ) VALUES (
          'existing-thread', 'existing-repository', 'member-snapshot', 'settled',
          'member-tip', 'refs/heads/main', '{"kind":"unchanged"}',
          'https://example.test/existing/pull/1'
        )
      `;
      yield* runMigrations();

      const lineColumns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
        readonly pk: number;
      }>`PRAGMA table_info(line_runtimes)`;
      assert.strictEqual(
        lineColumns.find(({ name }) => name === "line_root_commit_id")?.notnull,
        0,
      );
      assert.ok(lineColumns.some(({ name }) => name === "fork_parent_commit_id"));
      assert.deepStrictEqual(
        lineColumns.filter(({ pk }) => pk > 0).map(({ name }) => name),
        ["thread_id"],
      );
      const preserved = yield* sql<{ readonly threadId: string; readonly lineRoot: string | null }>`
        SELECT thread_id AS "threadId", line_root_commit_id AS "lineRoot" FROM line_runtimes
      `;
      assert.deepStrictEqual(preserved, [
        { threadId: "existing-thread", lineRoot: "existing-line" },
      ]);
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
          threadId: "existing-thread",
          repositoryId: "existing-repository",
          snapshotOid: "member-snapshot",
          branchTipOid: "member-tip",
        },
      ]);

      const projectColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projects)`;
      assert.ok(projectColumns.some(({ name }) => name === "orchestration_project_id"));
      const projects = yield* sql<{ readonly orchestrationProjectId: string | null }>`
        SELECT orchestration_project_id AS "orchestrationProjectId" FROM projects
        WHERE project_id = 'existing-project'
      `;
      assert.strictEqual(projects[0]?.orchestrationProjectId, null);
      const visitColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(plan_visits)`;
      assert.ok(visitColumns.some(({ name }) => name === "line_thread_id"));
    }),
  );
});
