import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { migrationEntries, runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("017_LineRuntimes", (it) => {
  it.effect("adds line runtimes while preserving legacy sessions", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual(migrationEntries.length, 23);
      assert.strictEqual(migrationEntries[16]?.[0], 17);

      yield* runMigrations({ toMigrationInclusive: 17 });

      const columns = yield* sql<{ readonly name: string; readonly pk: number }>`
        PRAGMA table_info(line_runtimes)
      `;
      assert.deepStrictEqual(
        columns.filter(({ pk }) => pk > 0).map(({ name }) => name),
        ["plan_id", "line_root_commit_id"],
      );
      assert.deepStrictEqual(
        columns.map(({ name }) => name),
        [
          "plan_id",
          "line_root_commit_id",
          "thread_id",
          "home_repository_id",
          "branch",
          "worktree_path",
          "unreachable_repositories_json",
          "snapshot_oid",
          "snapshot_kind",
          "departed_ref",
          "branch_movement",
          "line_branch_missing_oid",
          "created_at",
          "updated_at",
        ],
      );
      const indexes = yield* sql<{ readonly name: string; readonly unique: number }>`
        PRAGMA index_list(line_runtimes)
      `;
      assert.ok(
        indexes.some(({ name, unique }) => name === "idx_line_runtimes_thread" && unique === 1),
      );

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
          AND name IN ('coding_sessions', 'coding_session_repositories', 'line_runtime_repositories')
      `;
      assert.ok(tables.some(({ name }) => name === "coding_sessions"));
      assert.ok(tables.some(({ name }) => name === "line_runtime_repositories"));
      assert.ok(!tables.some(({ name }) => name === "coding_session_repositories"));
    }),
  );
});
