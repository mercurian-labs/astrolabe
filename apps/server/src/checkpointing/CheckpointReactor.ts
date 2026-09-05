import { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import {
  CommandId,
  type CheckpointRef,
  EventId,
  MessageId,
  type ProjectId,
  ThreadId,
  TurnId,
  type MercurianCommitId,
  type MercurianRepositoryId,
  type OrchestrationEvent,
  type OrchestrationCheckpointFile,
  type OrchestrationCheckpointRepository,
  type OrchestrationCheckpointSummaryStatus,
  type ProviderRuntimeEvent,
  type SnapshotKind,
  type VcsStatusLocalResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";

import { CheckpointChangesError, enumerateCheckpointChanges } from "./CheckpointChanges.ts";
import { checkpointRefForThreadTurn, resolveThreadWorkspaceCwd } from "./Utils.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import {
  CheckpointReactor,
  type CheckpointReactorShape,
} from "../orchestration/Services/CheckpointReactor.ts";
import { forkParked } from "../serverActivation.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../orchestration/Services/RuntimeReceiptBus.ts";
import { isGitRepository } from "../git/Utils.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { ThreadLineService, type ThreadLineRecord } from "./ThreadLineService.ts";
import { RepositoryStore } from "../mercurian/repositories/RepositoryStore.ts";
import { SlotStore } from "../mercurian/worktreeSlots/SlotStore.ts";
import { SlotRegistry } from "../mercurian/worktreeSlots/SlotRegistry.ts";
import { lineExtraSnapshotRef, SnapshotChain } from "../mercurian/worktreeSlots/SnapshotChain.ts";
import type { WorktreeSlot } from "../mercurian/worktreeSlots/schema.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

type ReactorInput =
  | {
      readonly source: "runtime";
      readonly event: ProviderRuntimeEvent;
    }
  | {
      readonly source: "domain";
      readonly event: OrchestrationEvent;
    };

function toTurnId(value: string | undefined): TurnId | null {
  return value === undefined ? null : TurnId.make(String(value));
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

function checkpointStatusFromRuntime(status: string | undefined): "ready" | "missing" | "error" {
  switch (status) {
    case "failed":
      return "error";
    case "cancelled":
    case "interrupted":
      return "missing";
    case "completed":
    default:
      return "ready";
  }
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverEventId = randomUUID.pipe(Effect.map(EventId.make));
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const projectionTurns = yield* ProjectionTurnRepository;
  const providerService = yield* ProviderService;
  const checkpointStore = yield* CheckpointStore.CheckpointStore;
  const receiptBus = yield* RuntimeReceiptBus;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const gitDriver = yield* GitVcsDriver;
  const threadLines = yield* ThreadLineService;
  const repositories = yield* RepositoryStore;
  const slots = yield* SlotStore;
  const slotRegistry = yield* SlotRegistry;
  const snapshotChain = yield* SnapshotChain;
  const path = yield* Path.Path;

  // A hand rename is adopted for the repository it happened in. Only the home
  // member's name is also the thread's, so only that rename moves thread meta.
  const adoptStanding = Effect.fn("CheckpointReactor.adoptStanding")(function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly lineRootCommitId: MercurianCommitId;
    readonly repositoryId: MercurianRepositoryId;
    readonly repositoryName: string;
    readonly lineBranch: string;
    readonly home: boolean;
    readonly createdAt: string;
  }) {
    const standing = yield* snapshotChain.readStanding(input);
    if (standing._tag !== "renamed") {
      return {
        branch: input.lineBranch,
        departedRef: standing._tag === "departed" ? standing.ref : null,
      };
    }
    yield* snapshotChain.adoptRename({
      lineRootCommitId: input.lineRootCommitId,
      repositoryId: input.repositoryId,
      branch: standing.branch,
    });
    if (input.home) {
      yield* threadLines.updateBranch(input.threadId, standing.branch);
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("line-branch-renamed"),
        threadId: input.threadId,
        branch: standing.branch,
      });
    }
    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: yield* serverCommandId("line-branch-renamed-activity"),
      threadId: input.threadId,
      activity: {
        id: yield* serverEventId,
        tone: "info",
        kind: "line.branch-renamed",
        summary: input.home
          ? `Branch renamed to \`${standing.branch}\` by hand`
          : `Branch renamed to \`${standing.branch}\` by hand in ${input.repositoryName}`,
        payload: {},
        turnId: null,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
    return { branch: standing.branch, departedRef: null };
  });

  const resolveLineBranchTip = Effect.fn("CheckpointReactor.resolveLineBranchTip")(
    function* (input: {
      readonly cwd: string;
      readonly lineRootCommitId: MercurianCommitId;
      readonly repositoryId: MercurianRepositoryId;
      readonly lineBranch: string;
      readonly operation: string;
    }) {
      const resolved = yield* gitDriver.execute({
        operation: input.operation,
        cwd: input.cwd,
        args: ["rev-parse", `refs/heads/${input.lineBranch}^{commit}`],
        allowNonZeroExit: true,
      });
      const oid = resolved.exitCode === 0 ? resolved.stdout.trim() : "";
      return oid.length > 0 ? oid : yield* snapshotChain.lineCommit(input);
    },
  );

  const appendCaptureFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("checkpoint-capture-failure"),
      activityId: serverEventId,
    }).pipe(
      Effect.flatMap(({ commandId, activityId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: activityId,
            tone: "error",
            kind: "checkpoint.capture.failed",
            summary: "Checkpoint capture failed",
            payload: {
              detail: input.detail,
            },
            turnId: input.turnId,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const resolveSessionRuntimeForThread = Effect.fn("resolveSessionRuntimeForThread")(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<Option.Option<{ readonly threadId: ThreadId; readonly cwd: string }>> {
    const sessions = yield* providerService.listSessions();
    const session = sessions.find((entry) => entry.threadId === threadId);
    return session?.cwd
      ? Option.some({ threadId: session.threadId, cwd: session.cwd })
      : Option.none();
  });

  const resolveThreadDetail = Effect.fn("resolveThreadDetail")(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId, { activityKinds: [] })
      .pipe(Effect.map(Option.getOrUndefined));
  });

  // The slot a session's turn runs in: a member on the line's branch, preferring
  // the slot this thread holds a lease on when several qualify.
  const slotForSession = Effect.fn("CheckpointReactor.slotForSession")(function* (
    threadId: ThreadId,
    session: ThreadLineRecord,
  ) {
    const repositoryIds = new Set<string>(
      session.repositories
        .map((repository) => repository.repositoryId)
        .concat(session.homeRepositoryId),
    );
    const candidates = (yield* slots.listAll).filter((candidate) =>
      candidate.members.some(
        (member) =>
          repositoryIds.has(member.repositoryId) && member.currentBranch === session.branch,
      ),
    );
    for (const candidate of candidates) {
      const lease = yield* slotRegistry.lease(candidate.slotId);
      if (
        Option.isSome(lease) &&
        lease.value.holders.some((holder) => holder.threadId === threadId)
      ) {
        return Option.some(candidate);
      }
    }
    return Option.fromNullishOr(candidates[0]);
  });

  const slotForCodingSession = Effect.fn("CheckpointReactor.slotForCodingSession")(function* (
    threadId: ThreadId,
  ) {
    const session = yield* threadLines.resolve(threadId);
    if (Option.isNone(session)) return Option.none<WorktreeSlot>();
    return yield* slotForSession(threadId, session.value);
  });

  interface SessionMember {
    readonly repositoryId: MercurianRepositoryId;
    readonly repositoryName: string;
    readonly cwd: string;
    readonly lineBranch: string;
    /** The member the provider stands in; thread-level facts follow it. */
    readonly home: boolean;
  }

  // Every repository the slot holds, in slot order. Names come from the
  // session's own rows, falling back to the registry for sessions recorded
  // before they existed.
  const sessionMembers = Effect.fn("CheckpointReactor.sessionMembers")(function* (
    session: ThreadLineRecord,
    slot: WorktreeSlot,
    homeCwd: string,
  ) {
    const sessionRepositories = session.repositories;
    const registered = slot.members.some(
      (member) =>
        !sessionRepositories.some((repository) => repository.repositoryId === member.repositoryId),
    )
      ? (yield* repositories.getSnapshot).repositories
      : [];
    const members = slot.members.map((member) => ({
      repositoryId: member.repositoryId,
      repositoryName:
        sessionRepositories.find((repository) => repository.repositoryId === member.repositoryId)
          ?.repositoryName ??
        registered.find((repository) => repository.repositoryId === member.repositoryId)?.name ??
        String(member.repositoryId),
      cwd: path.join(slot.path, member.relativePath),
      lineBranch: member.currentBranch ?? session.branch,
    }));
    const homeIndex = [
      members.findIndex((member) => member.repositoryId === session.homeRepositoryId),
      members.findIndex((member) => member.cwd === homeCwd),
      0,
    ].find((index) => index >= 0)!;
    return members.map((member, index): SessionMember => ({
      ...member,
      home: index === homeIndex,
    }));
  });

  // One member's snapshot: adopt a rename, capture on the chain, read where the
  // branch went, and write the repository's row on the session record.
  const captureMemberSnapshot = Effect.fn("CheckpointReactor.captureMemberSnapshot")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly lineRootCommitId: MercurianCommitId;
      readonly member: SessionMember;
      readonly kind: SnapshotKind;
      readonly ref: CheckpointRef;
      readonly createdAt: string;
    }) {
      const { member } = input;
      const standing = yield* adoptStanding({
        threadId: input.threadId,
        cwd: member.cwd,
        lineRootCommitId: input.lineRootCommitId,
        repositoryId: member.repositoryId,
        repositoryName: member.repositoryName,
        lineBranch: member.lineBranch,
        home: member.home,
        createdAt: input.createdAt,
      });
      const snapshot = yield* snapshotChain.capture({
        cwd: member.cwd,
        lineRootCommitId: input.lineRootCommitId,
        repositoryId: member.repositoryId,
        lineBranch: standing.branch,
        kind: input.kind,
        ref: input.ref,
      });
      const branchMovement = yield* snapshotChain.branchMovement({
        cwd: member.cwd,
        previousOid: snapshot.previousOid,
        lineRootCommitId: input.lineRootCommitId,
        repositoryId: member.repositoryId,
        lineBranch: standing.branch,
      });
      const branchTipOid = yield* resolveLineBranchTip({
        operation: "CheckpointReactor.resolveLineBranchTip",
        cwd: member.cwd,
        lineRootCommitId: input.lineRootCommitId,
        repositoryId: member.repositoryId,
        lineBranch: standing.branch,
      });
      const facts = {
        snapshotOid: snapshot.oid,
        kind: input.kind,
        branchTipOid,
        departedRef: standing.departedRef,
        branchMovement,
      };
      yield* threadLines.recordRepositorySnapshot(input.threadId, member.repositoryId, facts);
      return { member, facts, previousOid: snapshot.previousOid, branchName: standing.branch };
    },
  );

  const resolveThreadProjects = Effect.fn("resolveThreadProjects")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* projectionSnapshotQuery
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    return project ? [project] : [];
  });

  const isGitWorkspace = (cwd: string) => isGitRepository(cwd);

  interface CheckpointFileSummary {
    readonly files: ReadonlyArray<OrchestrationCheckpointFile>;
    readonly status: OrchestrationCheckpointSummaryStatus;
    readonly error?: string;
  }

  const checkpointFiles = Effect.fn("CheckpointReactor.checkpointFiles")(function* (input: {
    readonly cwd: string;
    readonly beforeSnapshotOid: string;
    readonly afterSnapshotOid: string;
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly turnCount: number;
    readonly createdAt: string;
  }): Effect.fn.Return<CheckpointFileSummary> {
    const summary = yield* Effect.result(
      enumerateCheckpointChanges({
        cwd: input.cwd,
        beforeSnapshotOid: input.beforeSnapshotOid,
        afterSnapshotOid: input.afterSnapshotOid,
      }).pipe(Effect.provideService(GitVcsDriver, gitDriver)),
    );
    if (Result.isSuccess(summary)) {
      return { files: summary.success, status: "ready" };
    }
    const status =
      summary.failure._tag === "CheckpointChangesError"
        ? summary.failure.availability
        : ("error" as const);
    const detail =
      summary.failure._tag === "CheckpointChangesError"
        ? summary.failure.detail
        : summary.failure.message;
    yield* appendCaptureFailureActivity({
      threadId: input.threadId,
      turnId: input.turnId,
      detail: `Checkpoint captured, but turn diff summary is unavailable: ${detail}`,
      createdAt: input.createdAt,
    }).pipe(Effect.catch(() => Effect.void));
    yield* Effect.logWarning("failed to derive checkpoint file summary", {
      threadId: input.threadId,
      turnId: input.turnId,
      turnCount: input.turnCount,
      detail,
    });
    return { files: [], status, error: detail };
  });

  const resolveSnapshotOid = Effect.fn("CheckpointReactor.resolveSnapshotOid")(function* (input: {
    readonly cwd: string;
    readonly revision: string;
  }) {
    const result = yield* gitDriver.execute({
      operation: "CheckpointReactor.resolveSnapshotOid",
      cwd: input.cwd,
      args: ["rev-parse", `${input.revision}^{commit}`],
      appendTruncationMarker: false,
    });
    if (result.stdoutTruncated) {
      return yield* new CheckpointChangesError({
        availability: "unavailable",
        detail: "Git truncated the resolved checkpoint snapshot OID.",
      });
    }
    const oid = result.stdout.trim();
    if (oid.length === 0) {
      return yield* new CheckpointChangesError({
        availability: "error",
        detail: `Git did not resolve checkpoint revision ${input.revision}.`,
      });
    }
    return oid;
  });

  // Resolves the workspace CWD for checkpoint operations, preferring the
  // active provider session CWD and falling back to the thread/project config.
  // Returns undefined when no CWD can be determined or the workspace is not
  // a git repository.
  const resolveCheckpointCwd = Effect.fn("resolveCheckpointCwd")(function* (input: {
    readonly threadId: ThreadId;
    readonly thread: { readonly projectId: ProjectId; readonly worktreePath: string | null };
    readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly workspaceRoot: string }>;
    readonly preferSessionRuntime: boolean;
  }): Effect.fn.Return<string | undefined> {
    const fromSession = yield* resolveSessionRuntimeForThread(input.threadId);
    const fromThread = resolveThreadWorkspaceCwd({
      thread: input.thread,
      projects: input.projects,
    });

    const cwd = input.preferSessionRuntime
      ? (Option.match(fromSession, {
          onNone: () => undefined,
          onSome: (runtime) => runtime.cwd,
        }) ?? fromThread)
      : (fromThread ??
        Option.match(fromSession, {
          onNone: () => undefined,
          onSome: (runtime) => runtime.cwd,
        }));

    if (!cwd) {
      return undefined;
    }
    if (!isGitWorkspace(cwd)) {
      return undefined;
    }
    return cwd;
  });

  // Shared tail for both capture paths: creates the git checkpoint ref, diffs
  // it against the previous turn, then dispatches the domain events to update
  // the orchestration read model.
  const captureAndDispatchCheckpoint = Effect.fn("captureAndDispatchCheckpoint")(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly requestMessageId?: MessageId | null;
    readonly thread: {
      readonly messages: ReadonlyArray<{
        readonly id: MessageId;
        readonly role: string;
        readonly turnId: TurnId | null;
      }>;
    };
    readonly cwd: string;
    readonly turnCount: number;
    readonly status: "ready" | "missing" | "error";
    readonly assistantMessageId: MessageId | undefined;
    readonly createdAt: string;
    readonly capture?: boolean;
    readonly partial?: boolean;
    readonly fromCheckpointRef?: CheckpointRef;
    readonly snapshotKind?: "settled" | "partial" | "recovery" | "external" | "curated";
    readonly departedRef?: string;
    readonly branchMovement?:
      | { readonly kind: "unchanged" }
      | { readonly kind: "added"; readonly count: number }
      | { readonly kind: "rewritten" };
    readonly repositories?: ReadonlyArray<OrchestrationCheckpointRepository>;
    readonly files?: ReadonlyArray<OrchestrationCheckpointFile>;
    readonly summaryStatus?: OrchestrationCheckpointSummaryStatus;
    readonly summaryError?: string;
    /** The caller already captured and summarized repository members. */
    readonly prepared?: boolean;
  }) {
    const projectedTurn =
      input.requestMessageId === undefined
        ? yield* projectionTurns.getByTurnId({ threadId: input.threadId, turnId: input.turnId })
        : Option.none();
    const requestMessageId =
      input.requestMessageId ?? Option.getOrUndefined(projectedTurn)?.pendingMessageId;
    const fromTurnCount = Math.max(0, input.turnCount - 1);
    const fromCheckpointRef =
      input.fromCheckpointRef ?? checkpointRefForThreadTurn(input.threadId, fromTurnCount);
    const targetCheckpointRef = checkpointRefForThreadTurn(input.threadId, input.turnCount);

    let status = input.status;
    let files = input.files ?? [];
    let summaryStatus = input.summaryStatus;
    let summaryError = input.summaryError;

    if (input.prepared !== true) {
      const fromCheckpointExists = yield* checkpointStore
        .hasCheckpointRef({ cwd: input.cwd, checkpointRef: fromCheckpointRef })
        .pipe(Effect.orElseSucceed(() => false));
      if (!fromCheckpointExists) {
        yield* Effect.logWarning("checkpoint capture missing pre-turn baseline", {
          threadId: input.threadId,
          turnId: input.turnId,
          fromTurnCount,
        });
      }

      let captured = input.capture === false;
      if (input.capture !== false) {
        const captureResult = yield* Effect.result(
          checkpointStore.captureCheckpoint({
            cwd: input.cwd,
            checkpointRef: targetCheckpointRef,
          }),
        );
        if (Result.isFailure(captureResult)) {
          status = "error";
          summaryStatus = "unavailable";
          summaryError = captureResult.failure.message;
          yield* appendCaptureFailureActivity({
            threadId: input.threadId,
            turnId: input.turnId,
            detail: captureResult.failure.message,
            createdAt: input.createdAt,
          }).pipe(Effect.catch(() => Effect.void));
        } else {
          captured = true;
        }
      }
      if (captured) {
        // Refresh the workspace entry index so the @-mention file picker
        // reflects files created or deleted during this turn.
        yield* workspaceEntries.refresh(input.cwd);
        if (input.files === undefined) {
          const pair = yield* Effect.result(
            Effect.all({
              beforeSnapshotOid: resolveSnapshotOid({
                cwd: input.cwd,
                revision: fromCheckpointRef,
              }),
              afterSnapshotOid: resolveSnapshotOid({
                cwd: input.cwd,
                revision: targetCheckpointRef,
              }),
            }),
          );
          if (Result.isFailure(pair)) {
            summaryStatus =
              pair.failure._tag === "CheckpointChangesError" ? pair.failure.availability : "error";
            summaryError =
              pair.failure._tag === "CheckpointChangesError"
                ? pair.failure.detail
                : pair.failure.message;
            yield* appendCaptureFailureActivity({
              threadId: input.threadId,
              turnId: input.turnId,
              detail: `Checkpoint captured, but its snapshot pair is unavailable: ${summaryError}`,
              createdAt: input.createdAt,
            }).pipe(Effect.catch(() => Effect.void));
          } else {
            const summary = yield* checkpointFiles({
              cwd: input.cwd,
              beforeSnapshotOid: pair.success.beforeSnapshotOid,
              afterSnapshotOid: pair.success.afterSnapshotOid,
              threadId: input.threadId,
              turnId: input.turnId,
              turnCount: input.turnCount,
              createdAt: input.createdAt,
            });
            files = summary.files;
            summaryStatus = summary.status;
            summaryError = summary.error;
          }
        }
      }
    }

    summaryStatus ??= "ready";

    const assistantMessageId =
      input.assistantMessageId ??
      input.thread.messages
        .toReversed()
        .find((entry) => entry.role === "assistant" && entry.turnId === input.turnId)?.id ??
      MessageId.make(`assistant:${input.turnId}`);

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.diff.complete",
      commandId: yield* serverCommandId("checkpoint-turn-diff-complete"),
      threadId: input.threadId,
      turnId: input.turnId,
      ...(requestMessageId == null ? {} : { requestMessageId }),
      captureTerminal: true,
      completedAt: input.createdAt,
      checkpointRef: targetCheckpointRef,
      status,
      files,
      ...(input.repositories === undefined ? {} : { repositories: input.repositories }),
      summaryStatus,
      ...(summaryError === undefined ? {} : { summaryError }),
      assistantMessageId,
      checkpointTurnCount: input.turnCount,
      createdAt: input.createdAt,
      ...(input.partial === undefined ? {} : { partial: input.partial }),
      ...(input.snapshotKind === undefined ? {} : { snapshotKind: input.snapshotKind }),
      ...(input.departedRef === undefined ? {} : { departedRef: input.departedRef }),
      ...(input.branchMovement === undefined ? {} : { branchMovement: input.branchMovement }),
    });
    yield* receiptBus.publish({
      type: "checkpoint.diff.finalized",
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      checkpointRef: targetCheckpointRef,
      status,
      createdAt: input.createdAt,
    });
    yield* receiptBus.publish({
      type: "turn.processing.quiesced",
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      createdAt: input.createdAt,
    });

    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: yield* serverCommandId("checkpoint-captured-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.make(yield* randomUUID),
        tone: "info",
        kind: "checkpoint.captured",
        summary: "Checkpoint captured",
        payload: {
          turnCount: input.turnCount,
          status,
          summaryStatus,
          ...(summaryError === undefined ? {} : { summaryError }),
          ...(input.partial === undefined ? {} : { partial: input.partial }),
          ...(input.snapshotKind === undefined ? {} : { snapshotKind: input.snapshotKind }),
          ...(input.departedRef === undefined ? {} : { departedRef: input.departedRef }),
          ...(input.branchMovement === undefined ? {} : { branchMovement: input.branchMovement }),
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const captureCheckpointForTurn = Effect.fn("CheckpointReactor.captureCheckpointForTurn")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly thread: {
        readonly messages: ReadonlyArray<{
          readonly id: MessageId;
          readonly role: string;
          readonly turnId: TurnId | null;
        }>;
      };
      readonly cwd: string;
      readonly turnCount: number;
      readonly settled: boolean;
      readonly status: "ready" | "missing" | "error";
      readonly assistantMessageId: MessageId | undefined;
      readonly createdAt: string;
    }) {
      const projectedTurn = yield* projectionTurns.getByTurnId({
        threadId: input.threadId,
        turnId: input.turnId,
      });
      const requestMessageId = Option.getOrUndefined(projectedTurn)?.pendingMessageId ?? null;
      const session = yield* threadLines.resolve(input.threadId);
      const slot = Option.isSome(session)
        ? Option.getOrUndefined(yield* slotForSession(input.threadId, session.value))
        : undefined;

      const checkpointRef = checkpointRefForThreadTurn(input.threadId, input.turnCount);
      const capture =
        Option.isSome(session) && slot?.currentLineRootCommitId !== null && slot !== undefined
          ? Effect.gen(function* () {
              const kind = input.settled ? "settled" : "partial";
              const lineRootCommitId = slot.currentLineRootCommitId!;
              const members = yield* sessionMembers(session.value, slot, input.cwd);
              const attempts = yield* Effect.forEach(members, (member) =>
                Effect.result(
                  captureMemberSnapshot({
                    threadId: input.threadId,
                    lineRootCommitId,
                    member,
                    kind,
                    ref: checkpointRef,
                    createdAt: input.createdAt,
                  }),
                ).pipe(Effect.map((result) => ({ member, result }))),
              );
              const successful = attempts.flatMap((attempt) =>
                Result.isSuccess(attempt.result) ? [attempt.result.success] : [],
              );
              const home = successful.find((result) => result.member.home);
              // The session row carries the home member's facts; a departure
              // anywhere marks the turn departed, naming the first place it went.
              const departedRef =
                successful.find((result) => result.facts.departedRef !== null)?.facts.departedRef ??
                null;
              if (home !== undefined) {
                yield* threadLines.recordSnapshot(input.threadId, {
                  ...home.facts,
                  departedRef,
                });
              }
              const previousTurnRef = checkpointRefForThreadTurn(
                input.threadId,
                Math.max(0, input.turnCount - 1),
              );
              const groups = yield* Effect.forEach(attempts, ({ member, result: attempt }) =>
                Effect.gen(function* () {
                  if (Result.isFailure(attempt)) {
                    const detail = attempt.failure.message;
                    yield* appendCaptureFailureActivity({
                      threadId: input.threadId,
                      turnId: input.turnId,
                      detail: `Checkpoint capture failed in ${member.repositoryName}: ${detail}`,
                      createdAt: input.createdAt,
                    }).pipe(Effect.catch(() => Effect.void));
                    return {
                      repositoryId: member.repositoryId,
                      repositoryName: member.repositoryName,
                      files: [],
                      captureStatus: "error",
                      captureError: detail,
                      summaryStatus: "unavailable",
                      summaryError: "Snapshot unavailable; change summary was not attempted.",
                    } satisfies OrchestrationCheckpointRepository;
                  }
                  const captured = attempt.success;
                  yield* workspaceEntries.refresh(captured.member.cwd);
                  const before =
                    captured.previousOid === null
                      ? yield* Effect.result(
                          resolveSnapshotOid({
                            cwd: captured.member.cwd,
                            revision: previousTurnRef,
                          }),
                        )
                      : Result.succeed(captured.previousOid);
                  const summary = Result.isFailure(before)
                    ? {
                        files: [],
                        status:
                          before.failure._tag === "CheckpointChangesError"
                            ? before.failure.availability
                            : ("error" as const),
                        error:
                          before.failure._tag === "CheckpointChangesError"
                            ? before.failure.detail
                            : before.failure.message,
                      }
                    : yield* checkpointFiles({
                        cwd: captured.member.cwd,
                        beforeSnapshotOid: before.success,
                        afterSnapshotOid: captured.facts.snapshotOid,
                        threadId: input.threadId,
                        turnId: input.turnId,
                        turnCount: input.turnCount,
                        createdAt: input.createdAt,
                      });
                  if (Result.isFailure(before)) {
                    const detail =
                      before.failure._tag === "CheckpointChangesError"
                        ? before.failure.detail
                        : before.failure.message;
                    yield* appendCaptureFailureActivity({
                      threadId: input.threadId,
                      turnId: input.turnId,
                      detail: `Checkpoint captured in ${captured.member.repositoryName}, but its before snapshot is unavailable: ${detail}`,
                      createdAt: input.createdAt,
                    }).pipe(Effect.catch(() => Effect.void));
                  }
                  return {
                    repositoryId: captured.member.repositoryId,
                    repositoryName: captured.member.repositoryName,
                    files: summary.files,
                    ...(Result.isSuccess(before) ? { beforeSnapshotOid: before.success } : {}),
                    afterSnapshotOid: captured.facts.snapshotOid,
                    branchName: captured.branchName,
                    branchTipOid: captured.facts.branchTipOid,
                    captureStatus: "ready",
                    summaryStatus: summary.status,
                    ...(summary.error === undefined ? {} : { summaryError: summary.error }),
                    ...(captured.facts.departedRef === null
                      ? {}
                      : { departedRef: captured.facts.departedRef }),
                    branchMovement: captured.facts.branchMovement,
                  } satisfies OrchestrationCheckpointRepository;
                }),
              );
              const homeGroup =
                groups.find((group) => group.repositoryId === session.value.homeRepositoryId) ??
                groups[0]!;
              const failedSummary = groups.find((group) => group.summaryStatus === "error");
              const unavailableSummary = groups.find(
                (group) => group.summaryStatus === "unavailable",
              );
              const aggregateSummary = failedSummary ?? unavailableSummary;
              const dispatchCwd = home?.member.cwd ?? successful[0]?.member.cwd ?? input.cwd;
              yield* captureAndDispatchCheckpoint({
                requestMessageId,
                threadId: input.threadId,
                turnId: input.turnId,
                thread: input.thread,
                cwd: dispatchCwd,
                turnCount: input.turnCount,
                status: homeGroup.captureStatus === "error" ? "error" : input.status,
                assistantMessageId: input.assistantMessageId,
                createdAt: input.createdAt,
                capture: false,
                files: homeGroup.files,
                repositories: groups,
                summaryStatus: aggregateSummary?.summaryStatus ?? "ready",
                ...(aggregateSummary?.summaryError === undefined
                  ? {}
                  : { summaryError: aggregateSummary.summaryError }),
                prepared: true,
                ...(kind === "partial" ? { partial: true } : {}),
                snapshotKind: kind,
                ...(departedRef === null ? {} : { departedRef }),
                ...(home === undefined ? {} : { branchMovement: home.facts.branchMovement }),
              });
            })
          : captureAndDispatchCheckpoint({
              requestMessageId,
              threadId: input.threadId,
              turnId: input.turnId,
              thread: input.thread,
              cwd: input.cwd,
              turnCount: input.turnCount,
              status: input.status,
              assistantMessageId: input.assistantMessageId,
              createdAt: input.createdAt,
            });

      yield* Option.isSome(session) && slot !== undefined
        ? capture.pipe(
            Effect.ensuring(
              slotRegistry.release(slot.slotId, { kind: "turn", threadId: input.threadId }).pipe(
                Effect.flatMap((free) =>
                  free
                    ? Effect.forEach(
                        slot.members,
                        (member) => {
                          const worktreePath = path.join(slot.path, member.relativePath);
                          return gitDriver.execute({
                            operation: "CheckpointReactor.releaseSlot",
                            cwd: worktreePath,
                            args: ["worktree", "unlock", worktreePath],
                            allowNonZeroExit: true,
                          });
                        },
                        { discard: true },
                      )
                    : Effect.void,
                ),
                Effect.ignoreCause({ log: true }),
              ),
            ),
          )
        : capture;
    },
  );

  const recordTerminalCaptureFailure = Effect.fn("CheckpointReactor.recordTerminalCaptureFailure")(
    function* (threadId: ThreadId, turnId: TurnId, detail: string, createdAt: string) {
      const thread = yield* resolveThreadDetail(threadId);
      if (thread === undefined || thread === null) return;
      const existing = thread.checkpoints.find((checkpoint) => checkpoint.turnId === turnId);
      yield* captureAndDispatchCheckpoint({
        threadId,
        turnId,
        thread,
        cwd: "",
        turnCount:
          existing?.checkpointTurnCount ??
          thread.checkpoints.reduce(
            (maximum, checkpoint) => Math.max(maximum, checkpoint.checkpointTurnCount),
            0,
          ) + 1,
        status: "error",
        assistantMessageId: undefined,
        createdAt,
        capture: false,
        prepared: true,
        files: [],
        summaryStatus: "unavailable",
        summaryError: detail,
      });
    },
  );

  // Captures a real git checkpoint when a turn completes via a runtime event.
  const captureCheckpointFromTurnCompletion = Effect.fn("captureCheckpointFromTurnCompletion")(
    function* (event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>) {
      const turnId = toTurnId(event.turnId);
      if (!turnId) {
        return;
      }

      const thread = yield* resolveThreadDetail(event.threadId);
      if (!thread) {
        return;
      }

      // When a primary turn is active, only that turn may produce completion checkpoints.
      if (thread.session?.activeTurnId && !sameId(thread.session.activeTurnId, turnId)) {
        return;
      }

      // Only skip if a real (non-placeholder) checkpoint already exists for this turn.
      // ProviderRuntimeIngestion may insert placeholder entries with status "missing"
      // before this reactor runs; those must not prevent real git capture.
      if (
        thread.checkpoints.some(
          (checkpoint) => checkpoint.turnId === turnId && checkpoint.status !== "missing",
        )
      ) {
        return;
      }

      const projects = yield* resolveThreadProjects(thread.projectId);
      const checkpointCwd = yield* resolveCheckpointCwd({
        threadId: thread.id,
        thread,
        projects,
        preferSessionRuntime: true,
      });
      if (!checkpointCwd) {
        return;
      }

      // If a placeholder checkpoint exists for this turn, reuse its turn count
      // instead of incrementing past it.
      const existingPlaceholder = thread.checkpoints.find(
        (checkpoint) => checkpoint.turnId === turnId && checkpoint.status === "missing",
      );
      const currentTurnCount = thread.checkpoints.reduce(
        (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
        0,
      );
      const nextTurnCount = existingPlaceholder
        ? existingPlaceholder.checkpointTurnCount
        : currentTurnCount + 1;

      yield* captureCheckpointForTurn({
        threadId: thread.id,
        turnId,
        thread,
        cwd: checkpointCwd,
        turnCount: nextTurnCount,
        settled: event.payload.state === "completed",
        status: checkpointStatusFromRuntime(event.payload.state),
        assistantMessageId: undefined,
        createdAt: event.createdAt,
      });
    },
  );

  // ProviderRuntimeIngestion creates placeholder checkpoints on turn.diff.updated
  // events from the Codex runtime. Plain threads replace the placeholder with a
  // real git checkpoint immediately; a thread on a line leaves it missing until
  // the settled capture runs on turn completion.
  const captureCheckpointFromPlaceholder = Effect.fn("captureCheckpointFromPlaceholder")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>,
  ) {
    const { threadId, turnId, checkpointTurnCount, status } = event.payload;

    // Only replace placeholders; skip events from our own real captures.
    if (status !== "missing" || event.payload.partial === true) {
      return;
    }

    const thread = yield* resolveThreadDetail(threadId);
    if (!thread) {
      yield* Effect.logWarning("checkpoint capture from placeholder skipped: thread not found", {
        threadId,
      });
      return;
    }

    const line = yield* threadLines.resolve(threadId);
    if (Option.isSome(line)) {
      yield* Effect.logDebug(
        "checkpoint placeholder left unsettled: a line's turn settles on turn completion",
        { threadId, turnId },
      );
      return;
    }

    // If a real checkpoint already exists for this turn, skip.
    if (
      thread.checkpoints.some(
        (checkpoint) => checkpoint.turnId === turnId && checkpoint.status !== "missing",
      )
    ) {
      yield* Effect.logDebug(
        "checkpoint capture from placeholder skipped: real checkpoint already exists",
        { threadId, turnId },
      );
      return;
    }

    const projects = yield* resolveThreadProjects(thread.projectId);
    const checkpointCwd = yield* resolveCheckpointCwd({
      threadId,
      thread,
      projects,
      preferSessionRuntime: true,
    });
    if (!checkpointCwd) {
      return;
    }

    yield* captureCheckpointForTurn({
      threadId,
      turnId,
      thread,
      cwd: checkpointCwd,
      turnCount: checkpointTurnCount,
      settled: true,
      status: "ready",
      assistantMessageId: event.payload.assistantMessageId ?? undefined,
      createdAt: event.payload.completedAt,
    });
  });

  // A turn opens with a capture too, per member, written only where the tree
  // or HEAD moved since the chain's last snapshot there.
  const captureExternalSnapshot = Effect.fn("CheckpointReactor.captureExternalSnapshot")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly cwd: string;
      readonly createdAt: string;
    }) {
      const session = yield* threadLines.resolve(input.threadId);
      if (Option.isNone(session)) return;
      const slot = Option.getOrUndefined(yield* slotForSession(input.threadId, session.value));
      if (slot?.currentLineRootCommitId === null || slot === undefined) return;
      const lineRootCommitId = slot.currentLineRootCommitId;
      const members = yield* sessionMembers(session.value, slot, input.cwd);
      const drifted = yield* Effect.filter(members, (member) =>
        snapshotChain.isDrifted({
          cwd: member.cwd,
          lineRootCommitId,
          lineBranch: member.lineBranch,
        }),
      );
      if (drifted.length === 0) return;
      const capturedAt = yield* DateTime.now;
      const results = yield* Effect.forEach(drifted, (member) =>
        captureMemberSnapshot({
          threadId: input.threadId,
          lineRootCommitId,
          member,
          kind: "external",
          ref: lineExtraSnapshotRef(lineRootCommitId, "external", capturedAt),
          createdAt: input.createdAt,
        }),
      );
      const home = results.find((result) => result.member.home);
      if (home !== undefined) {
        yield* threadLines.recordSnapshot(input.threadId, {
          ...home.facts,
          departedRef:
            results.find((result) => result.facts.departedRef !== null)?.facts.departedRef ?? null,
        });
      }
      yield* orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: yield* serverCommandId("checkpoint-external"),
        threadId: input.threadId,
        activity: {
          id: yield* serverEventId,
          tone: "info",
          kind: "checkpoint.external",
          summary: "Changes outside a turn were snapshotted",
          payload: {},
          turnId: null,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });
    },
  );

  // The pre-turn baseline (turn/0) lands in every member of a session's slot,
  // then the opening capture records anything that changed since the chain's
  // last snapshot.
  const ensurePreTurnBaseline = Effect.fn("CheckpointReactor.ensurePreTurnBaseline")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly thread: {
        readonly checkpoints: ReadonlyArray<{ readonly checkpointTurnCount: number }>;
      };
      readonly cwd: string;
      readonly createdAt: string;
    }) {
      const currentTurnCount = input.thread.checkpoints.reduce(
        (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
        0,
      );
      const baselineCheckpointRef = checkpointRefForThreadTurn(input.threadId, currentTurnCount);
      const sessionSlot = yield* slotForCodingSession(input.threadId);
      const cwds = Option.isSome(sessionSlot)
        ? sessionSlot.value.members.map((member) =>
            path.join(sessionSlot.value.path, member.relativePath),
          )
        : [input.cwd];
      let captured = false;
      for (const cwd of cwds) {
        const exists = yield* checkpointStore.hasCheckpointRef({
          cwd,
          checkpointRef: baselineCheckpointRef,
        });
        if (exists) continue;
        yield* checkpointStore.captureCheckpoint({ cwd, checkpointRef: baselineCheckpointRef });
        captured = true;
      }
      if (captured) {
        yield* receiptBus.publish({
          type: "checkpoint.baseline.captured",
          threadId: input.threadId,
          checkpointTurnCount: currentTurnCount,
          checkpointRef: baselineCheckpointRef,
          createdAt: input.createdAt,
        });
      }
      yield* captureExternalSnapshot({
        threadId: input.threadId,
        cwd: input.cwd,
        createdAt: input.createdAt,
      });
    },
  );

  const ensurePreTurnBaselineFromTurnStart = Effect.fn("ensurePreTurnBaselineFromTurnStart")(
    function* (event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>) {
      const turnId = toTurnId(event.turnId);
      if (!turnId) {
        return;
      }

      const thread = yield* resolveThreadDetail(event.threadId);
      if (!thread) {
        return;
      }

      const projects = yield* resolveThreadProjects(thread.projectId);
      const checkpointCwd = yield* resolveCheckpointCwd({
        threadId: thread.id,
        thread,
        projects,
        preferSessionRuntime: false,
      });
      if (!checkpointCwd) {
        return;
      }

      yield* ensurePreTurnBaseline({
        threadId: thread.id,
        thread,
        cwd: checkpointCwd,
        createdAt: event.createdAt,
      });
    },
  );

  const refreshLocalGitStatusFromTurnCompletion = Effect.fn(
    "refreshLocalGitStatusFromTurnCompletion",
  )(function* (event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>) {
    const sessionRuntime = yield* resolveSessionRuntimeForThread(event.threadId);
    if (Option.isNone(sessionRuntime)) {
      return;
    }

    const local = yield* vcsStatusBroadcaster.refreshLocalStatus(sessionRuntime.value.cwd).pipe(
      Effect.catch((error) =>
        Effect.logWarning("failed to refresh local git status after turn completion", {
          threadId: event.threadId,
          turnId: event.turnId ?? null,
          cwd: sessionRuntime.value.cwd,
          detail: error.message,
        }).pipe(Effect.as(null)),
      ),
    );
    if (local !== null && Option.isNone(yield* threadLines.resolve(event.threadId))) {
      yield* followWorktreeBranchDrift({
        threadId: event.threadId,
        cwd: sessionRuntime.value.cwd,
        local,
      });
    }
  });

  // A `git checkout` run inside a thread's dedicated worktree (by an agent or
  // the user) bypasses T3's commands, so the thread's recorded branch goes
  // stale. Since #4460 the client only attributes PR state to a thread when
  // the checked-out branch equals the recorded one, so stale metadata silently
  // orphans the thread's PR. Follow the drift here: adopt the checked-out
  // branch as the thread's branch, but only when the worktree belongs to
  // exactly this thread — for shared cwds the strict matching is the point.
  const followWorktreeBranchDrift = Effect.fn("followWorktreeBranchDrift")(function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly local: VcsStatusLocalResult;
  }) {
    // Detached HEAD has no branch to adopt; a temporary placeholder checkout
    // means the first-turn auto-rename is still in flight — don't race it.
    const checkedOutBranch = input.local.refName;
    if (checkedOutBranch === null || isTemporaryWorktreeBranch(checkedOutBranch)) {
      return;
    }

    yield* Effect.gen(function* () {
      const thread = yield* projectionSnapshotQuery
        .getThreadShellById(input.threadId)
        .pipe(Effect.map(Option.getOrUndefined));
      if (
        !thread ||
        thread.branch === null ||
        thread.branch === checkedOutBranch ||
        thread.worktreePath === null ||
        thread.worktreePath !== input.cwd ||
        isTemporaryWorktreeBranch(thread.branch)
      ) {
        return;
      }

      const shell = yield* projectionSnapshotQuery.getShellSnapshot();
      const worktreeIsShared = shell.threads.some(
        (other) => other.id !== thread.id && other.worktreePath === thread.worktreePath,
      );
      if (worktreeIsShared) {
        return;
      }

      // expectedBranch makes this a compare-and-swap in the decider: if the
      // recorded branch moved between our read and the dispatch (rename,
      // concurrent drift-follow), the stale update is dropped.
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("worktree-branch-drift"),
        threadId: thread.id,
        branch: checkedOutBranch,
        expectedBranch: thread.branch,
      });
      yield* Effect.logInfo("thread branch followed worktree checkout", {
        threadId: thread.id,
        previousBranch: thread.branch,
        branch: checkedOutBranch,
      });
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("failed to follow worktree branch drift", {
          threadId: input.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );
  });

  const ensurePreTurnBaselineFromDomainTurnStart = Effect.fn(
    "ensurePreTurnBaselineFromDomainTurnStart",
  )(function* (
    event: Extract<
      OrchestrationEvent,
      { type: "thread.turn-start-requested" | "thread.message-sent" }
    >,
  ) {
    if (event.type === "thread.message-sent") {
      if (
        event.payload.role !== "user" ||
        event.payload.streaming ||
        event.payload.turnId !== null
      ) {
        return;
      }
    }

    const threadId = event.payload.threadId;
    const thread = yield* resolveThreadDetail(threadId);
    if (!thread) {
      return;
    }

    const projects = yield* resolveThreadProjects(thread.projectId);
    const checkpointCwd = yield* resolveCheckpointCwd({
      threadId,
      thread,
      projects,
      preferSessionRuntime: false,
    });
    if (!checkpointCwd) {
      return;
    }

    yield* ensurePreTurnBaseline({
      threadId,
      thread,
      cwd: checkpointCwd,
      createdAt: event.occurredAt,
    });
  });

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (event: OrchestrationEvent) {
    if (event.type === "thread.turn-start-requested" || event.type === "thread.message-sent") {
      yield* ensurePreTurnBaselineFromDomainTurnStart(event);
      return;
    }

    // A mid-turn provider diff creates a missing placeholder. Plain threads replace
    // it immediately; a thread on a line keeps the marker and settles on turn.completed.
    if (event.type === "thread.turn-diff-completed") {
      yield* captureCheckpointFromPlaceholder(event).pipe(
        Effect.catch((error) =>
          Effect.flatMap(nowIso, (createdAt) =>
            appendCaptureFailureActivity({
              threadId: event.payload.threadId,
              turnId: event.payload.turnId,
              detail: error.message,
              createdAt,
            }).pipe(Effect.catch(() => Effect.void)),
          ),
        ),
      );
    }
  });

  const processRuntimeEvent = Effect.fn("processRuntimeEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    if (event.type === "turn.started") {
      yield* ensurePreTurnBaselineFromTurnStart(event);
      return;
    }
    if (event.type === "turn.completed") {
      const turnId = toTurnId(event.turnId);
      yield* refreshLocalGitStatusFromTurnCompletion(event);
      yield* captureCheckpointFromTurnCompletion(event).pipe(
        Effect.catch((error) =>
          Effect.flatMap(nowIso, (createdAt) =>
            (turnId === null
              ? Effect.void
              : recordTerminalCaptureFailure(event.threadId, turnId, error.message, createdAt)
            ).pipe(
              Effect.andThen(
                appendCaptureFailureActivity({
                  threadId: event.threadId,
                  turnId,
                  detail: error.message,
                  createdAt,
                }),
              ),
              Effect.catch(() => Effect.void),
            ),
          ),
        ),
      );
      return;
    }
  });

  const processInput = (input: ReactorInput) =>
    input.source === "domain" ? processDomainEvent(input.event) : processRuntimeEvent(input.event);

  const processInputSafely = (input: ReactorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("checkpoint reactor failed to process input", {
          source: input.source,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: CheckpointReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.turn-start-requested" &&
          event.type !== "thread.message-sent" &&
          event.type !== "thread.turn-diff-completed"
        ) {
          return Effect.void;
        }
        return worker.enqueue({ source: "domain", event });
      }),
    );

    yield* forkParked(
      Stream.runForEach(providerService.streamEvents, (event) => {
        if (event.type !== "turn.started" && event.type !== "turn.completed") {
          return Effect.void;
        }
        return worker.enqueue({ source: "runtime", event });
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies CheckpointReactorShape;
});

export const CheckpointReactorLive = Layer.effect(CheckpointReactor, make);
