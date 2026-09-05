import type {
  EnvironmentId,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffResult,
  ThreadId,
} from "@t3tools/contracts";

export type CheckpointDiffResult =
  | OrchestrationGetTurnDiffResult
  | OrchestrationGetFullThreadDiffResult;

export interface CheckpointDiffState {
  readonly data: CheckpointDiffResult | null;
  readonly error: string | null;
  readonly isPending: boolean;
}

export interface CheckpointDiffTarget {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly fromTurnCount: number | null;
  readonly toTurnCount: number | null;
  readonly ignoreWhitespace: boolean;
  readonly repositoryId?: string | null;
  readonly cacheScope?: string | null;
}

/** UI diff action for a durable act, including standalone import/refresh/merge captures. */
export interface RecordedCheckpointDiffTarget {
  readonly environmentId: EnvironmentId;
  readonly input: import("@t3tools/contracts").MercurianReadCheckpointDiffInput;
}

export function recordedCheckpointDiffTarget(
  environmentId: EnvironmentId,
  record: import("@t3tools/contracts").PlanCheckpointRecord,
  repositoryId: import("@t3tools/contracts").MercurianRepositoryId,
  ignoreWhitespace = false,
): RecordedCheckpointDiffTarget {
  return {
    environmentId,
    input: {
      planId: record.planId,
      ownerCommitId: record.ownerCommitId,
      repositoryId,
      checkpointRevision: record.revision,
      ignoreWhitespace,
    },
  };
}

/** Revisions prevent a previously unavailable result from shadowing stronger capture facts. */
export function recordedCheckpointDiffCacheKey(target: RecordedCheckpointDiffTarget): string {
  return JSON.stringify([
    target.environmentId,
    target.input.planId,
    target.input.ownerCommitId,
    target.input.repositoryId,
    target.input.checkpointRevision,
    target.input.ignoreWhitespace ?? false,
  ]);
}

/** Pass to forkLine for code continuation; query-edit actions keep using parentCommitId. */
export function recordedCheckpointForkInput(
  record: import("@t3tools/contracts").PlanCheckpointRecord,
) {
  return {
    planId: record.planId,
    checkpointOwnerCommitId: record.ownerCommitId,
    checkpointRevision: record.revision,
  };
}
