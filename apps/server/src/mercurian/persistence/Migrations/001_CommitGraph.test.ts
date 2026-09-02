import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const toNames = (columns: ReadonlyArray<{ readonly name: string }>) =>
  new Set(columns.map((column) => column.name));

layer("001_CommitGraph", (it) => {
  it.effect("keeps the migration manifest and commit kinds at the pre-derived surface", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual(migrationEntries.length, 14);
      yield* runMigrations();

      const rows = yield* sql<{ readonly sql: string | null }>`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'commits'
      `;
      const kindCheck = /kind IN \(([^)]+)\)/.exec(rows[0]?.sql ?? "");
      assert.strictEqual(
        kindCheck?.[1],
        "'message', 'plan-revision', 'issue-revision', 'coding-session'",
      );
    }),
  );

  it.effect("creates the commit graph tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 1 });

      const histories = toNames(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(commit_histories)`,
      );
      assert.ok(histories.has("history_id"));
      assert.ok(histories.has("created_at"));

      const commits = toNames(yield* sql<{ readonly name: string }>`PRAGMA table_info(commits)`);
      for (const column of [
        "sequence",
        "commit_id",
        "history_id",
        "kind",
        "author_kind",
        "published",
        "created_at",
        "payload_json",
      ]) {
        assert.ok(commits.has(column), `commits is missing ${column}`);
      }

      const parents = toNames(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(commit_parents)`,
      );
      assert.ok(parents.has("commit_id"));
      assert.ok(parents.has("parent_id"));
      assert.ok(parents.has("parent_order"));
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
