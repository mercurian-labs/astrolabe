import { assert, it } from "@effect/vitest";
import {
  CheckpointScopeId,
  CommandId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as ThreadWikiCheckouts from "../wiki/ThreadWikiCheckouts.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as CheckpointCapture from "./CheckpointCaptureService.ts";
import * as CheckpointRollback from "./CheckpointRollbackService.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderSessions from "./ProviderSessionManager.ts";
import * as ProviderTurnControl from "./ProviderTurnControlService.ts";
import * as ProviderTurnStart from "./ProviderTurnStartService.ts";
import * as RunFinalization from "./RunFinalizationService.ts";
import * as RuntimeRequests from "./RuntimeRequestService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ThreadTitles from "./ThreadTitleRegenerationService.ts";

it.effect("completes finalization when the post-checkpoint workspace refresh fails", () => {
  const threadId = ThreadId.make("thread_refresh_failure");
  const runId = RunId.make("run_refresh_failure");
  const scopeId = CheckpointScopeId.make("scope_refresh_failure");
  const captured: string[] = [];
  const layer = RunFinalization.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CheckpointCapture.CheckpointCaptureServiceV2)({
          execute: () =>
            Effect.sync(() => {
              captured.push("checkpoint");
            }),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({}),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getCheckpointContext: () =>
            Effect.succeed({
              runs: [],
              checkpointScopes: [{ id: scopeId, runId, kind: "root_run" as const, cwd: "/repo" }],
              checkpoints: [],
            }),
        }),
        Layer.succeed(RunFinalization.RunFinalizationObserver, {
          refresh: () =>
            Effect.gen(function* () {
              captured.push("refresh");
              return yield* new RunFinalization.RunFinalizationRefreshError({
                cwd: "/repo",
                cause: new Error("Git command timed out"),
              });
            }),
          refreshAfterTurn: () => Effect.void,
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const service = yield* RunFinalization.RunFinalizationService;
    yield* service.finalize({ threadId, runId, scopeId });
    assert.deepEqual(captured, ["checkpoint", "refresh"]);
  }).pipe(Effect.provide(layer));
});

it.effect.each(
  (
    [
      {
        label: "discovers a new PR for the completed run's branch",
        branch: "feature",
        checkedOut: "feature",
        activeRun: null,
        expected: ["/repo"],
      },
      {
        label: "leaves the default branch's PR cache alone",
        branch: "main",
        checkedOut: "main",
        activeRun: null,
        expected: [],
      },
      {
        label: "does not refresh another thread's checkout",
        branch: "feature",
        checkedOut: "other",
        activeRun: null,
        expected: [],
      },
      {
        label: "does not refresh during a newer active run",
        branch: "feature",
        checkedOut: "feature",
        activeRun: "newer-run",
        expected: [],
      },
    ] as const
  ).map((scenario) => [scenario.label, scenario] as const),
)("%s", ([, scenario]) => {
  const refreshed: string[] = [];
  const threadId = ThreadId.make("thread-pr-refresh");
  const runId = RunId.make("completed-run");
  const layer = RunFinalization.layerObserver.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(WorkspaceEntries.WorkspaceEntries)({ refresh: () => Effect.void }),
        Layer.mock(PullRequestService.PullRequestService)({
          refreshAfterTurn: () => Effect.void,
        }),
        Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
          refreshLocalStatus: () =>
            Effect.succeed({
              isRepo: true,
              hasPrimaryRemote: true,
              isDefaultRef: scenario.checkedOut === "main",
              refName: scenario.checkedOut,
              hasWorkingTreeChanges: false,
              workingTree: { files: [], insertions: 0, deletions: 0 },
            }),
          refreshStatus: () =>
            Effect.die("turn completion must preserve known PRs and lookup backoff"),
          refreshPullRequestStatus: (cwd) =>
            Effect.sync(() => {
              refreshed.push(cwd);
              return null;
            }),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              branch: scenario.branch,
              activeRunId: scenario.activeRun === null ? null : RunId.make(scenario.activeRun),
            } as OrchestrationV2ThreadShell),
        }),
      ),
    ),
  );
  return Effect.gen(function* () {
    const observer = yield* RunFinalization.RunFinalizationObserver;
    yield* observer.refresh({ cwd: "/repo", threadId, runId });
    assert.deepEqual(refreshed, [...scenario.expected]);
  }).pipe(Effect.provide(layer));
});

