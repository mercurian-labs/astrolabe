import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { migrationEntries, runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("014_SnapshotChain", (it) => {
  it.effect("adds the coding session snapshot facts", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual(migrationEntries.at(-2)?.[0], 14);
      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(coding_sessions)`;
      const names = new Set(columns.map(({ name }) => name));
      assert.ok(names.has("snapshot_oid"));
      assert.ok(names.has("snapshot_kind"));
      assert.ok(names.has("departed_ref"));
      assert.ok(names.has("branch_movement"));
    }),
  );
});
