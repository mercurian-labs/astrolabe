import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const toNames = (columns: ReadonlyArray<{ readonly name: string }>) =>
  new Set(columns.map((column) => column.name));

layer("006_PlanVisits", (it) => {
  it.effect("creates the plan visits table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 6 });

      const visits = toNames(yield* sql<{ readonly name: string }>`PRAGMA table_info(plan_visits)`);
      for (const column of ["plan_id", "visited_at"]) {
        assert.ok(visits.has(column), `plan_visits is missing ${column}`);
      }
    }),
  );

  it.effect("keeps at most one visit per plan", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 6 });

      yield* sql`
        INSERT INTO projects (project_id, name, created_at, updated_at)
        VALUES ('project', 'Project', '2026-08-03', '2026-08-03')
      `;
      yield* sql`
        INSERT INTO commit_histories (history_id, created_at) VALUES ('history', '2026-08-03')
      `;
      yield* sql`
        INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at)
        VALUES ('plan', 'project', 'history', 'Plan', '2026-08-03', '2026-08-03')
      `;

      const insertVisit = () => sql`
        INSERT INTO plan_visits (plan_id, visited_at) VALUES ('plan', '2026-08-03')
      `;
      yield* insertVisit();
      const second = yield* Effect.result(insertVisit());
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
