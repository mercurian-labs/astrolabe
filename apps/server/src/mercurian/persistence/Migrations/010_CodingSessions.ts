import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS coding_sessions (
      commit_id      TEXT PRIMARY KEY REFERENCES commits(commit_id),
      plan_id        TEXT NOT NULL REFERENCES plans(plan_id),
      repository_id  TEXT NOT NULL,
      thread_id      TEXT NOT NULL,
      branch         TEXT NOT NULL,
      worktree_path  TEXT NOT NULL,
      base_ref       TEXT NOT NULL,
      started_at     TEXT NOT NULL,
      ended_at       TEXT,
      outcome        TEXT CHECK (outcome IN ('completed', 'stopped', 'failed')),
      pr_url         TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_coding_sessions_plan
    ON coding_sessions(plan_id)
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_coding_sessions_thread
    ON coding_sessions(thread_id)
  `;
});
