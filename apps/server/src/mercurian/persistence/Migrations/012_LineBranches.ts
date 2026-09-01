import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE coding_sessions ADD COLUMN settled_commit_oid TEXT`;
  yield* sql`ALTER TABLE coding_sessions ADD COLUMN partial INTEGER NOT NULL DEFAULT 0 CHECK (partial IN (0, 1))`;

  yield* sql`
    CREATE TABLE IF NOT EXISTS line_branches (
      line_root_commit_id TEXT NOT NULL,
      repository_id      TEXT NOT NULL,
      branch             TEXT NOT NULL,
      base_oid           TEXT NOT NULL,
      built              INTEGER NOT NULL DEFAULT 0 CHECK (built IN (0, 1)),
      created_at         TEXT NOT NULL,
      PRIMARY KEY (line_root_commit_id, repository_id)
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_line_branches_repository_branch
    ON line_branches(repository_id, branch)
  `;
});
