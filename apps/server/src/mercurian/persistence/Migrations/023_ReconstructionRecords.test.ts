import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.effect("adds empty reconstruction storage without changing historical replies", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 18 });
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO commit_histories (history_id, created_at) VALUES ('history', '')`;
    yield* sql`INSERT INTO commits (commit_id, history_id, kind, author_kind, published, created_at, payload_json) VALUES ('old-reply', 'history', 'message', 'assistant', 0, '', '{"text":"historical reply"}')`;
    yield* runMigrations();
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM commits WHERE commit_id = 'old-reply'`;
    assert.strictEqual(rows[0]?.payload_json, '{"text":"historical reply"}');
    assert.deepStrictEqual(yield* sql`SELECT * FROM session_reconstructions`, []);
    assert.deepStrictEqual(yield* sql`SELECT * FROM reconstruction_attempts`, []);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
