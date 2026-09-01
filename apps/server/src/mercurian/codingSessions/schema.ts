import * as Schema from "effect/Schema";

import {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";

export const CodingSessionOutcome = Schema.Literals(["completed", "stopped", "failed"]);
export type CodingSessionOutcome = typeof CodingSessionOutcome.Type;

export const CodingSessionRecord = Schema.Struct({
  commitId: MercurianCommitId,
  planId: PlanId,
  repositoryId: MercurianRepositoryId,
  threadId: ThreadId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  startedAt: Schema.DateTimeUtcFromString,
  endedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  outcome: Schema.NullOr(CodingSessionOutcome),
  prUrl: Schema.NullOr(Schema.String),
  settledCommitOid: Schema.NullOr(TrimmedNonEmptyString),
  partial: Schema.Union([Schema.Boolean, Schema.Number]),
});
export type CodingSessionRecord = typeof CodingSessionRecord.Type;
