import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { migrationEntries, runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("015_LineBranchHolds", (it) => {
  it.effect("adds the line branch hold and missing branch facts", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual(migrationEntries.at(-1)?.[0], 15);
      yield* runMigrations();

      const lineBranchColumns = yield* sql<{
        readonly name: string;
      }>`PRAGMA table_info(line_branches)`;
      const codingSessionColumns = yield* sql<{
        readonly name: string;
      }>`PRAGMA table_info(coding_sessions)`;
      assert.ok(lineBranchColumns.some(({ name }) => name === "repoint_hold"));
      assert.ok(codingSessionColumns.some(({ name }) => name === "line_branch_missing_oid"));
    }),
  );
});
