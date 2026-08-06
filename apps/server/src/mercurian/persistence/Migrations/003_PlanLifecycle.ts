/**
 * Archiving: the one column the plan lifecycle needs.
 *
 * A plan disappears in two ways and only one of them is a state. Delete is a
 * hard removal — plan row, commits, edges, history — so it stores nothing.
 * Archive is navigational and reversible, so it is a timestamp: null means the
 * plan is in the tree, a stamp means it left it and can come back.
 *
 * Nothing here records whether a plan may be deleted. That rule — "delete
 * exists only while a plan is fully private" — is a predicate over the commits
 * the history already owns (`EXISTS … published = 1`), and duplicating it into
 * a column would be a second truth to drift from the first.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE plans ADD COLUMN archived_at TEXT NULL`;

  // The tree reads active plans; the Archived page reads the rest. Both are a
  // scan of one small table today, and this keeps them from becoming one when
  // the table is not small.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_plans_archived
    ON plans(archived_at)
  `;
});
