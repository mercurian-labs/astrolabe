import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { migrationEntries, runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
layer("019_MemoryAmendmentReviewsCompatibility", (it) => {
  it.effect("adds review state and the phase-three session columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual(migrationEntries.length, 23);
      assert.strictEqual(migrationEntries.at(-1)?.[0], 23);
      yield* runMigrations();
      const reviews = yield* sql<{
        readonly name: string;
        readonly notnull: number;
      }>`PRAGMA table_info(memory_amendment_reviews)`;
      assert.deepStrictEqual(
        reviews.map(({ name }) => name),
        ["line_root_commit_id", "repository_id", "commit_oid", "reviewed_at"],
      );
      assert.isTrue(reviews.every(({ notnull }) => notnull === 1));
      const sessions = yield* sql<{ readonly name: string }>`PRAGMA table_info(coding_sessions)`;
      assert.ok(sessions.some(({ name }) => name === "pr_state"));
      assert.ok(sessions.some(({ name }) => name === "memory_merged_home_at"));
    }),
  );
});
