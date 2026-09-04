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
      assert.strictEqual(migrationEntries.length, 18);
      assert.strictEqual(migrationEntries.at(-1)?.[0], 18);
      yield* runMigrations({ toMigrationInclusive: 17 });
      yield* sql`
        INSERT INTO projects (project_id, name, created_at, updated_at)
        VALUES ('existing-project', 'Existing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
