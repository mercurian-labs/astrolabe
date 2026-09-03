import {
  CommandId,
  EventId,
  type MercurianCommitId,
  type ModelSelection,
  ProjectId,
  type RuntimeMode,
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
import * as Schema from "effect/Schema";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../../orchestration/Services/ThreadDeletionReactor.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { TerminalManager } from "../../terminal/Manager.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import type { RepositoryScript } from "../repositories/schema.ts";
import { SlotRegistry } from "../worktreeSlots/SlotRegistry.ts";
import { SlotService } from "../worktreeSlots/SlotService.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import type { SlotLeaseHolder, WorktreeSlot, WorktreeSlotId } from "../worktreeSlots/schema.ts";
import { LineRuntimeStore } from "./LineRuntimeStore.ts";
import type { LineRuntimeRecord } from "./schema.ts";

export class RepositoryNotGitError extends Schema.TaggedErrorClass<RepositoryNotGitError>()(
  "RepositoryNotGitError",
  {},
) {}

export class LineRuntimeServiceError extends Schema.TaggedErrorClass<LineRuntimeServiceError>()(
  "LineRuntimeServiceError",
  { operation: Schema.String, cause: Schema.Unknown },
) {}

export const isRepositoryNotGitError = Schema.is(RepositoryNotGitError);
export const isLineRuntimeServiceError = Schema.is(LineRuntimeServiceError);

export interface EnsureLineRuntimeInput {
  readonly planId: import("@t3tools/contracts").PlanId;
  readonly lineRootCommitId: MercurianCommitId;
  readonly runtimeMode: RuntimeMode;
  readonly modelSelection: ModelSelection;
  readonly holder: { readonly kind: "turn" };
}

export interface EnsuredLineRuntime {
  readonly record: LineRuntimeRecord;
  readonly slotId: WorktreeSlotId;
}

export class LineRuntimeService extends Context.Service<
  LineRuntimeService,
  {
    readonly ensure: (input: EnsureLineRuntimeInput) => Effect.Effect<EnsuredLineRuntime, object>;
  }
>()("t3/mercurian/lineRuntimes/LineRuntimeService") {}

export function withLineRuntimeBirthCompensation<A, E, R, E2, R2>(
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
  const providerService = yield* ProviderService;
  const projections = yield* ProjectionSnapshotQuery;
  const orchestration = yield* OrchestrationEngineService;
  const vcsStatus = yield* VcsStatusBroadcaster;
  const terminals = yield* TerminalManager;
  const deletionReactor = yield* ThreadDeletionReactor;
  const slotService = yield* SlotService;
  const slotStore = yield* SlotStore;
  const slotRegistry = yield* SlotRegistry;
  const lineRuntimes = yield* LineRuntimeStore;
  const path = yield* Path.Path;

  const uuid = crypto.randomUUIDv4;
  const commandId = (tag: string) =>
    uuid.pipe(Effect.map((id) => CommandId.make(`server:line-runtime-${tag}:${id}`)));

  const appendSetupActivity = Effect.fn("LineRuntimeService.appendSetupActivity")(function* (
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

  const launchSetupScript = Effect.fn("LineRuntimeService.launchSetupScript")(function* (
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
    yield* terminals
      .open({
        threadId,
        terminalId,
        cwd: worktreePath,
        worktreePath,
        env: projectScriptRuntimeEnv({ project: { cwd: repositoryPath }, worktreePath }),
      })
      .pipe(
        Effect.andThen(terminals.write({ threadId, terminalId, data: `${script.command}\r` })),
        Effect.matchEffect({
          onFailure: (cause) =>
            appendSetupActivity(
              threadId,
              "setup-script.failed",
              "Setup script failed to start",
              "error",
              { ...payload, detail: setupFailureDetail(cause) },
              requestedAt,
            ).pipe(Effect.ignoreCause({ log: true })),
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

  const workspaceMembersOf = (slot: WorktreeSlot, homeRepositoryId: string) =>
    [...slot.members]
      .sort((left, right) =>
        left.repositoryId === homeRepositoryId
          ? -1
          : right.repositoryId === homeRepositoryId
            ? 1
            : 0,
      )
      .map((member) => ({
        repositoryId: member.repositoryId,
        worktreePath: path.join(slot.path, member.relativePath),
      }));

  const updateMetadata = Effect.fn("LineRuntimeService.updateMetadata")(function* (
    record: LineRuntimeRecord,
    slot: WorktreeSlot,
  ) {
    const home = slot.members.find((member) => member.repositoryId === record.homeRepositoryId);
    if (home === undefined || home.currentBranch === null) {
      return yield* new LineRuntimeServiceError({
        operation: "updateMetadata:homeLineBranch",
        cause: new Error(`Slot ${slot.slotId} has no home line branch`),
      });
    }
    const workspaceMembers = workspaceMembersOf(slot, record.homeRepositoryId);
    const worktreePath = workspaceMembers.find(
      (member) => member.repositoryId === record.homeRepositoryId,
    )!.worktreePath;
    yield* orchestration.dispatch({
      type: "thread.meta.update",
      commandId: yield* commandId("thread-meta"),
      threadId: record.threadId,
      branch: home.currentBranch,
      worktreePath,
      workspaceMembers,
    });
    if (home.currentBranch !== record.branch) {
      yield* lineRuntimes.updateBranch(record.threadId, home.currentBranch);
    }
    return { ...record, branch: home.currentBranch, worktreePath };
  });

  const ensure: LineRuntimeService["Service"]["ensure"] = Effect.fn("LineRuntimeService.ensure")(
    function* (input) {
      const detail = yield* planning.getPlanSnapshot({ planId: input.planId });
      const existing = yield* lineRuntimes.getOrNone(input.planId, input.lineRootCommitId);
      if (Option.isSome(existing)) {
        const record = existing.value;
        const assigned = (yield* slotStore.listAll).find(
          (slot) =>
            slot.projectId === detail.plan.projectId &&
            slot.currentLineRootCommitId === input.lineRootCommitId,
        );
        if (assigned !== undefined) {
          const lease = yield* slotRegistry.lease(assigned.slotId);
          if (
            Option.isSome(lease) &&
            lease.value.holders.every((holder) => holder.threadId === record.threadId)
          ) {
            yield* slotService.retain(assigned.slotId, {
              ...input.holder,
              threadId: record.threadId,
            });
            return { record: yield* updateMetadata(record, assigned), slotId: assigned.slotId };
          }
        }
        const claimed = yield* slotService.claim({
          projectId: detail.plan.projectId,
          lineRootCommitId: input.lineRootCommitId,
          holder: { ...input.holder, threadId: record.threadId },
          wait: true,
        });
        return { record: yield* updateMetadata(record, claimed), slotId: claimed.slotId };
      }

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
        return yield* new RepositoryNotGitError();
      }
      const capabilities = yield* providerService.getCapabilities(input.modelSelection.instanceId);
      const unreachableRepositories =
        capabilities.groundingRoots === "multi"
          ? []
          : linkedRepositories.slice(1).map((repository) => repository.name);
      const createdAt = yield* DateTime.now;
      const createdAtIso = DateTime.formatIso(createdAt);
      const threadId = ThreadId.make(yield* uuid);
      const holder = { ...input.holder, threadId } as SlotLeaseHolder;
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
            yield* Effect.logWarning("Could not delete failed line-runtime thread.", {
              threadId,
              cause: deleted.cause,
            });
          }
        }
        if (slotId !== undefined) {
          yield* slotService.release(slotId, holder).pipe(Effect.ignoreCause({ log: true }));
        }
      });
      return yield* withLineRuntimeBirthCompensation(
        Effect.gen(function* () {
          const slot = yield* slotService.claim({
            projectId: detail.plan.projectId,
            lineRootCommitId: input.lineRootCommitId,
            holder,
            wait: true,
          });
          slotId = slot.slotId;
          const primaryMember = slot.members.find(
            (member) => member.repositoryId === primaryRepository.repositoryId,
          );
          if (primaryMember === undefined || primaryMember.currentBranch === null) {
            return yield* new LineRuntimeServiceError({
              operation: "ensure:homeLineBranch",
              cause: new Error(`Project slot ${slot.slotId} has no primary line branch`),
            });
          }
          const workspaceMembers = workspaceMembersOf(slot, primaryRepository.repositoryId);
          const worktreePath = workspaceMembers.find(
            (member) => member.repositoryId === primaryRepository.repositoryId,
          )!.worktreePath;
          const project = yield* projections.getActiveProjectByWorkspaceRoot(
            primaryRepository.path,
          );
          const projectId = Option.isSome(project) ? project.value.id : ProjectId.make(yield* uuid);
          if (Option.isNone(project)) {
            yield* orchestration.dispatch({
              type: "project.create",
              commandId: yield* commandId("project-create"),
              projectId,
              title: primaryRepository.name,
              workspaceRoot: primaryRepository.path,
              defaultModelSelection: input.modelSelection,
              createdAt: createdAtIso,
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
            branch: primaryMember.currentBranch,
            worktreePath: null,
            createdAt: createdAtIso,
          });
          threadCreated = true;
          yield* orchestration.dispatch({
            type: "thread.meta.update",
            commandId: yield* commandId("thread-meta"),
            threadId,
            branch: primaryMember.currentBranch,
            worktreePath,
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
          yield* lineRuntimes.create({
            planId: input.planId,
            lineRootCommitId: input.lineRootCommitId,
            threadId,
            homeRepositoryId: primaryRepository.repositoryId,
            branch: primaryMember.currentBranch,
            worktreePath,
            unreachableRepositories,
            repositoryIds: linkedRepositories.map((repository) => repository.repositoryId),
            createdAt,
          });
          const record: LineRuntimeRecord = {
            planId: input.planId,
            lineRootCommitId: input.lineRootCommitId,
            threadId,
            homeRepositoryId: primaryRepository.repositoryId,
            branch: primaryMember.currentBranch,
            worktreePath,
            unreachableRepositories,
            snapshotOid: null,
            snapshotKind: null,
            departedRef: null,
            branchMovement: null,
            lineBranchMissingOid: null,
            createdAt,
            updatedAt: createdAt,
            repositories: linkedRepositories.map((repository) => ({
              repositoryId: repository.repositoryId,
              repositoryName: repository.name,
              snapshotOid: null,
              snapshotKind: null,
              branchTipOid: null,
              departedRef: null,
              branchMovement: null,
              prUrl: null,
            })),
          };
          return { record, slotId: slot.slotId };
        }),
        cleanup,
      );
    },
  );

  return LineRuntimeService.of({ ensure });
});

export const layer = Layer.effect(LineRuntimeService, make);
