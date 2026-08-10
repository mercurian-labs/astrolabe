/** Widen the commit-kind CHECK for repository-scoped technical plans. */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Foreign keys stay enabled throughout the migrator's wrapping transaction.
  // Rebuild the referenced table and its edges side-by-side, then remove the
  // old edge table before its parent so no intermediate state is orphaned.
  yield* sql`
    CREATE TABLE commits_new (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      commit_id TEXT NOT NULL UNIQUE,
      history_id TEXT NOT NULL REFERENCES commit_histories(history_id),
      kind TEXT NOT NULL CHECK (
        kind IN (
          'message',
          'plan-revision',
          'issue-revision',
          'technical-plan',
          'coding-session'
        )
      ),
      author_kind TEXT NOT NULL CHECK (author_kind IN ('human', 'assistant')),
      published INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO commits_new (
      sequence, commit_id, history_id, kind, author_kind, published, created_at, payload_json
    )
    SELECT
      sequence, commit_id, history_id, kind, author_kind, published, created_at, payload_json
    FROM commits
    ORDER BY sequence
  `;

  yield* sql`
    CREATE TABLE commit_parents_new (
      commit_id TEXT NOT NULL REFERENCES commits_new(commit_id),
      parent_id TEXT NOT NULL REFERENCES commits_new(commit_id),
      parent_order INTEGER NOT NULL,
      PRIMARY KEY (commit_id, parent_order),
      UNIQUE (commit_id, parent_id)
    )
  `;

  yield* sql`
    INSERT INTO commit_parents_new (commit_id, parent_id, parent_order)
    SELECT commit_id, parent_id, parent_order
    FROM commit_parents
    ORDER BY commit_id, parent_order
  `;

  yield* sql`DROP TABLE commit_parents`;
  yield* sql`DROP TABLE commits`;
  yield* sql`ALTER TABLE commits_new RENAME TO commits`;
  yield* sql`ALTER TABLE commit_parents_new RENAME TO commit_parents`;

  yield* sql`
    CREATE INDEX idx_commits_history
    ON commits(history_id, sequence)
  `;
  yield* sql`
    CREATE INDEX idx_commit_parents_parent
    ON commit_parents(parent_id)
  `;
});
