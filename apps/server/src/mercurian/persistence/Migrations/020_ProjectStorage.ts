import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE project_storage_sources (
    project_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('memory','plan','spec')),
    repository_id TEXT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
    subpath TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, kind)
  )`;
  yield* sql`INSERT INTO project_storage_sources SELECT project_id, 'memory', repository_id, subpath, created_at, updated_at FROM project_memory_sources`;
  yield* sql`DROP TABLE project_memory_sources`;
});
