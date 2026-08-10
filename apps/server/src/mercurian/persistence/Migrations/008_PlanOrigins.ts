/**
 * Where an imported plan came from: the tracker connection and the issue.
 *
 * A table rather than columns on `plans`, as migration 005 promised. Most plans
 * are born blank and would carry nothing but empty origin fields; an origin is
 * a fact about the few that were imported.
 *
 * `UNIQUE (connection_id, issue_id)` is the idempotency rule made structural:
 * "re-importing never duplicates" holds even against two windows importing in
 * the same instant, because the second insert cannot land. Origin is
 * *connection* identity, not tracker kind — two Linear workspaces are two
 * connections whose issue keys may collide.
 *
 * `connection_id` is deliberately not a foreign key into `tracker_connections`.
 * Origins are content: disconnecting a tracker must never dangle a plan or
 * cascade into one. The accepted cost is that reconnecting the same tracker
 * workspace mints a new `connection_id`, so an import through the new
 * connection is a new origin. If that ever hurts, the fix is a tracker-side
 * workspace identity captured at probe time, not a foreign key here.
 *
 * Deliberately absent, each with its owner:
 *
 * - the issue's content. That is the plan's root commit; a copy here would be a
 *   second truth to drift from the first;
 * - the issue's status. A live fact about the tracker, derived when wanted and
 *   never stored — the same rule connections and repositories are read by.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS plan_origins (
      plan_id       TEXT PRIMARY KEY REFERENCES plans(plan_id),
      connection_id TEXT NOT NULL,
      issue_id      TEXT NOT NULL,
      issue_url     TEXT NOT NULL,
      imported_at   TEXT NOT NULL,
      UNIQUE (connection_id, issue_id)
    )
  `;
});
