import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE project_document_operations (thread_id TEXT NOT NULL, document_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(thread_id, document_id))`;
});
