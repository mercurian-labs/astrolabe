import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE checkpoint_record_clock (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    update_sequence INTEGER NOT NULL,
    event_sequence INTEGER NOT NULL
  )`;
  yield* sql`INSERT INTO checkpoint_record_clock VALUES (1, 0, 0)`;
  yield* sql`CREATE TABLE checkpoint_records (
    owner_commit_id TEXT PRIMARY KEY REFERENCES commits(commit_id),
    plan_id TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    thread_id TEXT,
    turn_id TEXT,
    update_sequence INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    UNIQUE(thread_id, turn_id)
  )`;
  yield* sql`CREATE INDEX idx_checkpoint_plan_updates ON checkpoint_records(plan_id, update_sequence)`;
  yield* sql`CREATE INDEX idx_checkpoint_thread ON checkpoint_records(thread_id)`;
  // Only unresolved capture facts live here; not a second event journal.
  yield* sql`CREATE TABLE checkpoint_unresolved (
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    request_message_id TEXT,
    capture_json TEXT NOT NULL,
    PRIMARY KEY(thread_id, turn_id)
  )`;
  yield* sql`CREATE UNIQUE INDEX idx_checkpoint_response_owner ON commits(json_extract(payload_json, '$.checkpointOwnerCommitId'))
    WHERE json_extract(payload_json, '$.checkpointOwnerCommitId') IS NOT NULL`;
});
