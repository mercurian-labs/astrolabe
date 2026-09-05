import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE line_runtimes (
      plan_id                      TEXT NOT NULL REFERENCES plans(plan_id),
      line_root_commit_id          TEXT NOT NULL REFERENCES commits(commit_id),
      thread_id                    TEXT NOT NULL,
      home_repository_id           TEXT NOT NULL REFERENCES repositories(repository_id),
      branch                       TEXT NOT NULL,
      worktree_path                 TEXT NOT NULL,
      unreachable_repositories_json TEXT NOT NULL DEFAULT '[]',
      snapshot_oid                 TEXT,
      snapshot_kind                TEXT,
      departed_ref                 TEXT,
      branch_movement              TEXT,
      line_branch_missing_oid       TEXT,
      created_at                   TEXT NOT NULL,
      updated_at                   TEXT NOT NULL,
      PRIMARY KEY (plan_id, line_root_commit_id)
    )
  `;
  yield* sql`CREATE UNIQUE INDEX idx_line_runtimes_thread ON line_runtimes(thread_id)`;
  yield* sql`CREATE INDEX idx_line_runtimes_plan ON line_runtimes(plan_id)`;
  yield* sql`ALTER TABLE coding_session_repositories RENAME TO line_runtime_repositories`;
});
