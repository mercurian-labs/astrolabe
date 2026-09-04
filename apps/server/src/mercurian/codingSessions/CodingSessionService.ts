import {
  CodingSessionBlockedError,
  CommandId,
  EventId,
  isProviderAvailable,
  MessageId,
  MercurianCommitId,
  PlanTurnActiveError,
  type MercurianStartCodingSessionInput,
  type MercurianStartCodingSessionResult,
  type ServerProvider,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../../orchestration/Services/ThreadDeletionReactor.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { TerminalManager } from "../../terminal/Manager.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import type { RepositoryScript } from "../repositories/schema.ts";
import { CommitId } from "../commitTree/schema.ts";
import { MemorySourceStore } from "../memory/MemorySourceStore.ts";
import { memoryAppendix } from "../assistant/PlanningPrompt.ts";
import { lineRootCommitIdFor } from "../commitTree/LineBranchReactor.ts";
import { makeLineBranchEnsurer } from "../commitTree/ensureLineBranch.ts";
import { SlotService, SlotServiceError } from "../worktreeSlots/SlotService.ts";
import { projectWorkingRepositories } from "../worktreeSlots/projectWorkingRepositories.ts";
import type { WorktreeSlotId } from "../worktreeSlots/schema.ts";

export class CodingSessionService extends Context.Service<
  CodingSessionService,
  {
    readonly start: (
      input: MercurianStartCodingSessionInput,
    ) => Effect.Effect<MercurianStartCodingSessionResult, object>;
  }
>()("t3/mercurian/codingSessions/CodingSessionService") {}

export function codingSessionProviderRefusal(
  provider: ServerProvider | undefined,
  model: string,
): CodingSessionBlockedError["reason"] | null {
  if (
    provider === undefined ||
    !isProviderAvailable(provider) ||
    !provider.enabled ||
    !provider.installed
  ) {
    return "no-instance";
  }
  return provider.models.some((candidate) => candidate.slug === model) ? null : "model-unavailable";
}

export function withCodingSessionBirthCompensation<A, E, R, E2, R2>(
  birth: Effect.Effect<A, E, R>,
  cleanup: Effect.Effect<unknown, E2, R2>,
): Effect.Effect<A, E, R | R2> {
  return birth.pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit)
        ? Effect.uninterruptible(cleanup).pipe(Effect.ignoreCause())
        : Effect.void,
    ),
  );
}

const blocked = (reason: CodingSessionBlockedError["reason"]) =>
  new CodingSessionBlockedError({ reason });

