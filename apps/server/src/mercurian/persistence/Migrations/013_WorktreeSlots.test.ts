import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { migrationEntries, runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("013_WorktreeSlots", (it) => {
  it.effect("adds line branches, session settle facts, and the project slot pool", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.ok(migrationEntries.some(([id]) => id === 13));
      yield* runMigrations();

      const lineBranches = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(line_branches)
      `;
      assert.deepStrictEqual(
        lineBranches.map(({ name }) => name),
        [
          "line_root_commit_id",
          "repository_id",
          "branch",
          "base_oid",
          "built",
          "created_at",
          "repoint_hold",
        ],
      );

      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(coding_sessions)
      `;
      assert.ok(sessionColumns.some(({ name }) => name === "settled_commit_oid"));
      assert.ok(sessionColumns.some(({ name }) => name === "partial"));

      const slots = yield* sql<{ readonly name: string }>`PRAGMA table_info(worktree_slots)`;
      assert.deepStrictEqual(
        slots.map(({ name }) => name),
        [
          "slot_id",
          "project_id",
          "path",
          "current_line_root_commit_id",
          "created_at",
          "last_used_at",
        ],
      );

      const members = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(worktree_slot_members)
      `;
      assert.deepStrictEqual(
        members.map(({ name }) => name),
        ["slot_id", "repository_id", "relative_path", "current_branch"],
      );

      const [membersTable] = yield* sql<{ readonly sql: string }>`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'worktree_slot_members'
      `;
      assert.match(
        membersTable?.sql ?? "",
        /REFERENCES worktree_slots\(slot_id\) ON DELETE CASCADE/u,
      );
    }),
  );
});
