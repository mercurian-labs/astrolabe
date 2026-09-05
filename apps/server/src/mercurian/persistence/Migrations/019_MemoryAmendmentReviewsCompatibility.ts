import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // `IF NOT EXISTS` preserves rows written by branch-era migration 17 while
  // creating the table for databases that followed origin's 17/18 history.
  yield* sql`
    CREATE TABLE IF NOT EXISTS memory_amendment_reviews (
      line_root_commit_id TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      commit_oid TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      PRIMARY KEY (line_root_commit_id, repository_id, commit_oid)
    )
  `;

  const sessionColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(coding_sessions)`;
  if (!sessionColumns.some(({ name }) => name === "pr_state")) {
    yield* sql`ALTER TABLE coding_sessions ADD COLUMN pr_state TEXT`;
  }
  if (!sessionColumns.some(({ name }) => name === "memory_merged_home_at")) {
    yield* sql`ALTER TABLE coding_sessions ADD COLUMN memory_merged_home_at TEXT`;
  }

  const runtimeColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(line_runtimes)`;
  if (!runtimeColumns.some(({ name }) => name === "pr_state")) {
    yield* sql`ALTER TABLE line_runtimes ADD COLUMN pr_state TEXT`;
  }
  if (!runtimeColumns.some(({ name }) => name === "memory_merged_home_at")) {
    yield* sql`ALTER TABLE line_runtimes ADD COLUMN memory_merged_home_at TEXT`;
  }
});
