import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { migrationEntries, runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("016_DropPlanImplementVerdicts", (it) => {
  it.effect("retires verdicts and adds repository-scoped session facts", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual(migrationEntries.length, 19);
      assert.strictEqual(migrationEntries.at(-1)?.[0], 19);
      yield* runMigrations({ toMigrationInclusive: 15 });
      const verdictBefore = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'plan_implement_verdicts'
      `;
      assert.strictEqual(verdictBefore.length, 1);

      yield* runMigrations({ toMigrationInclusive: 16 });
      const verdictAfter = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'plan_implement_verdicts'
      `;
      assert.strictEqual(verdictAfter.length, 0);

      const repositories = yield* sql<{
        readonly name: string;
        readonly pk: number;
      }>`PRAGMA table_info(coding_session_repositories)`;
      assert.deepStrictEqual(
        repositories.filter(({ pk }) => pk > 0).map(({ name }) => name),
        ["thread_id", "repository_id"],
      );

      const sessionColumns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
      }>`PRAGMA table_info(coding_sessions)`;
      assert.strictEqual(sessionColumns.find(({ name }) => name === "repository_id")?.notnull, 0);
      for (const column of [
        "snapshot_oid",
        "snapshot_kind",
        "departed_ref",
        "branch_movement",
        "line_branch_missing_oid",
      ]) {
        assert.ok(
          sessionColumns.some(({ name }) => name === column),
          column,
        );
      }
      assert.deepStrictEqual(
        repositories.map(({ name }) => name),
        [
          "thread_id",
          "repository_id",
          "snapshot_oid",
          "snapshot_kind",
          "branch_tip_oid",
          "departed_ref",
          "branch_movement",
          "pr_url",
        ],
      );
    }),
  );
});
