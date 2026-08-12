import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const toNames = (columns: ReadonlyArray<{ readonly name: string }>) =>
  new Set(columns.map((column) => column.name));

layer("009_PlanImplementVerdicts", (it) => {
  it.effect("creates the keyed verdict table with exactly the two stored kinds", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 9 });

      const verdicts = toNames(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(plan_implement_verdicts)`,
      );
      for (const column of ["commit_id", "plan_id", "kind", "payload_json", "recorded_at"]) {
        assert.ok(verdicts.has(column), `plan_implement_verdicts is missing ${column}`);
      }

      const rows = yield* sql<{ readonly sql: string | null }>`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'plan_implement_verdicts'
      `;
      const kindCheck = /kind\s+TEXT\s+NOT NULL\s+CHECK\s*\(kind IN \(([^)]+)\)\)/u.exec(
        rows[0]?.sql ?? "",
      );
      assert.strictEqual(kindCheck?.[1], "'ready', 'needs-split'");
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
