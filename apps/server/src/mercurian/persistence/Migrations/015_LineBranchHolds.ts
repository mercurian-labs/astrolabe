import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE line_branches ADD COLUMN repoint_hold TEXT`;
  yield* sql`ALTER TABLE coding_sessions ADD COLUMN line_branch_missing_oid TEXT`;
});
