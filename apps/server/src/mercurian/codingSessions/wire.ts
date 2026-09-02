import * as DateTime from "effect/DateTime";
import type { PlanCodingSessionRecord } from "@t3tools/contracts";
import type { CodingSessionRecord } from "./schema.ts";

export const toWireCodingSessionRecord = (
  record: CodingSessionRecord,
): PlanCodingSessionRecord => ({
  commitId: record.commitId,
  repositoryId: record.repositoryId,
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
});
