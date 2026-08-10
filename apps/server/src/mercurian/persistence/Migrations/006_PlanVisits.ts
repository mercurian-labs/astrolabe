/**
 * When you last looked at a plan — the one fact "unseen updates" is derived
 * from.
 *
 * A table beside `plans` rather than a column on it, for three reasons.
 * Visiting is not a fact about what a plan *is*, and a plan row untouched by
 * reading can never have its `updated_at` bumped by attention — the tree's
 * order stays activity, not attention. Absence carries meaning here (never
 * visited) without a nullable column. And the deferred upgrade — per-user
 * visited state when identity arrives (ADR 002 §5) — is this keyed row growing
 * a `user_id`, not a change to `plans`.
 *
 * Workspace-local and single-user, which is exactly the phase ADR 001 §4 names.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS plan_visits (
      plan_id    TEXT PRIMARY KEY REFERENCES plans(plan_id),
      visited_at TEXT NOT NULL
    )
  `;
});
