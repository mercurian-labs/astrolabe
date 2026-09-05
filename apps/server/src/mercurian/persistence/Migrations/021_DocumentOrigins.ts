import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE project_document_locations (project_id TEXT NOT NULL, kind TEXT NOT NULL, repository_id TEXT NOT NULL, subpath TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id, kind, repository_id, subpath))`;
  yield* sql`INSERT INTO project_document_locations SELECT project_id, kind, repository_id, COALESCE(subpath, ''), created_at, updated_at FROM project_storage_sources WHERE kind != 'memory'`;
  yield* sql`CREATE TABLE project_spec_baselines (document_id TEXT NOT NULL, revision TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(document_id, revision))`;
  yield* sql`CREATE TABLE project_document_origins (document_id TEXT PRIMARY KEY, payload TEXT NOT NULL)`;
});
