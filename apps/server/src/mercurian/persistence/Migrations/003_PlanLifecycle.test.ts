import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("003_PlanLifecycle", (it) => {
  it.effect("adds the one lifecycle column plans needed", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 3 });

      const columns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
      }>`PRAGMA table_info(plans)`;
      const archivedAt = columns.find((column) => column.name === "archived_at");
      assert.ok(archivedAt, "plans is missing archived_at");
      // Nullable is the whole design: null means the plan is in the tree.
      assert.strictEqual(archivedAt.notnull, 0);
    }),
  );

  it.effect("leaves plans written before it in the tree", () =>
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
      yield* sql`
        INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at)
        VALUES ('plan', 'project', 'history', 'Plan', '2026-08-03', '2026-08-03')
      `;

      yield* runMigrations({ toMigrationInclusive: 3 });

      const [row] = yield* sql<{ readonly archived_at: string | null }>`
        SELECT archived_at FROM plans WHERE plan_id = 'plan'
      `;
      assert.strictEqual(row?.archived_at, null);
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
