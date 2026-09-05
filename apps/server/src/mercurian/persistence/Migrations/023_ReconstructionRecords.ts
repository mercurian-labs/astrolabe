import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE session_reconstructions (
      reconstruction_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
      record_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE reconstruction_attempts (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      reconstruction_id TEXT NOT NULL REFERENCES session_reconstructions(reconstruction_id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('prepared', 'submitted', 'failed')),
      UNIQUE(thread_id, message_id)
    )
  `;
  yield* sql`CREATE INDEX idx_reconstruction_thread ON reconstruction_attempts(thread_id, status, sequence)`;
});
