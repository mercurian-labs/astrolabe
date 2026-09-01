import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS worktree_slots (
      slot_id                     TEXT PRIMARY KEY,
      project_id                  TEXT NOT NULL,
      path                        TEXT NOT NULL UNIQUE,
      current_line_root_commit_id TEXT,
      created_at                  TEXT NOT NULL,
      last_used_at                TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS worktree_slot_members (
      slot_id        TEXT NOT NULL REFERENCES worktree_slots(slot_id) ON DELETE CASCADE,
      repository_id  TEXT NOT NULL,
      relative_path  TEXT NOT NULL,
      current_branch TEXT,
      PRIMARY KEY (slot_id, repository_id),
      UNIQUE (slot_id, relative_path)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_worktree_slots_project
    ON worktree_slots(project_id, slot_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_worktree_slot_members_repository
    ON worktree_slot_members(repository_id, slot_id)
  `;
});