const BROKEN: ThreadWikiCheckouts.BrokenBase = {
  wiki: "Handbook",
  file: "Projects.base",
  path: "/state/wiki-checkouts/thread-base-check/wiki-handbook/Projects.base",
  problems: ["views[0].properties is not a view key and is ignored; did you mean order?"],
};

// A turn's save that leaves a base broken asks this thread once to fix it; the fix's own turn never asks again.
it.effect.each([
  ["a turn that breaks a base gets one follow-up", [BROKEN], "message-user", 1],
  ["a turn whose bases are clean gets none", [], "message-user", 0],
  ["the follow-up's own turn, still broken, gets none", [BROKEN], "wiki-base-check:run-0", 0],
] as const)("%s", ([, broken, userMessageId, followUps]) => {
  const threadId = ThreadId.make("thread-base-check");
  const runId = RunId.make("run-base-check");
  const scopeId = CheckpointScopeId.make("scope-base-check");
  const dispatched: OrchestrationV2ServerCommand[] = [];
  const threads = Layer.mock(ThreadManagement.ThreadManagementService)({
    dispatch: (command) =>
      Effect.sync(() => {
        dispatched.push(command);
        return {} as never;
      }),
  });
  const finalization = RunFinalization.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CheckpointCapture.CheckpointCaptureServiceV2)({ execute: () => Effect.void }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              projectId: ProjectId.make("project-base-check"),
              worktreePath: null,
              title: "Projects",
              modelSelection: { model: "test-model" },
            } as OrchestrationV2ThreadShell),
          getThreadRecords: () =>
            Effect.succeed({
              runs: [{ id: runId, userMessageId: MessageId.make(userMessageId) }],
            } as never),
          getCheckpointContext: () =>
            Effect.succeed({ runs: [], checkpointScopes: [], checkpoints: [] }),
        }),
        Layer.mock(ThreadWikiCheckouts.ThreadWikiCheckouts)({
          saveTurn: () => Effect.succeed(broken),
        }),
        threads,
      ),
    ),
  );
  const executor = EffectWorker.layerExecutor.pipe(
    Layer.provide(
      Layer.mergeAll(
        finalization,
        threads,
        Layer.mock(ProviderSessions.ProviderSessionManagerV2)({}),
        Layer.mock(ProviderTurnControl.ProviderTurnControlServiceV2)({}),
        Layer.mock(ProviderTurnStart.ProviderTurnStartServiceV2)({}),
        Layer.mock(CheckpointRollback.CheckpointRollbackServiceV2)({}),
        Layer.mock(RuntimeRequests.RuntimeRequestServiceV2)({}),
        Layer.mock(ThreadTitles.ThreadTitleRegenerationService)({}),
        ServerSettings.layerTest(),
      ),
    ),
  );
  const outbox = EffectOutbox.layer.pipe(Layer.provide(SqlitePersistence.layerMemory));
  const worker = EffectWorker.layer.pipe(Layer.provideMerge(Layer.merge(executor, outbox)));
  return Effect.gen(function* () {
    yield* (yield* EffectOutbox.EffectOutboxV2).enqueue([
      {
        id: "effect:base-check:capture",
        commandId: CommandId.make("command:base-check:capture"),
        threadId,
        request: { type: "checkpoint.capture", runId, scopeId },
      },
    ]);
    assert.equal(yield* (yield* EffectWorker.OrchestrationEffectWorkerV2).drain(1), 1);
    assert.equal(dispatched.length, followUps);
    const [followUp] = dispatched;
    if (followUp?.type !== "message.dispatch") return;
    assert.equal(followUp.messageId, `wiki-base-check:${runId}`);
    assert.equal(followUp.createdBy, "agent");
    assert.equal(followUp.creationSource, "server");
    assert.equal(followUp.notification?.source.kind, "system");
    assert.include(followUp.text, `${BROKEN.file} in the Handbook wiki (${BROKEN.path}):`);
    assert.include(followUp.text, `- ${BROKEN.problems[0]}`);
  }).pipe(Effect.provide(Layer.fresh(worker)));
});
