import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const toNames = (columns: ReadonlyArray<{ readonly name: string }>) =>
  new Set(columns.map((column) => column.name));

layer("002_ProjectsPlans", (it) => {
  it.effect("creates the projects and plans tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 2 });

      const projects = toNames(yield* sql<{ readonly name: string }>`PRAGMA table_info(projects)`);
      for (const column of ["project_id", "name", "created_at", "updated_at"]) {
        assert.ok(projects.has(column), `projects is missing ${column}`);
      }

      const plans = toNames(yield* sql<{ readonly name: string }>`PRAGMA table_info(plans)`);
      for (const column of [
        "plan_id",
        "project_id",
        "history_id",
        "title",
        "created_at",
        "updated_at",
      ]) {
        assert.ok(plans.has(column), `plans is missing ${column}`);
      }
    }),
  );

  it.effect("keeps one plan per planning space", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 2 });

      yield* sql`
        INSERT INTO projects (project_id, name, created_at, updated_at)
        VALUES ('project', 'Project', '2026-08-03', '2026-08-03')
      `;
      yield* sql`
        INSERT INTO commit_histories (history_id, created_at) VALUES ('history', '2026-08-03')
      `;

      const insertPlan = (planId: string) => sql`
        INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at)
        VALUES (${planId}, 'project', 'history', 'Plan', '2026-08-03', '2026-08-03')
      `;
      yield* insertPlan("plan-a");
      const second = yield* Effect.result(insertPlan("plan-b"));
      assert.strictEqual(second._tag, "Failure");
    }),
  );

  it.effect("is a no-op when run again", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const executed = yield* runMigrations();
      assert.deepStrictEqual(executed, []);
    }),
  );
});
