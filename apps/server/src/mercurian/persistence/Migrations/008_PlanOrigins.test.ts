import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const toNames = (columns: ReadonlyArray<{ readonly name: string }>) =>
  new Set(columns.map((column) => column.name));

const seedPlan = (sql: SqlClient.SqlClient, planId: string) =>
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO projects (project_id, name, created_at, updated_at)
      VALUES ('project', 'Project', '2026-08-08', '2026-08-08')
      ON CONFLICT(project_id) DO NOTHING
    `;
    yield* sql`
      INSERT INTO commit_histories (history_id, created_at)
      VALUES (${`history-${planId}`}, '2026-08-08')
    `;
    yield* sql`
      INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at)
      VALUES (${planId}, 'project', ${`history-${planId}`}, 'Plan', '2026-08-08', '2026-08-08')
    `;
  });

layer("008_PlanOrigins", (it) => {
  it.effect("creates the plan origins table and nothing more", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 8 });

      const columns = toNames(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(plan_origins)`,
      );
      // Asserted exactly: no status column and no content columns. The issue's
      // content is the root commit, and its status is a live tracker fact.
      assert.deepStrictEqual([...columns].sort(), [
        "connection_id",
        "imported_at",
        "issue_id",
        "issue_url",
        "plan_id",
      ]);
    }),
  );

  it.effect("keeps one plan per origin", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 8 });
      yield* seedPlan(sql, "plan-one");
      yield* seedPlan(sql, "plan-two");

      const insertOrigin = (planId: string, connectionId: string) => sql`
        INSERT INTO plan_origins (plan_id, connection_id, issue_id, issue_url, imported_at)
        VALUES (${planId}, ${connectionId}, 'M-101', 'https://tracker/M-101', '2026-08-08')
      `;
      yield* insertOrigin("plan-one", "connection");

      const duplicate = yield* Effect.result(insertOrigin("plan-two", "connection"));
      assert.strictEqual(duplicate._tag, "Failure");

      // The same issue key reached through another connection is another
      // origin: origin is connection identity, not tracker kind.
      const otherConnection = yield* Effect.result(insertOrigin("plan-two", "other-connection"));
      assert.strictEqual(otherConnection._tag, "Success");
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
