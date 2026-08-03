/**
 * The commit DAG: Mercurian's planning history.
 *
 * Everything in a planning space is a commit in one branching, merging
 * history — the history is a DAG, not a strict tree. Commits are
 * heterogeneous along two axes: what they are (`kind`) and who made them
 * (`author_kind`). Merges are n-ary, so parents live in their own ordered
 * join table rather than a single `parent_id` column.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A history is the FK anchor for one planning space's commits. It carries
  // identity now; plan-level metadata attaches here when plans land.
  yield* sql`
    CREATE TABLE IF NOT EXISTS commit_histories (
      history_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS commits (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      commit_id TEXT NOT NULL UNIQUE,
      history_id TEXT NOT NULL REFERENCES commit_histories(history_id),
      kind TEXT NOT NULL CHECK (
        kind IN ('message', 'plan-revision', 'issue-revision', 'coding-session')
      ),
      author_kind TEXT NOT NULL CHECK (author_kind IN ('human', 'assistant')),
      published INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_commits_history
    ON commits(history_id, sequence)
  `;

  // Zero rows for a root, one for an ordinary continuation, two or more for a
  // merge. `parent_order` keeps the parents list ordered and unbounded.
  yield* sql`
    CREATE TABLE IF NOT EXISTS commit_parents (
      commit_id TEXT NOT NULL REFERENCES commits(commit_id),
      parent_id TEXT NOT NULL REFERENCES commits(commit_id),
      parent_order INTEGER NOT NULL,
      PRIMARY KEY (commit_id, parent_order),
      UNIQUE (commit_id, parent_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_commit_parents_parent
    ON commit_parents(parent_id)
  `;
});