const setupFailureDetail = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "message" in error.cause &&
    typeof error.cause.message === "string"
  ) {
    return error.cause.message;
  }
  return error instanceof Error ? error.message : String(error);
};

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const planning = yield* PlanningStore.PlanningStore;
  const repositories = yield* RepositoryStore;
  const providers = yield* ProviderRegistry;
  const providerService = yield* ProviderService;
  const projections = yield* ProjectionSnapshotQuery;
  const orchestration = yield* OrchestrationEngineService;
  const vcsStatus = yield* VcsStatusBroadcaster;
  const terminals = yield* TerminalManager;
  const deletionReactor = yield* ThreadDeletionReactor;
  const planTurns = yield* PlanTurnRegistry;
  const slotService = yield* SlotService;
  const path = yield* Path.Path;
  const memorySources = yield* MemorySourceStore;
  const lineBranchEnsurer = yield* makeLineBranchEnsurer;

  const uuid = crypto.randomUUIDv4;
  const commandId = (tag: string) =>
    uuid.pipe(Effect.map((id) => CommandId.make(`server:coding-session-${tag}:${id}`)));

  const appendSetupActivity = Effect.fn("CodingSessionService.appendSetupActivity")(function* (
    threadId: ThreadId,
    kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed",
    summary: string,
    tone: "info" | "error",
    payload: Record<string, unknown>,
    createdAt: string,
  ) {
    yield* orchestration.dispatch({
      type: "thread.activity.append",
      commandId: yield* commandId("setup-activity"),
      threadId,
      activity: {
        id: EventId.make(yield* uuid),
        kind,
        summary,
        tone,
        payload,
        turnId: null,
        createdAt,
      },
      createdAt,
    });
  });

  const launchSetupScript = Effect.fn("CodingSessionService.launchSetupScript")(function* (
    threadId: ThreadId,
    repositoryId: string,
    repositoryPath: string,
    worktreePath: string,
    script: RepositoryScript,
  ) {
    const requestedAt = DateTime.formatIso(yield* DateTime.now);
    const terminalId = `setup-${repositoryId}-${script.scriptId}`;
    const payload = {
      scriptId: script.scriptId,
      scriptName: script.name,
      terminalId,
      worktreePath,
    };
    const launch = terminals
      .open({
        threadId,
        terminalId,
        cwd: worktreePath,
        worktreePath,
        env: projectScriptRuntimeEnv({
          project: { cwd: repositoryPath },
          worktreePath,
        }),
      })
      .pipe(
        Effect.andThen(
          terminals.write({
            threadId,
            terminalId,
            data: `${script.command}\r`,
          }),
        ),
      );

    yield* launch.pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          appendSetupActivity(
            threadId,
            "setup-script.failed",
            "Setup script failed to start",
            "error",
            { ...payload, detail: setupFailureDetail(cause) },
            requestedAt,
          ).pipe(
            Effect.ignoreCause({ log: true }),
            Effect.andThen(
              Effect.logWarning("coding-session setup script failed to start", {
                threadId,
                worktreePath,
                scriptId: script.scriptId,
                cause,
              }),
            ),
          ),
        onSuccess: () =>
          DateTime.now.pipe(
            Effect.map(DateTime.formatIso),
            Effect.flatMap((startedAt) =>
              Effect.all([
                appendSetupActivity(
                  threadId,
                  "setup-script.requested",
                  "Starting setup script",
                  "info",
                  payload,
                  requestedAt,
                ),
                appendSetupActivity(
                  threadId,
                  "setup-script.started",
                  "Setup script started",
                  "info",
                  payload,
                  startedAt,
                ),
              ]),
            ),
            Effect.ignoreCause({ log: true }),
          ),
      }),
    );
  });

  const start: CodingSessionService["Service"]["start"] = Effect.fn("CodingSessionService.start")(
    function* (input) {
      // A session starts from a settled commit; only a turn streaming on that
      // very chain blocks it. Replies on other branches run beside it.
      if (yield* planTurns.activeChainMember(input.planId, CommitId.make(input.parentCommitId))) {
        return yield* new PlanTurnActiveError({ planId: input.planId });
      }
      const detail = yield* planning.getPlanSnapshot({ planId: input.planId });
      const repositorySnapshot = yield* repositories.getSnapshot;
      const linkedRepositories = repositorySnapshot.projectRepositories
        .filter((link) => link.projectId === detail.plan.projectId)
        .flatMap((link) => {
          const repository = repositorySnapshot.repositories.find(
            (candidate) => candidate.repositoryId === link.repositoryId,
          );
          return repository === undefined ? [] : [repository];
        });
      const primaryRepository = linkedRepositories[0];
      if (
        primaryRepository === undefined ||
        linkedRepositories.some((repository) => !repository.hasGit)
      ) {
        return yield* blocked("repository-not-git");
      }

      const snapshots = yield* providers.getProviders;
      const provider = snapshots.find(
        (candidate) => candidate.instanceId === input.modelSelection.instanceId,
      );
      const providerRefusal = codingSessionProviderRefusal(provider, input.modelSelection.model);
      if (providerRefusal !== null) return yield* blocked(providerRefusal);
      const capabilities = yield* providerService.getCapabilities(input.modelSelection.instanceId);
      const unreachableRepositories =
        capabilities.groundingRoots === "multi"
          ? []
          : linkedRepositories.slice(1).map((repository) => repository.name);

      const planText = yield* planning.getPlanTextAt({
        planId: input.planId,
        commitId: CommitId.make(input.parentCommitId),
      });
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const startedAt = yield* DateTime.now;
      const lineRootCommitId = lineRootCommitIdFor(detail, input.parentCommitId);
      const memorySource = yield* memorySources.getSource(detail.plan.projectId);
      yield* Effect.forEach(
        projectWorkingRepositories(
          repositorySnapshot,
          detail.plan.projectId,
          Option.getOrNull(memorySource),
        ),
        (repository) =>
          lineBranchEnsurer.ensureLineBranch({ detail, lineRootCommitId, repository }),
        { discard: true },
      );
      const threadId = ThreadId.make(yield* uuid);
      const messageId = MessageId.make(yield* uuid);
      const holder = { kind: "turn" as const, threadId };
      let threadCreated = false;
      let slotId: WorktreeSlotId | undefined;

      const cleanup = Effect.gen(function* () {
        if (threadCreated) {
          const deleted = yield* Effect.exit(
            orchestration.dispatch({
              type: "thread.delete",
              commandId: yield* commandId("cleanup-thread"),
              threadId,
            }),
          );
          if (Exit.isSuccess(deleted)) {
            yield* deletionReactor
              .drainThrough(deleted.value.sequence)
              .pipe(Effect.ignoreCause({ log: true }));
          } else {
            yield* Effect.logWarning("Could not delete failed coding-session thread.", {
              threadId,
              cause: deleted.cause,
            });
          }
        }
        if (slotId !== undefined) {
          yield* slotService.release(slotId, holder).pipe(Effect.ignoreCause({ log: true }));
        }
      });

      const birth = Effect.gen(function* () {
        const slot = yield* slotService.claim({
          projectId: detail.plan.projectId,
          lineRootCommitId,
          holder,
        });
        slotId = slot.slotId;
        const primaryMember = slot.members.find(
          (member) => member.repositoryId === primaryRepository.repositoryId,
        );
        // The home member leads every list the thread hands out, so the header
        // and the provider stand in the same repository the record names.
        const workspaceMembers = [
          ...(primaryMember === undefined ? [] : [primaryMember]),
          ...slot.members.filter((member) => member !== primaryMember),
        ].map((member) => ({
          repositoryId: member.repositoryId,
          worktreePath: path.join(slot.path, member.relativePath),
        }));
        if (primaryMember === undefined || primaryMember.currentBranch === null) {
          return yield* new SlotServiceError({
            operation: "claim:lineBranch",
            cause: new Error(`Project slot ${slot.slotId} has no primary line branch`),
          });
        }
        const branch = primaryMember.currentBranch;
        const primaryWorktreePath = path.join(slot.path, primaryMember.relativePath);
        const memoryMember = Option.isNone(memorySource)
          ? undefined
          : workspaceMembers.find(
              (member) => member.repositoryId === memorySource.value.repositoryId,
            );
        const firstTurnText =
          Option.isNone(memorySource) || memoryMember === undefined
            ? planText
            : `${planText}\n\n${memoryAppendix({
                name: "project memory",
                path: path.join(memoryMember.worktreePath, memorySource.value.subpath ?? ""),
              })}`;

        const existingProject = yield* projections.getActiveProjectByWorkspaceRoot(
          primaryRepository.path,
        );
        const projectId = Option.isSome(existingProject)
          ? existingProject.value.id
          : ProjectId.make(yield* uuid);
        if (Option.isNone(existingProject)) {
          yield* orchestration.dispatch({
            type: "project.create",
            commandId: yield* commandId("project-create"),
            projectId,
            title: primaryRepository.name,
            workspaceRoot: primaryRepository.path,
            defaultModelSelection: input.modelSelection,
            createdAt,
          });
        }

        yield* orchestration.dispatch({
          type: "thread.create",
          commandId: yield* commandId("thread-create"),
          threadId,
          projectId,
          title: detail.plan.title,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: "default",
          branch,
          worktreePath: null,
          createdAt,
        });
        threadCreated = true;

        yield* orchestration.dispatch({
          type: "thread.meta.update",
          commandId: yield* commandId("thread-meta"),
          threadId,
          branch,
          worktreePath: primaryWorktreePath,
          workspaceMembers,
        });
        for (const member of workspaceMembers) {
          yield* vcsStatus
            .refreshStatus(member.worktreePath)
            .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);
          const repository = linkedRepositories.find(
            (candidate) => candidate.repositoryId === member.repositoryId,
          );
          if (repository === undefined) continue;
          for (const script of repository.scripts) {
            if (script.isSetup) {
              yield* launchSetupScript(
                threadId,
                String(repository.repositoryId),
                repository.path,
                member.worktreePath,
                script,
              );
            }
          }
        }

        yield* orchestration.dispatch({
          type: "thread.turn.start",
          commandId: yield* commandId("turn-start"),
          threadId,
          message: { messageId, role: "user", text: firstTurnText, attachments: [] },
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: "default",
          createdAt,
        });

        const leaf = yield* planning.appendCodingSession({
          planId: input.planId,
          parentCommitId: CommitId.make(input.parentCommitId),
          threadId,
          branch,
          worktreePath: primaryWorktreePath,
          homeRepositoryId: primaryRepository.repositoryId,
          repositoryIds: workspaceMembers.map((member) => member.repositoryId),
          unreachableRepositories,
          startedAt,
        });
        return { commitId: MercurianCommitId.make(leaf.commitId), threadId };
      });

      return yield* withCodingSessionBirthCompensation(birth, cleanup).pipe(
        Effect.catchTags({
          SlotPoolAtCapacityError: () => Effect.fail(blocked("pool-at-capacity")),
          LineBranchMissingError: () => Effect.fail(blocked("line-branch-missing")),
        }),
      );
    },
  );

  return CodingSessionService.of({ start });
});

export const layer = Layer.effect(CodingSessionService, make);
