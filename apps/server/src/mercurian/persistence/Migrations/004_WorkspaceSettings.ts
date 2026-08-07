/**
 * Workspace settings: the settings that belong to the workspace rather than to
 * the machine.
 *
 * The Mercurian database is the workspace (ADR 001); `settings.json` is the
 * machine — binary paths, the provider-instance map, the machine's own model
 * selections. The planning model is a workspace fact, so it lives here, and
 * every machine resolves it to one of its own instances at runtime.
 *
 * A key-value table rather than a column per setting: workspace-scoped settings
 * accrete, rows are cheap, and each key's value is schema-validated JSON at the
 * store layer, so the shapelessness never crosses that boundary.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS workspace_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
