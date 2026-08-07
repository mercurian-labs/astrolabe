import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const toNames = (columns: ReadonlyArray<{ readonly name: string }>) =>
  new Set(columns.map((column) => column.name));

layer("003_Repositories", (it) => {
  it.effect("creates the registry, its scripts, and the project join", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 3 });

      const repositories = toNames(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(repositories)`,
      );
      for (const column of ["repository_id", "name", "path", "created_at", "updated_at"]) {
        assert.ok(repositories.has(column), `repositories is missing ${column}`);
      }
      // Environment, provider, and git-ness each have an owner elsewhere, and
      // none of them is a column here.
      for (const absent of ["environment", "environment_id", "provider", "is_git", "has_git"]) {
        assert.ok(!repositories.has(absent), `repositories should not carry ${absent}`);
      }

      const scripts = toNames(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(repository_scripts)`,
      );
      for (const column of [
        "repository_id",
        "script_id",
        "name",
        "command",
        "preview_url",
        "is_setup",
        "position",
      ]) {
        assert.ok(scripts.has(column), `repository_scripts is missing ${column}`);
      }

      const joins = toNames(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(project_repositories)`,
      );
      for (const column of ["project_id", "repository_id", "added_at"]) {
        assert.ok(joins.has(column), `project_repositories is missing ${column}`);
      }
    }),
  );

  it.effect("registers a path exactly once", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 3 });

      const insert = (repositoryId: string, name: string) => sql`
        INSERT INTO repositories (repository_id, name, path, created_at, updated_at)
        VALUES (${repositoryId}, ${name}, '/tmp/astrolabe', '2026-08-06', '2026-08-06')
      `;
      yield* insert("repo-a", "astrolabe");
      const second = yield* Effect.result(insert("repo-b", "astrolabe again"));
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
