import * as Schema from "effect/Schema";

import {
  BranchMovement,
  MercurianCommitId,
  MercurianRepositoryId,
  PlanId,
  SnapshotKind,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";

import { CodingSessionRepositoryRecord } from "./LegacySessionSchema.ts";

export const LineRuntimeRecord = Schema.Struct({
  planId: PlanId,
  lineRootCommitId: Schema.NullOr(MercurianCommitId),
  forkParentCommitId: Schema.optional(MercurianCommitId),
  threadId: ThreadId,
  homeRepositoryId: MercurianRepositoryId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  unreachableRepositories: Schema.fromJsonString(Schema.Array(TrimmedNonEmptyString)),
  snapshotOid: Schema.NullOr(TrimmedNonEmptyString),
  snapshotKind: Schema.NullOr(SnapshotKind),
  departedRef: Schema.NullOr(Schema.String),
  branchMovement: Schema.NullOr(BranchMovement),
  lineBranchMissingOid: Schema.NullOr(TrimmedNonEmptyString),
  prState: Schema.optional(Schema.NullOr(Schema.Literals(["open", "closed", "merged"]))),
  memoryMergedHomeAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtcFromString)),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  repositories: Schema.optional(Schema.Array(CodingSessionRepositoryRecord)),
});
export type LineRuntimeRecord = typeof LineRuntimeRecord.Type;

export const CreateLineRuntimeInput = Schema.Struct({
  planId: PlanId,
  lineRootCommitId: Schema.NullOr(MercurianCommitId),
  forkParentCommitId: Schema.optional(MercurianCommitId),
  threadId: ThreadId,
  homeRepositoryId: MercurianRepositoryId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  unreachableRepositories: Schema.Array(TrimmedNonEmptyString),
  repositoryIds: Schema.Array(MercurianRepositoryId),
  createdAt: Schema.DateTimeUtcFromString,
});
export type CreateLineRuntimeInput = typeof CreateLineRuntimeInput.Type;
