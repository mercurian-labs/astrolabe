import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Fork-owned additions to upstream's projection schema.
 *
 * These deliberately do not occupy an upstream migration id: that sequence is
 * high-churn territory, and appending to it guarantees numbering collisions on
 * upstream merges. The shared persistence setup runs these after upstream
 * migrations and before it exposes the database to projection layers.
 */
export const runProjectionAugmentations = Effect.fn("runProjectionAugmentations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "workspace_members_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN workspace_members_json TEXT
    `;
  }
});
