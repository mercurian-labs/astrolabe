import * as Schema from "effect/Schema";

import {
  BranchMovement,
  MercurianCommitId,
  MercurianRepositoryId,
  PlanId,
  ThreadId,
  SnapshotKind,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";

export const CodingSessionOutcome = Schema.Literals(["completed", "stopped", "failed"]);
export type CodingSessionOutcome = typeof CodingSessionOutcome.Type;

export const CodingSessionRepositoryRecord = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  repositoryName: TrimmedNonEmptyString,
  snapshotOid: Schema.NullOr(TrimmedNonEmptyString),
  snapshotKind: Schema.NullOr(SnapshotKind),
  branchTipOid: Schema.NullOr(TrimmedNonEmptyString),
  departedRef: Schema.NullOr(Schema.String),
  branchMovement: Schema.NullOr(BranchMovement),
  prUrl: Schema.NullOr(Schema.String),
});
export type CodingSessionRepositoryRecord = typeof CodingSessionRepositoryRecord.Type;

export const CodingSessionRecord = Schema.Struct({
  commitId: MercurianCommitId,
  planId: PlanId,
  repositoryId: Schema.optional(Schema.NullOr(MercurianRepositoryId)),
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
  snapshotOid: Schema.NullOr(TrimmedNonEmptyString),
  snapshotKind: Schema.NullOr(SnapshotKind),
  departedRef: Schema.NullOr(Schema.String),
  branchMovement: Schema.NullOr(BranchMovement),
  lineBranchMissingOid: Schema.NullOr(TrimmedNonEmptyString),
  repositories: Schema.optional(Schema.Array(CodingSessionRepositoryRecord)),
  unreachableRepositories: Schema.fromJsonString(Schema.Array(TrimmedNonEmptyString)),
});
export type CodingSessionRecord = typeof CodingSessionRecord.Type;
