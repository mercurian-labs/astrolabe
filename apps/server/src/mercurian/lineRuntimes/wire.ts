import * as DateTime from "effect/DateTime";
import type { PlanCodingSessionRecord, PlanLineRuntimeRecord } from "@t3tools/contracts";
import type { CodingSessionRecord } from "./LegacySessionSchema.ts";
import type { LineRuntimeRecord } from "./schema.ts";

export const toWireCodingSessionRecord = (
  record: CodingSessionRecord,
): PlanCodingSessionRecord => ({
  commitId: record.commitId,
  ...(record.repositoryId == null ? {} : { repositoryId: record.repositoryId }),
  threadId: record.threadId,
  branch: record.branch,
  worktreePath: record.worktreePath,
  baseRef: record.baseRef,
  startedAt: DateTime.formatIso(record.startedAt),
  endedAt: record.endedAt === null ? null : DateTime.formatIso(record.endedAt),
  outcome: record.outcome,
  prUrl: record.prUrl,
  settledCommitOid: record.settledCommitOid,
  partial: record.partial !== false && record.partial !== 0,
  snapshotOid: record.snapshotOid,
  snapshotKind: record.snapshotKind,
  departedRef: record.departedRef,
  branchMovement: record.branchMovement,
  ...(record.lineBranchMissingOid === undefined
    ? {}
    : { lineBranchMissingOid: record.lineBranchMissingOid }),
  ...(record.repositories === undefined ? {} : { repositories: record.repositories }),
  ...(record.unreachableRepositories.length === 0
    ? {}
    : { unreachableRepositories: record.unreachableRepositories }),
});

export const toWireLineRuntimeRecord = (record: LineRuntimeRecord): PlanLineRuntimeRecord => ({
  planId: record.planId,
  lineRootCommitId: record.lineRootCommitId,
  ...(record.forkParentCommitId === undefined
    ? {}
    : { forkParentCommitId: record.forkParentCommitId }),
  threadId: record.threadId,
  homeRepositoryId: record.homeRepositoryId,
  branch: record.branch,
  worktreePath: record.worktreePath,
  unreachableRepositories: record.unreachableRepositories,
  snapshotOid: record.snapshotOid,
  snapshotKind: record.snapshotKind,
  departedRef: record.departedRef,
  branchMovement: record.branchMovement,
  lineBranchMissingOid: record.lineBranchMissingOid,
  ...(record.repositories === undefined ? {} : { repositories: record.repositories }),
});
