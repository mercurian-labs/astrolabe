import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("004_WorkspaceSettings", (it) => {
  it.effect("creates the workspace settings table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 4 });

      const columns = new Set(
        (yield* sql<{ readonly name: string }>`PRAGMA table_info(workspace_settings)`).map(
          (column) => column.name,
        ),
      );
      for (const column of ["key", "value", "updated_at"]) {
        assert.ok(columns.has(column), `workspace_settings is missing ${column}`);
      }
    }),
  );

  it.effect("keys one row per setting", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 4 });

      const insert = () => sql`
        INSERT INTO workspace_settings (key, value, updated_at)
        VALUES ('planningModel', '{}', '2026-08-06')
      `;
      yield* insert();
      const second = yield* Effect.result(insert());
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
