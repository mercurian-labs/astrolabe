/**
 * CheckpointDiffQuery - Query interface for computed checkpoint diffs.
 *
 * Provides read-only diff operations across checkpoint snapshots used by
 * orchestration APIs.
 *
 * @module CheckpointDiffQuery
 */
import {
  CheckpointRef,
  type MercurianReadCheckpointDiffInput,
  type MercurianReadCheckpointDiffResult,
  OrchestrationGetTurnDiffResult,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffInput,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
  type MercurianReadLineUncommittedDiffInput,
  type MercurianReadLineUncommittedDiffResult,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  CheckpointDiffResultInvalidError,
  CheckpointRefUnavailableError,
  CheckpointThreadNotFoundError,
  CheckpointTurnRangeUnavailableError,
  CheckpointWorkspacePathMissingError,
} from "./Errors.ts";
import type { CheckpointServiceError } from "./Errors.ts";
import { chainParentRef, checkpointRefForThreadTurn } from "./Utils.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import {
  LegacySessionStore,
  type LegacySessionStoreError,
} from "../mercurian/lineRuntimes/LegacySessionStore.ts";
import {
  LineRuntimeStore,
  type LineRuntimeStoreError,
} from "../mercurian/lineRuntimes/LineRuntimeStore.ts";
import { resolveThreadLine } from "../mercurian/lineRuntimes/resolveThreadLine.ts";
import {
  LineBranchStore,
  type LineBranchStoreError,
} from "../mercurian/commitTree/LineBranchStore.ts";
import {
  RepositoryStore,
  type RepositoryStoreError,
} from "../mercurian/repositories/RepositoryStore.ts";
import { CheckpointRecordStore } from "../mercurian/planning/CheckpointRecordStore.ts";
import { isSnapshotOid } from "../mercurian/planning/checkpointTargets.ts";
import type { PersistenceSqlError } from "../persistence/Errors.ts";
import { lineSnapshotRef } from "../mercurian/worktreeSlots/SnapshotChain.ts";

/** Service tag for checkpoint diff queries. */
export class CheckpointDiffQuery extends Context.Service<
  CheckpointDiffQuery,
  {
    /** Read an act-owned exact snapshot pair without requiring a live runtime. */
    readonly getCheckpointDiff: (
      input: MercurianReadCheckpointDiffInput,
    ) => Effect.Effect<
      MercurianReadCheckpointDiffResult,
      CheckpointServiceError | PersistenceSqlError | RepositoryStoreError
    >;
    /**
     * Read the patch diff for a single turn checkpoint transition.
     *
     * Verifies checkpoint availability in both projection state and filesystem.
     */
    readonly getTurnDiff: (
      input: OrchestrationGetTurnDiffInput,
    ) => Effect.Effect<OrchestrationGetTurnDiffResultType, CheckpointServiceError>;

    /**
     * Read the full patch diff across a thread range of checkpoints.
     *
     * Uses turn-diff semantics with `fromTurnCount = 0`.
     */
    readonly getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Effect.Effect<OrchestrationGetFullThreadDiffResult, CheckpointServiceError>;
    readonly getLineUncommittedDiff: (
      input: MercurianReadLineUncommittedDiffInput,
    ) => Effect.Effect<
      MercurianReadLineUncommittedDiffResult,
      | CheckpointServiceError
      | LegacySessionStoreError
      | LineRuntimeStoreError
      | LineBranchStoreError
      | RepositoryStoreError
    >;
  }
>()("t3/checkpointing/CheckpointDiffQuery") {}

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);

function buildTurnDiffResult(
  input: {
    readonly threadId: ThreadId;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  },
  diff: string,
): OrchestrationGetTurnDiffResultType {
  return {
    threadId: input.threadId,
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
    diff,
  };
}

