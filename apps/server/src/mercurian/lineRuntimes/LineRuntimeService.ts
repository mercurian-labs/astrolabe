import {
  CommandId,
  DEFAULT_RUNTIME_MODE,
  EventId,
  type MercurianCommitId,
  type MercurianRepositoryId,
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
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../../orchestration/Services/ThreadDeletionReactor.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { getAutoBootstrapThreadModelSelection } from "../../serverRuntimeStartup.ts";
import { TerminalManager } from "../../terminal/Manager.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { LineBranchStore } from "../commitTree/LineBranchStore.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import type { MercurianProject } from "../planning/schema.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import type { RepositoryScript } from "../repositories/schema.ts";
import { SlotRegistry } from "../worktreeSlots/SlotRegistry.ts";
import * as SlotService from "../worktreeSlots/SlotService.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import type { SlotLeaseHolder, WorktreeSlot, WorktreeSlotId } from "../worktreeSlots/schema.ts";
import { buildLineBranchName } from "./branch.ts";
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
const isLineBranchMissingError = Schema.is(SlotService.LineBranchMissingError);
const isSlotPoolAtCapacityError = Schema.is(SlotService.SlotPoolAtCapacityError);
const isSlotServiceError = Schema.is(SlotService.SlotServiceError);

export type EnsureThreadInput = {
  readonly planId: import("@t3tools/contracts").PlanId;
} & (
  | { readonly lineRootCommitId: MercurianCommitId; readonly forkParentCommitId?: never }
  | { readonly lineRootCommitId?: never; readonly forkParentCommitId: MercurianCommitId }
);

export type EnsureSlotHolder =
  | { readonly kind: "turn" }
  | { readonly kind: "terminal"; readonly terminalId: string }
  | { readonly kind: "preview"; readonly previewId: string };

export interface EnsureSlotInput {
  readonly threadId: ThreadId;
  readonly holder: EnsureSlotHolder;
}

export interface EnsuredLineRuntime {
  readonly record: LineRuntimeRecord;
  readonly slotId: WorktreeSlotId;
}

export type EnsureThreadError = RepositoryNotGitError | LineRuntimeServiceError;
export type EnsureProjectRuntimeError = RepositoryNotGitError | LineRuntimeServiceError;
export type EnsureSlotError =
  | RepositoryNotGitError
  | LineRuntimeServiceError
  | SlotService.LineBranchMissingError
  | SlotService.SlotPoolAtCapacityError
  | SlotService.SlotServiceError;

export class LineRuntimeService extends Context.Service<
  LineRuntimeService,
  {
    readonly ensureProjectRuntime: (
      projectId: import("@t3tools/contracts").MercurianProjectId,
    ) => Effect.Effect<ProjectId, EnsureProjectRuntimeError>;
    readonly ensureThread: (
      input: EnsureThreadInput,
    ) => Effect.Effect<LineRuntimeRecord, EnsureThreadError>;
    readonly ensureSlot: (
      input: EnsureSlotInput,
    ) => Effect.Effect<EnsuredLineRuntime, EnsureSlotError>;
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

const LINE_BRANCH_WAIT = "30 seconds";

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
  const slotService = yield* SlotService.SlotService;
  const slotStore = yield* SlotStore;
  const slotRegistry = yield* SlotRegistry;
  const lineRuntimes = yield* LineRuntimeStore;
  const branches = yield* LineBranchStore;
  const path = yield* Path.Path;

  const uuid = crypto.randomUUIDv4;
  const commandId = (tag: string) =>
    uuid.pipe(Effect.map((id) => CommandId.make(`server:line-runtime-${tag}:${id}`)));

  const linkedRepositoriesFor = Effect.fn("LineRuntimeService.linkedRepositoriesFor")(function* (
    projectId: import("@t3tools/contracts").MercurianProjectId,
  ) {
    const snapshot = yield* repositories.getSnapshot;
    return snapshot.projectRepositories
      .filter((link) => link.projectId === projectId)
      .flatMap((link) => {
        const repository = snapshot.repositories.find(
          (candidate) => candidate.repositoryId === link.repositoryId,
        );
        return repository === undefined ? [] : [repository];
      });
  });

  const awaitLineBranches = Effect.fn("LineRuntimeService.awaitLineBranches")(function* (
    lineRootCommitId: MercurianCommitId,
    repositoryIds: ReadonlyArray<MercurianRepositoryId>,
  ) {
    const ready = Effect.forEach(repositoryIds, (repositoryId) =>
      branches.get({ lineRootCommitId, repositoryId }),
    ).pipe(Effect.map((rows) => rows.every(Option.isSome)));
    yield* Stream.merge(Stream.succeed(undefined), branches.changes).pipe(
      Stream.mapEffect(() => ready),
      Stream.filter((isReady) => isReady),
      Stream.take(1),
      Stream.runDrain,
      Effect.timeoutOrElse({
        duration: LINE_BRANCH_WAIT,
        orElse: () =>
          Effect.fail(
            new LineRuntimeServiceError({
              operation: "ensureSlot:lineBranches",
              cause: new Error(`Line ${lineRootCommitId} never received its branches`),
            }),
          ),
      }),
    );
  });

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
    if (home.currentBranch !== record.branch || worktreePath !== record.worktreePath) {
      yield* lineRuntimes.updateWorkspace(record.threadId, {
        branch: home.currentBranch,
        worktreePath,
      });
    }
    return { ...record, branch: home.currentBranch, worktreePath };
  });

  const ensureOrchestrationProject = Effect.fn("LineRuntimeService.ensureOrchestrationProject")(
    function* (
      project: MercurianProject,
      primaryRepository: { readonly name: string; readonly path: string },
    ) {
      if (project.orchestrationProjectId !== null) return project.orchestrationProjectId;
      const existing = yield* projections.getActiveProjectByWorkspaceRoot(primaryRepository.path);
      const projectId = Option.isSome(existing) ? existing.value.id : ProjectId.make(yield* uuid);
      if (Option.isNone(existing)) {
        yield* orchestration.dispatch({
          type: "project.create",
          commandId: yield* commandId("project-create"),
          projectId,
          title: primaryRepository.name,
          workspaceRoot: primaryRepository.path,
          defaultModelSelection: getAutoBootstrapThreadModelSelection(),
          createdAt: DateTime.formatIso(yield* DateTime.now),
        });
      }
      yield* planning.setOrchestrationProjectId(project.projectId, projectId);
      return projectId;
    },
  );

  const ensureProjectRuntime = Effect.fn("LineRuntimeService.ensureProjectRuntime")(function* (
    projectId: import("@t3tools/contracts").MercurianProjectId,
  ) {
    const project = yield* planning.getProject(projectId);
    const linkedRepositories = yield* linkedRepositoriesFor(projectId);
    const primaryRepository = linkedRepositories[0];
    if (
      primaryRepository === undefined ||
      linkedRepositories.some((repository) => !repository.hasGit)
    ) {
      return yield* new RepositoryNotGitError();
    }
    return yield* ensureOrchestrationProject(project, primaryRepository);
  });

  const ensureThread = Effect.fn("LineRuntimeService.ensureThread")(function* (
    input: EnsureThreadInput,
  ) {
    if (input.lineRootCommitId !== undefined) {
      const existing = yield* lineRuntimes.getOrNone(input.planId, input.lineRootCommitId);
      if (Option.isSome(existing)) return existing.value;
    } else {
      const existing = (yield* lineRuntimes.listByPlan(input.planId)).find(
        (runtime) =>
          runtime.lineRootCommitId === null &&
          runtime.forkParentCommitId === input.forkParentCommitId,
      );
      if (existing !== undefined) return existing;
    }

    const detail = yield* planning.getPlanSnapshot({ planId: input.planId });
    const project = yield* planning.getProject(detail.plan.projectId);
    const linkedRepositories = yield* linkedRepositoriesFor(detail.plan.projectId);
    const primaryRepository = linkedRepositories[0];
    if (
      primaryRepository === undefined ||
      linkedRepositories.some((repository) => !repository.hasGit)
    ) {
      return yield* new RepositoryNotGitError();
    }
    const orchestrationProjectId = yield* ensureOrchestrationProject(project, primaryRepository);
    const shell = yield* projections.getShellSnapshot();
    const lastThread = shell.threads
      .filter((thread) => thread.projectId === orchestrationProjectId)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const projectShell = shell.projects.find(
      (candidate) => candidate.id === orchestrationProjectId,
    );
    const modelSelection =
      lastThread?.modelSelection ??
      projectShell?.defaultModelSelection ??
      getAutoBootstrapThreadModelSelection();
    const runtimeMode = lastThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
    const capabilities = yield* providerService.getCapabilities(modelSelection.instanceId);
    const unreachableRepositories =
      capabilities.groundingRoots === "multi"
        ? []
        : linkedRepositories.slice(1).map((repository) => repository.name);
    const createdAt = yield* DateTime.now;
    const createdAtIso = DateTime.formatIso(createdAt);
    const threadId = ThreadId.make(yield* uuid);
    const provisionalKey = input.lineRootCommitId ?? input.forkParentCommitId ?? threadId;
    const provisionalBranch = buildLineBranchName(detail.plan.title, String(provisionalKey));
    let threadCreated = false;
    let runtimeCreated = false;
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
          yield* deletionReactor.drainThrough(deleted.value.sequence).pipe(Effect.ignoreCause());
        }
      }
      if (runtimeCreated) yield* lineRuntimes.deleteByThread(threadId).pipe(Effect.ignoreCause());
    });
    return yield* withLineRuntimeBirthCompensation(
      Effect.gen(function* () {
        yield* lineRuntimes.create({
          planId: input.planId,
          lineRootCommitId: input.lineRootCommitId ?? null,
          ...(input.forkParentCommitId === undefined
            ? {}
            : { forkParentCommitId: input.forkParentCommitId }),
          threadId,
          homeRepositoryId: primaryRepository.repositoryId,
          branch: provisionalBranch,
          worktreePath: primaryRepository.path,
          unreachableRepositories,
          repositoryIds: linkedRepositories.map((repository) => repository.repositoryId),
          createdAt,
        });
        runtimeCreated = true;
        yield* orchestration.dispatch({
          type: "thread.create",
          commandId: yield* commandId("thread-create"),
          threadId,
          projectId: orchestrationProjectId,
          title: detail.plan.title,
          modelSelection,
          runtimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: createdAtIso,
        });
        threadCreated = true;
        const record: LineRuntimeRecord = {
          planId: input.planId,
          lineRootCommitId: input.lineRootCommitId ?? null,
          ...(input.forkParentCommitId === undefined
            ? {}
            : { forkParentCommitId: input.forkParentCommitId }),
          threadId,
          homeRepositoryId: primaryRepository.repositoryId,
          branch: provisionalBranch,
          worktreePath: primaryRepository.path,
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
        if (record.lineRootCommitId !== null) {
          const assigned = (yield* slotStore.listAll).find(
            (slot) =>
              slot.projectId === detail.plan.projectId &&
              slot.currentLineRootCommitId === record.lineRootCommitId,
          );
          if (assigned !== undefined) return yield* updateMetadata(record, assigned);
        }
        return record;
      }),
      cleanup,
    );
  });

  const ensureSlot = Effect.fn("LineRuntimeService.ensureSlot")(function* ({
    threadId,
    holder,
  }: EnsureSlotInput) {
    const runtime = yield* lineRuntimes.getByThreadId(threadId);
    if (Option.isNone(runtime)) {
      return yield* new LineRuntimeServiceError({
        operation: "ensureSlot:runtime",
        cause: new Error(`Thread ${threadId} has no line runtime`),
      });
    }
    const record = runtime.value;
    if (record.lineRootCommitId === null) {
      // The websocket send hook roots a line before asking for its slot. Keep
      // this guard for direct/internal callers that violate that ordering.
      return yield* new LineRuntimeServiceError({
        operation: "ensureSlot:pendingLine",
        cause: new Error(`Thread ${threadId} has not received its first message`),
      });
    }
    const detail = yield* planning.getPlanSnapshot({ planId: record.planId });
    const linkedRepositories = yield* linkedRepositoriesFor(detail.plan.projectId);
    if (
      linkedRepositories.length === 0 ||
      linkedRepositories.some((repository) => !repository.hasGit)
    ) {
      return yield* new RepositoryNotGitError();
    }
    yield* awaitLineBranches(
      record.lineRootCommitId,
      linkedRepositories.map((repository) => repository.repositoryId),
    );
    const leaseHolder = { ...holder, threadId } as SlotLeaseHolder;
    const assigned = (yield* slotStore.listAll).find(
      (slot) =>
        slot.projectId === detail.plan.projectId &&
        slot.currentLineRootCommitId === record.lineRootCommitId,
    );
    if (assigned !== undefined) {
      const lease = yield* slotRegistry.lease(assigned.slotId);
      if (
        Option.isSome(lease) &&
        lease.value.holders.every((candidate) => candidate.threadId === threadId)
      ) {
        yield* slotService.retain(assigned.slotId, leaseHolder);
        return { record: yield* updateMetadata(record, assigned), slotId: assigned.slotId };
      }
    }
    const claimed = yield* slotService.claim({
      planId: record.planId,
      projectId: detail.plan.projectId,
      lineRootCommitId: record.lineRootCommitId,
      holder: leaseHolder,
      wait: true,
    });
    const updated = yield* updateMetadata(record, claimed);
    for (const member of workspaceMembersOf(claimed, record.homeRepositoryId)) {
      yield* vcsStatus
        .refreshStatus(member.worktreePath)
        .pipe(Effect.ignoreCause(), Effect.forkDetach);
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
    return { record: updated, slotId: claimed.slotId };
  });

  const preserveSlotError = (cause: unknown): EnsureSlotError =>
    isRepositoryNotGitError(cause) ||
    isLineRuntimeServiceError(cause) ||
    isLineBranchMissingError(cause) ||
    isSlotPoolAtCapacityError(cause) ||
    isSlotServiceError(cause)
      ? cause
      : new LineRuntimeServiceError({ operation: "ensureSlot", cause });

  return LineRuntimeService.of({
    ensureProjectRuntime: (projectId) =>
      ensureProjectRuntime(projectId).pipe(
        Effect.mapError((cause): EnsureProjectRuntimeError =>
          isRepositoryNotGitError(cause) || isLineRuntimeServiceError(cause)
            ? cause
            : new LineRuntimeServiceError({ operation: "ensureProjectRuntime", cause }),
        ),
      ),
    ensureThread: (input) =>
      ensureThread(input).pipe(
        Effect.mapError((cause): EnsureThreadError =>
          isRepositoryNotGitError(cause) || isLineRuntimeServiceError(cause)
            ? cause
            : new LineRuntimeServiceError({ operation: "ensureThread", cause }),
        ),
      ),
    ensureSlot: (input) => ensureSlot(input).pipe(Effect.mapError(preserveSlotError)),
  });
});

export const layer = Layer.effect(LineRuntimeService, make);
