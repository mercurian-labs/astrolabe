import {
  CodingSessionBlockedError,
  CommandId,
  EventId,
  isProviderAvailable,
  MessageId,
  MercurianCommitId,
  MercurianRepositoryNotFoundError,
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

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../../orchestration/Services/ThreadDeletionReactor.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { TerminalManager } from "../../terminal/Manager.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import type { RepositoryScript } from "../repositories/schema.ts";
import { buildCodingSessionBranchName } from "./branch.ts";
import { CommitId } from "../commitTree/schema.ts";

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

export const codingSessionBranchCasDeleteArgs = (branch: string, capturedOid: string) =>
  ["update-ref", "-d", `refs/heads/${branch}`, capturedOid] as const;

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
  const projections = yield* ProjectionSnapshotQuery;
  const orchestration = yield* OrchestrationEngineService;
  const git = yield* GitWorkflowService;
  const gitDriver = yield* GitVcsDriver;
  const vcsStatus = yield* VcsStatusBroadcaster;
  const terminals = yield* TerminalManager;
  const deletionReactor = yield* ThreadDeletionReactor;
  const planTurns = yield* PlanTurnRegistry;

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
    repositoryPath: string,
    worktreePath: string,
    script: RepositoryScript,
  ) {
    const requestedAt = DateTime.formatIso(yield* DateTime.now);
    const terminalId = `setup-${script.scriptId}`;
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
      if (Option.isSome(yield* planTurns.get(input.planId))) {
        return yield* new PlanTurnActiveError({ planId: input.planId });
      }
      const detail = yield* planning.getPlanSnapshot({ planId: input.planId });
      const ready = detail.readyCommits.find(
        (candidate) => String(candidate.commitId) === String(input.parentCommitId),
      );
      if (ready === undefined) return yield* blocked("not-ready");
      if (ready.repositoryId !== input.repositoryId) {
        return yield* blocked("repository-mismatch");
      }

      const repositorySnapshot = yield* repositories.getSnapshot;
      const repository = repositorySnapshot.repositories.find(
        (candidate) => candidate.repositoryId === input.repositoryId,
      );
      const linked = repositorySnapshot.projectRepositories.some(
        (link) =>
          link.projectId === detail.plan.projectId && link.repositoryId === input.repositoryId,
      );
      if (repository === undefined) {
        return yield* new MercurianRepositoryNotFoundError({ repositoryId: input.repositoryId });
      }
      if (!linked) return yield* blocked("repository-not-in-project");
      if (!repository.hasGit) return yield* blocked("repository-not-git");

      const localBase = yield* gitDriver.execute({
        operation: "coding-session-base-ref",
        cwd: repository.path,
        args: ["rev-parse", "--verify", `refs/heads/${input.baseRef}^{commit}`],
        allowNonZeroExit: true,
      });
      if (localBase.exitCode !== 0) return yield* blocked("base-ref-missing");
      const localBaseOid = localBase.stdout.trim();

      const snapshots = yield* providers.getProviders;
      const provider = snapshots.find(
        (candidate) => candidate.instanceId === input.modelSelection.instanceId,
      );
      const providerRefusal = codingSessionProviderRefusal(provider, input.modelSelection.model);
      if (providerRefusal !== null) return yield* blocked(providerRefusal);

      const planText = yield* planning.getPlanTextAt({
        planId: input.planId,
        commitId: CommitId.make(input.parentCommitId),
      });
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const startedAt = yield* DateTime.now;
      const branch = buildCodingSessionBranchName(
        detail.plan.title,
        (yield* uuid).replaceAll("-", ""),
      );
      const threadId = ThreadId.make(yield* uuid);
      const messageId = MessageId.make(yield* uuid);
      let threadCreated = false;
      let worktreePath: string | undefined;
      let capturedBaseOid = localBaseOid;
      let branchMayExist = false;

      const cleanup = Effect.gen(function* () {
        if (threadCreated) {
          yield* orchestration
            .dispatch({
              type: "thread.delete",
              commandId: yield* commandId("cleanup-thread"),
              threadId,
            })
            .pipe(Effect.ignoreCause({ log: true }));
          yield* deletionReactor.drain.pipe(Effect.ignoreCause({ log: true }));
        }
        if (worktreePath !== undefined) {
          yield* git
            .removeWorktree({ cwd: repository.path, path: worktreePath, force: true })
            .pipe(Effect.ignoreCause({ log: true }));
        }
        if (branchMayExist && capturedBaseOid.length > 0) {
          const deleted = yield* gitDriver
            .execute({
              operation: "coding-session-cleanup-branch",
              cwd: repository.path,
              args: codingSessionBranchCasDeleteArgs(branch, capturedBaseOid),
              allowNonZeroExit: true,
            })
            .pipe(Effect.option);
          if (Option.isSome(deleted) && deleted.value.exitCode !== 0) {
            yield* Effect.logWarning("coding-session cleanup preserved a moved branch", {
              threadId,
              branch,
              repositoryPath: repository.path,
            });
          }
        }
      });

      const birth = Effect.gen(function* () {
        const existingProject = yield* projections.getActiveProjectByWorkspaceRoot(repository.path);
        const projectId = Option.isSome(existingProject)
          ? existingProject.value.id
          : ProjectId.make(yield* uuid);
        if (Option.isNone(existingProject)) {
          yield* orchestration.dispatch({
            type: "project.create",
            commandId: yield* commandId("project-create"),
            projectId,
            title: repository.name,
            workspaceRoot: repository.path,
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

        let worktreeBaseRef = input.baseRef;
        if (
          input.startFromOrigin &&
          (yield* git.remoteExists({ cwd: repository.path, remoteName: "origin" }))
        ) {
          yield* git.fetchRemote({ cwd: repository.path, remoteName: "origin" });
          const remote = yield* git.resolveRemoteTrackingCommit({
            cwd: repository.path,
            refName: input.baseRef,
            fallbackRemoteName: "origin",
          });
          worktreeBaseRef = remote.commitSha;
          capturedBaseOid = remote.commitSha;
        }

        branchMayExist = true;
        const created = yield* git.createWorktree({
          cwd: repository.path,
          refName: worktreeBaseRef,
          newRefName: branch,
          baseRefName: input.baseRef,
          path: null,
        });
        worktreePath = created.worktree.path;
        yield* orchestration.dispatch({
          type: "thread.meta.update",
          commandId: yield* commandId("thread-meta"),
          threadId,
          branch: created.worktree.refName,
          worktreePath,
        });
        yield* vcsStatus
          .refreshStatus(worktreePath)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);

        for (const script of repository.scripts) {
          if (script.isSetup) {
            yield* launchSetupScript(threadId, repository.path, worktreePath, script);
          }
        }

        yield* orchestration.dispatch({
          type: "thread.turn.start",
          commandId: yield* commandId("turn-start"),
          threadId,
          message: { messageId, role: "user", text: planText, attachments: [] },
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: "default",
          createdAt,
        });

        const leaf = yield* planning.appendCodingSession({
          planId: input.planId,
          parentCommitId: CommitId.make(input.parentCommitId),
          repositoryId: input.repositoryId,
          repositoryName: repository.name,
          threadId,
          branch,
          worktreePath,
          baseRef: input.baseRef,
          startedAt,
        });
        return { commitId: MercurianCommitId.make(leaf.commitId), threadId };
      });

      return yield* withCodingSessionBirthCompensation(birth, cleanup);
    },
  );

  return CodingSessionService.of({ start });
});

export const layer = Layer.effect(CodingSessionService, make);
