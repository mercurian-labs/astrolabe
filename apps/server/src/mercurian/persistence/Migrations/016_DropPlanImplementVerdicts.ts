import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP TABLE IF EXISTS plan_implement_verdicts`;

  // Project-scoped sessions no longer have one distinguished repository. Rebuild
  // the legacy table so new rows can leave repository_id empty while old rows
  // retain their original single-repository facts.
  yield* sql`
    CREATE TABLE coding_sessions_next (
      commit_id          TEXT PRIMARY KEY REFERENCES commits(commit_id),
      plan_id            TEXT NOT NULL REFERENCES plans(plan_id),
      repository_id      TEXT,
      thread_id          TEXT NOT NULL,
      branch             TEXT NOT NULL,
      worktree_path      TEXT NOT NULL,
      base_ref           TEXT NOT NULL,
      started_at         TEXT NOT NULL,
      ended_at           TEXT,
      outcome            TEXT CHECK (outcome IN ('completed', 'stopped', 'failed')),
      pr_url             TEXT,
      settled_commit_oid TEXT,
      partial            INTEGER NOT NULL DEFAULT 0 CHECK (partial IN (0, 1)),
      snapshot_oid       TEXT,
      snapshot_kind      TEXT,
      departed_ref       TEXT,
      branch_movement    TEXT,
      line_branch_missing_oid TEXT,
      unreachable_repositories_json TEXT NOT NULL DEFAULT '[]'
    )
  `;
  yield* sql`
    INSERT INTO coding_sessions_next
    SELECT commit_id, plan_id, repository_id, thread_id, branch, worktree_path,
           base_ref, started_at, ended_at, outcome, pr_url, settled_commit_oid, partial,
           snapshot_oid, snapshot_kind, departed_ref, branch_movement, line_branch_missing_oid,
           '[]'
    FROM coding_sessions
  `;
  yield* sql`DROP TABLE coding_sessions`;
  yield* sql`ALTER TABLE coding_sessions_next RENAME TO coding_sessions`;
  yield* sql`
    CREATE INDEX idx_coding_sessions_plan ON coding_sessions(plan_id)
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_coding_sessions_thread ON coding_sessions(thread_id)
  `;

  // One row per repository the session spans: the chain's latest snapshot
  // there, where the line's branch stood, and that repository's pull request.
  yield* sql`
    CREATE TABLE coding_session_repositories (
      thread_id       TEXT NOT NULL,
      repository_id   TEXT NOT NULL,
      snapshot_oid    TEXT,
      snapshot_kind   TEXT,
      branch_tip_oid  TEXT,
      departed_ref    TEXT,
      branch_movement TEXT,
      pr_url          TEXT,
      PRIMARY KEY (thread_id, repository_id)
    )
  `;
});
