/**
 * Repositories: the codebases Mercurian can reach, the scripts declared on
 * them, and the project sets they belong to.
 *
 * `project_repositories` is the join table 002's header deferred to "the
 * feature that writes it" — both parents live in `mercurian.sqlite`, so these
 * are ordinary same-database foreign keys.
 *
 * Deliberately absent, each with an owner:
 *
 * - an `environment` column. Environments are plumbing: the registry lives in
 *   one server's database, so a row's environment is a fact about which server
 *   answered, not data to store;
 * - provider and auth columns. A repository's provider is derived from its
 *   remotes, live, and the provider surface belongs to hosting-provider
 *   detection;
 * - an `is_git` column. Probed on read, so it flips on its own the moment
 *   someone runs `git init`;
 * - worktree and session columns, which arrive with coding sessions;
 * - any foreign key from `plans` or commits to `repositories`. That absence is
 *   what makes "no plan is filed under a repository" and "grounding references
 *   already in plan histories stay as record" true by construction: those
 *   references are content, so removing a registry row cannot dangle them.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // `path` is stored as the server resolved it, which makes double
  // registration a schema fact rather than a check someone has to remember.
  yield* sql`
    CREATE TABLE IF NOT EXISTS repositories (
      repository_id TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      path          TEXT NOT NULL UNIQUE,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    )
  `;

  // App-owned and per-machine: the declarations live here, never in the
  // repository, so there is no format to design and nothing to pollute.
  yield* sql`
    CREATE TABLE IF NOT EXISTS repository_scripts (
      repository_id TEXT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
      script_id     TEXT NOT NULL,
      name          TEXT NOT NULL,
      command       TEXT NOT NULL,
      preview_url   TEXT,
      is_setup      INTEGER NOT NULL DEFAULT 0,
      position      INTEGER NOT NULL,
      PRIMARY KEY (repository_id, script_id)
    )
  `;

  // The cascade is the "removal disconnects" rule: a removed repository
  // silently leaves every project set it was in.
  yield* sql`
    CREATE TABLE IF NOT EXISTS project_repositories (
      project_id    TEXT NOT NULL REFERENCES projects(project_id),
      repository_id TEXT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
      added_at      TEXT NOT NULL,
      PRIMARY KEY (project_id, repository_id)
    )
  `;

  // The set is read per project by everything that treats it as context.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_repositories_project
    ON project_repositories(project_id)
  `;
});
