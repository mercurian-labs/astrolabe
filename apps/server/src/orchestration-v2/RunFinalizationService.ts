import {
  CheckpointScopeId,
  CommandId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as ThreadWikiCheckouts from "../wiki/ThreadWikiCheckouts.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as CheckpointCapture from "./CheckpointCaptureService.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

/** The follow-up a run gets when it leaves a base broken; a run it starts gets none. */
const BASE_CHECK_PREFIX = "wiki-base-check:";

export class RunFinalizationError extends Schema.TaggedError<RunFinalizationError>()(
  "RunFinalizationError",
  {
    threadId: ThreadId,
    runId: RunId,
    scopeId: CheckpointScopeId,
    operation: Schema.Literals(["capture-checkpoint", "refresh-workspace"]),
    cause: Schema.Defect(),
  },
) {}

export class RunFinalizationRefreshError extends Schema.TaggedError<RunFinalizationRefreshError>()(
  "RunFinalizationRefreshError",
  { cwd: Schema.String, cause: Schema.Defect() },
) {}

export class RunFinalizationObserver extends Context.Reference<{
  readonly refreshAfterTurn: (projectId: ProjectId) => Effect.Effect<void>;
  readonly refresh: (input: {
    readonly cwd: string;
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) => Effect.Effect<void, RunFinalizationRefreshError>;
}>("t3/orchestration-v2/RunFinalizationObserver", {
  defaultValue: () => ({ refresh: () => Effect.void, refreshAfterTurn: () => Effect.void }),
}) {}

export class RunFinalizationService extends Context.Service<
  RunFinalizationService,
  {
    readonly finalize: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly scopeId: CheckpointScopeId;
    }) => Effect.Effect<void, RunFinalizationError>;
  }
>()("t3/orchestration-v2/RunFinalizationService") {}

const make = Effect.gen(function* () {
  const checkpointCapture = yield* CheckpointCapture.CheckpointCaptureServiceV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const observer = yield* RunFinalizationObserver;
  const wikiCheckouts = yield* Effect.serviceOption(ThreadWikiCheckouts.ThreadWikiCheckouts);
  const threads = yield* ThreadManagementService.ThreadManagementService;

  /**
   * Astrolabe: the turn's edits in the thread's wiki checkouts land as one amendment each. Bases
   * it left broken get one message back to this thread asking for a fix, unless this run is
   * that fix: its bases' warnings then stay in the base view and the change request.
   */
  const saveWikiEdits = Effect.fn("RunFinalizationService.saveWikiEdits")(function* (
    threadId: ThreadId,
    runId: RunId,
  ) {
    if (Option.isNone(wikiCheckouts)) return;
    const thread = yield* projections.getThreadShell(threadId);
    if (thread === null) return;
    const broken = yield* wikiCheckouts.value.saveTurn({
      threadId,
      projectId: thread.projectId,
      worktreePath: thread.worktreePath,
      title: thread.title,
      author: { actor: thread.modelSelection.model, threadId },
    });
    if (broken.length === 0) return;
    const { runs } = yield* projections.getThreadRecords(threadId, ["runs"], { runIds: [runId] });
    if (runs[0] === undefined || runs[0].userMessageId.startsWith(BASE_CHECK_PREFIX)) return;
    const text = ThreadWikiCheckouts.brokenBasesMessage(broken);
    yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`command:${BASE_CHECK_PREFIX}${runId}`),
        threadId,
        messageId: MessageId.make(`${BASE_CHECK_PREFIX}${runId}`),
        text,
        notification: {
          source: { kind: "system" },
          outcome: "updated",
          summary:
            broken.length === 1 ? "A base needs fixing" : `${broken.length} bases need fixing`,
          detail: text,
        },
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: "agent",
        creationSource: "server",
      })
      .pipe(
        Effect.catchTags({
          ThreadManagementProviderInstanceDisabledError: () =>
            Effect.logInfo("orchestration-v2.wiki-base-check.instance-disabled", { threadId }),
        }),
      );
  });

  const finalize: RunFinalizationService["Service"]["finalize"] = Effect.fn(
    "RunFinalizationService.finalize",
  )(function* (input) {
    yield* checkpointCapture
      .execute(input)
      .pipe(
        Effect.mapError(
          (cause) => new RunFinalizationError({ ...input, operation: "capture-checkpoint", cause }),
        ),
      );
    yield* saveWikiEdits(input.threadId, input.runId).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to save a turn's wiki edits", { ...input, cause }),
      ),
    );
    const projection = yield* projections
      .getCheckpointContext(input.threadId)
      .pipe(
        Effect.mapError(
          (cause) => new RunFinalizationError({ ...input, operation: "refresh-workspace", cause }),
        ),
      );
    const cwd = projection.checkpointScopes.find((scope) => scope.id === input.scopeId)?.cwd;
    if (cwd !== undefined) {
      // Retrying a display refresh after the checkpoint is durable blocks the next turn.
      yield* observer.refresh({ cwd, threadId: input.threadId, runId: input.runId }).pipe(
        Effect.catchTags({
          RunFinalizationRefreshError: (cause) =>
            Effect.logWarning("Failed to refresh workspace after checkpoint capture", {
              ...input,
              cause,
            }),
        }),
      );
    }
  });
  return RunFinalizationService.of({ finalize });
});

export const layer = Layer.effect(RunFinalizationService, make);

export const layerObserver = Layer.effect(
  RunFinalizationObserver,
  Effect.gen(function* () {
    const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
    const vcsStatus = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const pullRequests = yield* PullRequestService.PullRequestService;
    return {
      refreshAfterTurn: pullRequests.refreshAfterTurn,
      refresh: Effect.fn("RunFinalizationService.refresh")(
        function* ({ cwd, threadId, runId }) {
          const [, local] = yield* Effect.all(
            [workspaceEntries.refresh(cwd), vcsStatus.refreshLocalStatus(cwd)],
            { concurrency: "unbounded" },
          );
          if (local.refName === null || local.isDefaultRef) return;
          const thread = yield* projections.getThreadShell(threadId);
          if (!thread || thread.branch !== local.refName) return;
          if (thread.activeRunId !== null && thread.activeRunId !== runId) return;
          yield* vcsStatus.refreshPullRequestStatus(cwd).pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to refresh pull request status after run completion", {
                threadId,
                cwd,
                detail: error.message,
              }),
            ),
          );
        },
        (effect, { cwd }) =>
          effect.pipe(Effect.mapError((cause) => new RunFinalizationRefreshError({ cwd, cause }))),
      ),
    };
  }),
);
