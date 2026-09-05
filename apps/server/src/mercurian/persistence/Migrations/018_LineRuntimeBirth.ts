import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const lineRuntimeTables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'line_runtimes'
  `;
  if (lineRuntimeTables.length === 0) {
    // M-194 development databases already used migration id 17 for memory
    // reviews. Their next migration must establish the unified runtime schema
    // that origin's 17 would otherwise have created.
    yield* sql`
      CREATE TABLE line_runtimes (
        plan_id                       TEXT NOT NULL REFERENCES plans(plan_id),
        line_root_commit_id           TEXT REFERENCES commits(commit_id),
        fork_parent_commit_id         TEXT REFERENCES commits(commit_id),
        thread_id                     TEXT PRIMARY KEY,
        home_repository_id            TEXT NOT NULL REFERENCES repositories(repository_id),
        branch                        TEXT NOT NULL,
        worktree_path                 TEXT NOT NULL,
        unreachable_repositories_json TEXT NOT NULL DEFAULT '[]',
        snapshot_oid                  TEXT,
        snapshot_kind                 TEXT,
        departed_ref                  TEXT,
        branch_movement               TEXT,
        line_branch_missing_oid       TEXT,
        created_at                    TEXT NOT NULL,
        updated_at                    TEXT NOT NULL
      )
    `;
    yield* sql`ALTER TABLE coding_session_repositories RENAME TO line_runtime_repositories`;
  } else {
    yield* sql`
      CREATE TABLE line_runtimes_next (
        plan_id                       TEXT NOT NULL REFERENCES plans(plan_id),
        line_root_commit_id           TEXT REFERENCES commits(commit_id),
        fork_parent_commit_id         TEXT REFERENCES commits(commit_id),
        thread_id                     TEXT PRIMARY KEY,
        home_repository_id            TEXT NOT NULL REFERENCES repositories(repository_id),
        branch                        TEXT NOT NULL,
        worktree_path                 TEXT NOT NULL,
        unreachable_repositories_json TEXT NOT NULL DEFAULT '[]',
        snapshot_oid                  TEXT,
        snapshot_kind                 TEXT,
        departed_ref                  TEXT,
        branch_movement               TEXT,
        line_branch_missing_oid       TEXT,
        created_at                    TEXT NOT NULL,
        updated_at                    TEXT NOT NULL
      )
    `;
    yield* sql`
      INSERT INTO line_runtimes_next (
        plan_id, line_root_commit_id, thread_id, home_repository_id, branch, worktree_path,
        unreachable_repositories_json, snapshot_oid, snapshot_kind, departed_ref,
        branch_movement, line_branch_missing_oid, created_at, updated_at
      )
      SELECT plan_id, line_root_commit_id, thread_id, home_repository_id, branch, worktree_path,
        unreachable_repositories_json, snapshot_oid, snapshot_kind, departed_ref,
        branch_movement, line_branch_missing_oid, created_at, updated_at
      FROM line_runtimes
    `;
    yield* sql`DROP TABLE line_runtimes`;
    yield* sql`ALTER TABLE line_runtimes_next RENAME TO line_runtimes`;
  }
  yield* sql`
    CREATE UNIQUE INDEX idx_line_runtimes_line
    ON line_runtimes(plan_id, line_root_commit_id)
    WHERE line_root_commit_id IS NOT NULL
  `;
  yield* sql`CREATE INDEX idx_line_runtimes_plan ON line_runtimes(plan_id)`;

  const projectColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projects)`;
  if (!projectColumns.some(({ name }) => name === "orchestration_project_id")) {
    yield* sql`ALTER TABLE projects ADD COLUMN orchestration_project_id TEXT`;
  }
  const visitColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(plan_visits)`;
  if (!visitColumns.some(({ name }) => name === "line_thread_id")) {
    yield* sql`ALTER TABLE plan_visits ADD COLUMN line_thread_id TEXT`;
  }
});
