import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE memory_amendment_reviews (
      line_root_commit_id TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      commit_oid TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      PRIMARY KEY (line_root_commit_id, repository_id, commit_oid)
    )
  `;
  yield* sql`ALTER TABLE coding_sessions ADD COLUMN pr_state TEXT`;
  yield* sql`ALTER TABLE coding_sessions ADD COLUMN memory_merged_home_at TEXT`;
});
