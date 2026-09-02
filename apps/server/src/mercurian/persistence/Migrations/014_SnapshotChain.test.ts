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
      assert.strictEqual(migrationEntries.at(-1)?.[0], 14);
      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(coding_sessions)`;
      const names = columns.map(({ name }) => name);
      assert.ok(names.includes("snapshot_oid"));
      assert.ok(names.includes("snapshot_kind"));
      assert.ok(names.includes("departed_ref"));
      assert.ok(names.includes("branch_movement"));
    }),
  );
});
