/**
 * Projects and plans: the containers the commit graph hangs from.
 *
 * A project scopes any number of plans; a plan is the unit of work and owns
 * exactly one planning space. `plans.history_id` is UNIQUE, which makes "one
 * plan per planning space" structural rather than conventional, and the FK to
 * `commit_histories` is an ordinary same-database reference — both tables live
 * in `mercurian.sqlite`.
 *
 * Deliberately absent: status columns, archive/delete columns, a
 * project↔repository join table, and import-origin columns. Each arrives with
 * the feature that writes it rather than sitting empty here.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // A plan row exists only once its history does: creation takes the first
  // message, so "nothing exists until its first commit" is enforced by the
  // write path, and this FK keeps it true in the schema.
  yield* sql`
    CREATE TABLE IF NOT EXISTS plans (
      plan_id    TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(project_id),
      history_id TEXT NOT NULL UNIQUE REFERENCES commit_histories(history_id),
      title      TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // The tree reads plans per project, newest first.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_plans_project
    ON plans(project_id, updated_at)
  `;
});
