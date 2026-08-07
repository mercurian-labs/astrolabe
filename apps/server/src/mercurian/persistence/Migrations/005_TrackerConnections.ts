/**
 * Tracker connections: which external trackers this workspace reaches.
 *
 * A connection is a durable act of configuration — someone connected a
 * tracker — and that is all this table holds. Everything about the *tracker*
 * stays in the tracker.
 *
 * Deliberately absent, each with its owner:
 *
 * - a token column. The credential is a secret, and secrets are files
 *   (`ServerSecretStore`), never rows;
 * - a status column. Where a connection stands is a fact about the outside
 *   world, derived live behind a short-lived cache and never stored — the same
 *   rule `RepositoryIdentityResolver` reads by;
 * - imported-issue and origin columns. Issue import owns those, and its table
 *   arrives with the feature that writes it;
 * - per-kind configuration columns. Linear needs none; Jira's site URL arrives
 *   with the Jira connector.
 *
 * No UNIQUE on `kind`: two Linear workspaces are two connections, and it is
 * connection identity — not kind — that an import's origin will name.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS tracker_connections (
      connection_id TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      label         TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    )
  `;
});
