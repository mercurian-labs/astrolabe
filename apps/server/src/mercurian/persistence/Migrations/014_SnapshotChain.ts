import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE coding_sessions ADD COLUMN snapshot_oid TEXT`;
  yield* sql`ALTER TABLE coding_sessions ADD COLUMN snapshot_kind TEXT`;
  yield* sql`ALTER TABLE coding_sessions ADD COLUMN departed_ref TEXT`;
  yield* sql`ALTER TABLE coding_sessions ADD COLUMN branch_movement TEXT`;
});
