import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { migrationEntries, runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("011_MemorySources", (it) => {
  it.effect("creates the designation without persisting a derived index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.ok(migrationEntries.some(([id]) => id === 11));
      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(project_memory_sources)
      `;
      assert.deepStrictEqual(
        columns.map(({ name }) => name),
        ["project_id", "repository_id", "subpath", "created_at", "updated_at"],
      );

      const [table] = yield* sql<{ readonly sql: string }>`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'project_memory_sources'
      `;
      assert.match(
        table?.sql ?? "",
        /repository_id\s+TEXT\s+NOT NULL\s+REFERENCES repositories\(repository_id\) ON DELETE CASCADE/u,
      );

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `;
      for (const absent of ["memory_notes", "memory_maps", "memory_index"]) {
        assert.ok(!tables.some(({ name }) => name === absent), `${absent} should not exist`);
      }
    }),
  );

  it.effect("cascades a designation when its repository is removed", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO projects (project_id, name, created_at, updated_at)
        VALUES ('project', 'Project', '2026-08-27', '2026-08-27')
      `;
      yield* sql`
        INSERT INTO repositories (repository_id, name, path, created_at, updated_at)
        VALUES ('repository', 'Memory', '/tmp/memory', '2026-08-27', '2026-08-27')
      `;
      yield* sql`
        INSERT INTO project_memory_sources
          (project_id, repository_id, subpath, created_at, updated_at)
        VALUES ('project', 'repository', NULL, '2026-08-27', '2026-08-27')
      `;
      yield* sql`DELETE FROM repositories WHERE repository_id = 'repository'`;
      const rows = yield* sql`SELECT * FROM project_memory_sources`;
      assert.deepStrictEqual(rows, []);
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