export const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore.CheckpointStore;
  const lineRuntimes = yield* LineRuntimeStore;
  const legacySessions = yield* LegacySessionStore;
  const lineBranches = yield* LineBranchStore;
  const repositories = yield* RepositoryStore;
  const records = yield* CheckpointRecordStore;

  const getCheckpointDiff: CheckpointDiffQuery["Service"]["getCheckpointDiff"] = Effect.fn(
    "CheckpointDiffQuery.getCheckpointDiff",
  )(function* (input) {
    const record = yield* records.get(input.planId, input.ownerCommitId);
    const unavailable = (
      reason: Extract<MercurianReadCheckpointDiffResult, { status: "unavailable" }>["reason"],
    ) => ({
      status: "unavailable" as const,
      checkpointRevision: record?.revision ?? 0,
      reason,
    });
    if (record === null) return unavailable("record-missing");
    if (record.revision !== input.checkpointRevision) return unavailable("record-changed");
    if (record.capture === undefined) return unavailable("capture-pending");
    const member = record.capture.repositories?.find(
      (candidate) => candidate.repositoryId === input.repositoryId,
    );
    if (member === undefined) return unavailable("repository-not-recorded");
    if (
      member.captureStatus !== "ready" ||
      !isSnapshotOid(member.beforeSnapshotOid) ||
      !isSnapshotOid(member.afterSnapshotOid)
    ) {
      return unavailable("snapshot-missing");
    }
    // Membership comes from the saved act; current project/header selection cannot retarget it.
    const repository = (yield* repositories.getSnapshot).repositories.find(
      (candidate) => candidate.repositoryId === member.repositoryId,
    );
    if (repository === undefined || !repository.hasGit)
      return unavailable("repository-unavailable");
    const fromCheckpointRef = CheckpointRef.make(member.beforeSnapshotOid);
    const toCheckpointRef = CheckpointRef.make(member.afterSnapshotOid);
    const available = yield* Effect.forEach([fromCheckpointRef, toCheckpointRef], (checkpointRef) =>
      checkpointStore.hasCheckpointRef({ cwd: repository.path, checkpointRef }),
    );
    if (!available.every(Boolean)) return unavailable("snapshot-missing");
    const diff = yield* checkpointStore.diffCheckpoints({
      cwd: repository.path,
      fromCheckpointRef,
      toCheckpointRef,
      fallbackFromToHead: false,
      ignoreWhitespace: input.ignoreWhitespace ?? false,
    });
    return {
      status: "ready",
      planId: record.planId,
      ownerCommitId: record.ownerCommitId,
      repositoryId: input.repositoryId,
      checkpointRevision: record.revision,
      diff,
    };
  });

  const getTurnDiff: CheckpointDiffQuery["Service"]["getTurnDiff"] = Effect.fn("getTurnDiff")(
    function* (input) {
      const operation = "CheckpointDiffQuery.getTurnDiff";
      const ignoreWhitespace = input.ignoreWhitespace ?? true;
      yield* Effect.annotateCurrentSpan({
        "checkpoint.thread_id": input.threadId,
        "checkpoint.from_turn_count": input.fromTurnCount,
        "checkpoint.to_turn_count": input.toTurnCount,
        "checkpoint.ignore_whitespace": ignoreWhitespace,
      });

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointDiffResultInvalidError({
            operation,
            threadId: input.threadId,
          });
        }
        return emptyDiff;
      }

      const threadContext = yield* projectionSnapshotQuery
        .getThreadCheckpointContext(input.threadId)
        .pipe(Effect.withSpan("checkpoint.turnDiff.lookupContext"));
      if (Option.isNone(threadContext)) {
        return yield* new CheckpointThreadNotFoundError({
          operation,
          threadId: input.threadId,
        });
      }

      const maxTurnCount = threadContext.value.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointTurnRangeUnavailableError({
          operation,
          threadId: input.threadId,
          requestedTurnCount: input.toTurnCount,
          availableTurnCount: maxTurnCount,
        });
      }

      let workspaceCwd: string | undefined =
        threadContext.value.worktreePath ?? threadContext.value.workspaceRoot;
      if (input.repositoryId !== undefined) {
        const thread = yield* projectionSnapshotQuery.getThreadShellById(input.threadId);
        workspaceCwd =
          Option.getOrUndefined(thread)?.workspaceMembers?.find(
            (member) => member.repositoryId === input.repositoryId,
          )?.worktreePath ??
          (yield* repositories.getSnapshot.pipe(Effect.orDie)).repositories.find(
            (repository) => repository.repositoryId === input.repositoryId,
          )?.path;
      }
      if (!workspaceCwd) {
        return yield* new CheckpointWorkspacePathMissingError({
          operation,
          threadId: input.threadId,
        });
      }

      const fromCheckpointRef =
        input.fromTurnCount === 0
          ? checkpointRefForThreadTurn(input.threadId, 0)
          : threadContext.value.checkpoints.find(
              (checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount,
            )?.checkpointRef;
      if (!fromCheckpointRef) {
        return yield* new CheckpointRefUnavailableError({
          operation,
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          checkpoint: "from",
        });
      }

      const toCheckpointRef = threadContext.value.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
      )?.checkpointRef;
      if (!toCheckpointRef) {
        return yield* new CheckpointRefUnavailableError({
          operation,
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          checkpoint: "to",
        });
      }

      const adjacentParentRef = chainParentRef(toCheckpointRef);
      const adjacentHeadRef = CheckpointRef.make(`${toCheckpointRef}^2`);
      const hasAdjacentParent =
        input.toTurnCount === input.fromTurnCount + 1 &&
        (yield* checkpointStore.hasCheckpointRef({
          cwd: workspaceCwd,
          checkpointRef: adjacentParentRef,
        }));
      const effectiveFromRef =
        hasAdjacentParent &&
        (yield* checkpointStore.hasCheckpointRef({
          cwd: workspaceCwd,
          checkpointRef: adjacentHeadRef,
        }))
          ? adjacentParentRef
          : fromCheckpointRef;
      const diff = yield* checkpointStore
        .diffCheckpoints({
          cwd: workspaceCwd,
          fromCheckpointRef: effectiveFromRef,
          toCheckpointRef,
          fallbackFromToHead: false,
          ignoreWhitespace,
        })
        .pipe(Effect.withSpan("checkpoint.turnDiff.diffCheckpoints"));

      const turnDiff = buildTurnDiffResult(input, diff);
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointDiffResultInvalidError({
          operation,
          threadId: input.threadId,
        });
      }

      return turnDiff;
    },
  );

  const getFullThreadDiff: CheckpointDiffQuery["Service"]["getFullThreadDiff"] = Effect.fn(
    "CheckpointDiffQuery.getFullThreadDiff",
  )(function* (input) {
    const operation = "CheckpointDiffQuery.getFullThreadDiff";
    const ignoreWhitespace = input.ignoreWhitespace ?? true;
    yield* Effect.annotateCurrentSpan({
      "checkpoint.thread_id": input.threadId,
      "checkpoint.from_turn_count": 0,
      "checkpoint.to_turn_count": input.toTurnCount,
      "checkpoint.ignore_whitespace": ignoreWhitespace,
      "checkpoint.diff_kind": "full-thread",
    });

    if (input.toTurnCount === 0) {
      const emptyDiff = buildTurnDiffResult(
        {
          threadId: input.threadId,
          fromTurnCount: 0,
          toTurnCount: 0,
        },
        "",
      );
      if (!isTurnDiffResult(emptyDiff)) {
        return yield* new CheckpointDiffResultInvalidError({
          operation,
          threadId: input.threadId,
        });
      }
      return emptyDiff satisfies OrchestrationGetFullThreadDiffResult;
    }

    const threadContext = yield* projectionSnapshotQuery
      .getFullThreadDiffContext(input.threadId, input.toTurnCount)
      .pipe(Effect.withSpan("checkpoint.fullThread.lookupContext"));

    if (Option.isNone(threadContext)) {
      return yield* new CheckpointThreadNotFoundError({
        operation,
        threadId: input.threadId,
      });
    }

    if (input.toTurnCount > threadContext.value.latestCheckpointTurnCount) {
      return yield* new CheckpointTurnRangeUnavailableError({
        operation,
        threadId: input.threadId,
        requestedTurnCount: input.toTurnCount,
        availableTurnCount: threadContext.value.latestCheckpointTurnCount,
      });
    }

    const workspaceCwd = threadContext.value.worktreePath ?? threadContext.value.workspaceRoot;
    if (!workspaceCwd) {
      return yield* new CheckpointWorkspacePathMissingError({
        operation,
        threadId: input.threadId,
      });
    }

    if (!threadContext.value.toCheckpointRef) {
      return yield* new CheckpointRefUnavailableError({
        operation,
        threadId: input.threadId,
        turnCount: input.toTurnCount,
        checkpoint: "to",
      });
    }

    const diff = yield* checkpointStore
      .diffCheckpoints({
        cwd: workspaceCwd,
        fromCheckpointRef: checkpointRefForThreadTurn(input.threadId, 0),
        toCheckpointRef: threadContext.value.toCheckpointRef as CheckpointRef,
        fallbackFromToHead: false,
        ignoreWhitespace,
      })
      .pipe(Effect.withSpan("checkpoint.fullThread.diffCheckpoints"));

    const turnDiff = buildTurnDiffResult(
      {
        threadId: input.threadId,
        fromTurnCount: 0,
        toTurnCount: input.toTurnCount,
      },
      diff,
    );
    if (!isTurnDiffResult(turnDiff)) {
      return yield* new CheckpointDiffResultInvalidError({
        operation,
        threadId: input.threadId,
      });
    }

    return turnDiff satisfies OrchestrationGetFullThreadDiffResult;
  });

  const getLineUncommittedDiff: CheckpointDiffQuery["Service"]["getLineUncommittedDiff"] =
    Effect.fn("CheckpointDiffQuery.getLineUncommittedDiff")(function* (input) {
      const resolved = yield* resolveThreadLine(lineRuntimes, legacySessions, input.threadId);
      if (Option.isNone(resolved)) {
        return yield* new CheckpointThreadNotFoundError({
          operation: "CheckpointDiffQuery.getLineUncommittedDiff",
          threadId: input.threadId,
        });
      }
      const line = (yield* lineBranches.listAll).find(
        (candidate) =>
          candidate.repositoryId === resolved.value.homeRepositoryId &&
          candidate.branch === resolved.value.branch,
      );
      if (line === undefined) {
        return yield* new CheckpointRefUnavailableError({
          operation: "CheckpointDiffQuery.getLineUncommittedDiff",
          threadId: input.threadId,
          turnCount: 0,
          checkpoint: "to",
        });
      }
      const repository = (yield* repositories.getSnapshot).repositories.find(
        (candidate) => candidate.repositoryId === resolved.value.homeRepositoryId,
      );
      if (repository === undefined) {
        return yield* new CheckpointWorkspacePathMissingError({
          operation: "CheckpointDiffQuery.getLineUncommittedDiff",
          threadId: input.threadId,
        });
      }
      const diff = yield* checkpointStore.diffCheckpoints({
        cwd: repository.path,
        fromCheckpointRef: CheckpointRef.make(`refs/heads/${resolved.value.branch}`),
        toCheckpointRef: lineSnapshotRef(line.lineRootCommitId),
        fallbackFromToHead: false,
        ignoreWhitespace: input.ignoreWhitespace ?? false,
      });
      return { threadId: input.threadId, diff };
    });

  return CheckpointDiffQuery.of({
    getCheckpointDiff,
    getTurnDiff,
    getFullThreadDiff,
    getLineUncommittedDiff,
  });
});

export const layer = Layer.effect(CheckpointDiffQuery, make);
