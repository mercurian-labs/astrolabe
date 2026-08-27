/**
 * A project's single designated source of durable design memory.
 *
 * The designation is stored because it is a user choice. Notes, maps, and the
 * derived index are deliberately absent: files remain the only truth, and the
 * server recomputes their index from disk on every read.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_memory_sources (
      project_id    TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
      subpath       TEXT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    )
  `;
});
