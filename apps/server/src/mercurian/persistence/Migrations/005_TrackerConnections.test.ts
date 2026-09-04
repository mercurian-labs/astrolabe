import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const toNames = (columns: ReadonlyArray<{ readonly name: string }>) =>
  new Set(columns.map((column) => column.name));

layer("005_TrackerConnections", (it) => {
  // Asserted as an *exact* set, not a subset: what this table must not grow is
  // the point of it. A token column, a standing column, or anything
  // issue-shaped fails here before it can reach a review.
  it.effect("creates tracker_connections with exactly its five columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 5 });

      const columns = toNames(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(tracker_connections)`,
      );
      assert.deepStrictEqual([...columns].toSorted(), [
        "connection_id",
        "created_at",
        "kind",
        "label",
        "updated_at",
      ]);
    }),
  );

  it.effect("keeps issues and credentials out of the schema entirely", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 5 });

      const tables = yield* sql<{
        readonly name: string;
      }>`SELECT name FROM sqlite_master WHERE type = 'table'`;
      for (const table of tables) {
        assert.ok(
          !/issue|token|secret/i.test(table.name),
          `${table.name} looks like a stored issue or credential`,
        );
      }
    }),
  );

  it.effect("allows two connections of the same kind", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 5 });

      const insert = (connectionId: string, label: string) => sql`
        INSERT INTO tracker_connections (connection_id, kind, label, created_at, updated_at)
        VALUES (${connectionId}, 'linear', ${label}, '2026-08-06', '2026-08-06')
      `;
      yield* insert("connection-a", "Mercurian");
      yield* insert("connection-b", "Another workspace");

      const rows = yield* sql<{
        readonly count: number;
      }>`SELECT COUNT(*) AS count FROM tracker_connections`;
      assert.strictEqual(rows[0]?.count, 2);
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
