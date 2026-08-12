/**
 * The implementation answer recorded for a plan commit.
 *
 * A keyed table beside the commit rather than a column on it: readiness is
 * not a fact about what a commit *is*, and absence carries meaning here (the
 * commit has never been evaluated). The commit key also makes the first
 * answer immutable while the plan key keeps plan-scoped reads direct.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS plan_implement_verdicts (
      commit_id    TEXT PRIMARY KEY REFERENCES commits(commit_id),
      plan_id      TEXT NOT NULL REFERENCES plans(plan_id),
      kind         TEXT NOT NULL CHECK (kind IN ('ready', 'needs-split')),
      payload_json TEXT NOT NULL,
      recorded_at  TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_plan_implement_verdicts_plan
    ON plan_implement_verdicts(plan_id)
  `;
});
