// @effect-diagnostics nodeBuiltinImport:off
/* oxlint-disable t3code/no-manual-effect-runtime-in-tests -- This suite's existing harness owns a managed reactor runtime; phase A only relocated the suite unchanged. */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

import {
  ProviderDriverKind,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderInstanceId,
} from "@t3tools/contracts";
import {
  CheckpointRef,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import * as CheckpointStore from "./CheckpointStore.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { CheckpointReactorLive } from "./CheckpointReactor.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import { RuntimeReceiptBusLive } from "../orchestration/Layers/RuntimeReceiptBus.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import { CheckpointReactor } from "../orchestration/Services/CheckpointReactor.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../provider/Services/ProviderService.ts";
import { checkpointRefForThreadTurn } from "./Utils.ts";
import { ServerConfig } from "../config.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ThreadLineService from "./ThreadLineService.ts";
import * as LineBranchStore from "../mercurian/commitTree/LineBranchStore.ts";
import * as RepositoryStore from "../mercurian/repositories/RepositoryStore.ts";
import * as SlotStore from "../mercurian/worktreeSlots/SlotStore.ts";
import * as SlotRegistry from "../mercurian/worktreeSlots/SlotRegistry.ts";
import { WorktreeSlotId } from "../mercurian/worktreeSlots/schema.ts";
import * as SnapshotChain from "../mercurian/worktreeSlots/SnapshotChain.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

type LegacyProviderRuntimeEvent = {
  readonly type: string;
  readonly eventId: EventId;
  readonly provider: ProviderDriverKind;
  readonly createdAt: string;
  readonly threadId: ThreadId;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly payload?: unknown | undefined;
  readonly [key: string]: unknown;
};

function createProviderServiceHarness(
  cwd: string,
  hasSession = true,
  sessionCwd = cwd,
  providerName: ProviderSession["provider"] = ProviderDriverKind.make("codex"),
) {
  const now = "2026-01-01T00:00:00.000Z";
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
  const rollbackConversation = vi.fn(
    (_input: { readonly threadId: ThreadId; readonly numTurns: number }) => Effect.void,
  );
  const assertConversationRollbackSupported = vi.fn<
    ProviderServiceShape["assertConversationRollbackSupported"]
  >(() => Effect.void);

  const unsupported = <A>() =>
    Effect.die(new Error("Unsupported provider call in test")) as Effect.Effect<A, never>;
  const listSessions = () =>
    hasSession
      ? Effect.succeed([
          {
            provider: providerName,
            status: "ready",
            runtimeMode: "full-access",
            threadId: ThreadId.make("thread-1"),
            cwd: sessionCwd,
            createdAt: now,
            updatedAt: now,
          },
        ] satisfies ReadonlyArray<ProviderSession>)
      : Effect.succeed([] as ReadonlyArray<ProviderSession>);
  const service: ProviderServiceShape = {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions,
    getCapabilities: () =>
      Effect.succeed({ sessionModelSwitch: "in-session", groundingRoots: "multi" }),
    assertConversationRollbackSupported,
    getInstanceInfo: (instanceId) =>
      Effect.succeed({
        instanceId,
        driverKind: ProviderDriverKind.make(providerName),
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind: ProviderDriverKind.make(providerName),
          continuationKey: `${providerName}:instance:${instanceId}`,
        },
      }),
    rollbackConversation,
    uploadFeedback: () => unsupported(),
    subscribeEvents: Effect.succeed(Stream.empty),
    get streamEvents() {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  };

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, event as unknown as ProviderRuntimeEvent));
  };

  return {
    service,
    assertConversationRollbackSupported,
    rollbackConversation,
    emit,
  };
}

async function waitForThread(
  readModel: () => Promise<{
    readonly threads: ReadonlyArray<{
      readonly id: ThreadId;
      readonly latestTurn: { readonly turnId: string } | null;
      readonly checkpoints: ReadonlyArray<{ readonly checkpointTurnCount: number }>;
      readonly activities: ReadonlyArray<{ readonly kind: string }>;
    }>;
  }>,
  predicate: (thread: {
    latestTurn: { turnId: string } | null;
    checkpoints: ReadonlyArray<{ checkpointTurnCount: number }>;
    activities: ReadonlyArray<{ kind: string }>;
  }) => boolean,
  timeoutMs = 15_000,
) {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async (): Promise<{
    latestTurn: { turnId: string } | null;
    checkpoints: ReadonlyArray<{ checkpointTurnCount: number }>;
    activities: ReadonlyArray<{ kind: string }>;
  }> => {
    const snapshot = await readModel();
    const thread = snapshot.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    if (thread && predicate(thread)) {
      return thread;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for thread state.");
    }
    await Effect.runPromise(Effect.sleep("10 millis"));
    return poll();
  };
  return poll();
}

async function waitForEvent(
  engine: OrchestrationEngineShape,
  predicate: (event: { type: string }) => boolean,
  timeoutMs = 15_000,
) {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async () => {
    const events = await Effect.runPromise(
      Stream.runCollect(engine.readEvents(0)).pipe(Effect.map((chunk) => Array.from(chunk))),
    );
    if (events.some(predicate)) {
      return events;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for orchestration event.");
    }
    await Effect.runPromise(Effect.sleep("10 millis"));
    return poll();
  };
  return poll();
}

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return NodeChildProcess.execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function initializeGitRepository(cwd: string) {
  NodeFS.mkdirSync(cwd, { recursive: true });
  runGit(cwd, ["init", "--initial-branch=main"]);
  runGit(cwd, ["config", "user.email", "test@example.com"]);
  runGit(cwd, ["config", "user.name", "Test User"]);
  NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "v1\n", "utf8");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "Initial"]);
}

function createGitRepository() {
  const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-checkpoint-handler-"));
  initializeGitRepository(cwd);
  return cwd;
}

function gitRefExists(cwd: string, ref: string): boolean {
  try {
    runGit(cwd, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

function gitShowFileAtRef(cwd: string, ref: string, filePath: string): string {
  return runGit(cwd, ["show", `${ref}:${filePath}`]);
}

async function waitForGitRefExists(cwd: string, ref: string, timeoutMs = 15_000) {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async (): Promise<void> => {
    if (gitRefExists(cwd, ref)) {
      return;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error(`Timed out waiting for git ref '${ref}'.`);
    }
    await Effect.runPromise(Effect.sleep("10 millis"));
    return poll();
  };
  return poll();
}

describe("CheckpointReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    | OrchestrationEngineService
    | CheckpointReactor
    | CheckpointStore.CheckpointStore
    | ProjectionSnapshotQuery,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        NodeFS.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  async function createHarness(options?: {
    readonly hasSession?: boolean;
    readonly seedFilesystemCheckpoints?: boolean;
    readonly projectWorkspaceRoot?: string;
    readonly threadWorktreePath?: string | null;
    readonly threadBranch?: string | null;
    readonly secondThreadSharingWorktree?: boolean;
    readonly localStatusRefName?: string | null;
    readonly providerSessionCwd?: string;
    readonly providerName?: ProviderDriverKind;
    readonly gitStatusRefreshCalls?: Array<string>;
    readonly slotBackedSession?: boolean;
    readonly multiRepositorySlot?: boolean;
    readonly legacySessionWithoutRepositoryRows?: boolean;
  }) {
    const slotRoot = options?.multiRepositorySlot
      ? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-checkpoint-slot-"))
      : null;
    const cwd = slotRoot === null ? createGitRepository() : NodePath.join(slotRoot, "server");
    if (slotRoot !== null) {
      initializeGitRepository(cwd);
    }
    const secondCwd = slotRoot === null ? null : NodePath.join(slotRoot, "web");
    if (secondCwd !== null) {
      initializeGitRepository(secondCwd);
    }
    const lineBranch = "mercurian/checkpoint-line";
    if (options?.slotBackedSession) {
      runGit(cwd, ["checkout", "-b", lineBranch]);
      if (secondCwd !== null) {
        runGit(secondCwd, ["checkout", "-b", lineBranch]);
      }
    }
    const lineBaseOid = runGit(cwd, ["rev-parse", "HEAD^{commit}"]).trim();
    const secondLineBaseOid =
      secondCwd === null ? null : runGit(secondCwd, ["rev-parse", "HEAD^{commit}"]).trim();
    tempDirs.push(slotRoot ?? cwd);
    const provider = createProviderServiceHarness(
      cwd,
      options?.hasSession ?? true,
      options?.providerSessionCwd ?? cwd,
      options?.providerName ?? ProviderDriverKind.make("codex"),
    );
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );
    const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );

    const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-checkpoint-reactor-test-",
    });
    const vcsStatusBroadcasterLayer = Layer.succeed(VcsStatusBroadcaster, {
      getStatus: () => Effect.die("getStatus should not be called in this test"),
      refreshLocalStatus: (cwd: string) =>
        Effect.sync(() => {
          options?.gitStatusRefreshCalls?.push(cwd);
        }).pipe(
          Effect.as({
            isRepo: true,
            hasPrimaryRemote: false,
            isDefaultRef: true,
            refName:
              options?.localStatusRefName !== undefined ? options.localStatusRefName : "main",
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          }),
        ),
      refreshStatus: () => Effect.die("refreshStatus should not be called in this test"),
      streamStatus: () => Stream.empty,
    });
    const lineRootCommitId = MercurianCommitId.make("line-root-1");
    const repositoryId = MercurianRepositoryId.make("repository-1");
    const secondRepositoryId = MercurianRepositoryId.make("repository-2");
    const slotId = WorktreeSlotId.make("project-1:slot-1");
    const settledCommits: string[] = [];
    const settledRepositories: MercurianRepositoryId[] = [];
    const partialStates: boolean[] = [];
    const recordedSnapshots: Array<{
      readonly kind: string;
      readonly departedRef: string | null;
      readonly branchTipOid: string;
    }> = [];
    const recordedRepositorySnapshots: Array<{
      readonly repositoryId: MercurianRepositoryId;
      readonly kind: string;
      readonly departedRef: string | null;
    }> = [];
    const builtLineRoots: MercurianCommitId[] = [];
    const updatedBranches: string[] = [];
    const builtRepositories: MercurianRepositoryId[] = [];
    const emptyRepositoryFacts = {
      snapshotOid: null,
      snapshotKind: null,
      branchTipOid: null,
      departedRef: null,
      branchMovement: null,
      prUrl: null,
    } as const;
    const threadLineServiceLayer = Layer.mock(ThreadLineService.ThreadLineService)({
      resolve: () =>
        Effect.succeed(
          options?.slotBackedSession
            ? Option.some({
                lineRootCommitId,
                homeRepositoryId: repositoryId,
                branch: lineBranch,
                repositories:
                  options?.multiRepositorySlot === true &&
                  options.legacySessionWithoutRepositoryRows !== true
                    ? [
                        { ...emptyRepositoryFacts, repositoryId, repositoryName: "server" },
                        {
                          ...emptyRepositoryFacts,
                          repositoryId: secondRepositoryId,
                          repositoryName: "web",
                        },
                      ]
                    : [],
              })
            : Option.none(),
        ),
      updateBranch: (_threadId, branch) => Effect.sync(() => updatedBranches.push(branch)),
      recordSnapshot: (_threadId, snapshot) =>
        Effect.sync(() => {
          recordedSnapshots.push(snapshot);
          if (snapshot.kind === "settled") settledCommits.push(snapshot.branchTipOid);
          partialStates.push(snapshot.kind === "partial");
        }),
      recordRepositorySnapshot: (_threadId, snapshotRepositoryId, snapshot) =>
        Effect.sync(() => {
          recordedRepositorySnapshots.push({
            repositoryId: snapshotRepositoryId,
            kind: snapshot.kind,
            departedRef: snapshot.departedRef,
          });
        }),
    });
    const slotStoreLayer = Layer.mock(SlotStore.SlotStore)({
      list: () => Effect.succeed([]),
      listAll: Effect.succeed(
        options?.slotBackedSession
          ? [
              {
                slotId,
                projectId: MercurianProjectId.make("project-1"),
                path: slotRoot ?? cwd,
                currentLineRootCommitId: lineRootCommitId,
                members:
                  secondCwd === null
                    ? [{ repositoryId, relativePath: ".", currentBranch: lineBranch }]
                    : [
                        { repositoryId, relativePath: "server", currentBranch: lineBranch },
                        {
                          repositoryId: secondRepositoryId,
                          relativePath: "web",
                          currentBranch: lineBranch,
                        },
                      ],
                createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                lastUsedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
              },
            ]
          : [],
      ),
      get: () => Effect.succeed(Option.none()),
      create: () => Effect.void,
      assign: () => Effect.void,
      updateMemberBranch: () => Effect.void,
      changes: Stream.empty,
    });
    const repositoryStoreLayer = Layer.mock(RepositoryStore.RepositoryStore)({
      getSnapshot: Effect.succeed({
        repositories: [
          {
            repositoryId,
            name: "server",
            path: cwd,
            scripts: [],
            createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
            updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
            hasGit: true,
            hosting: null,
          },
          ...(secondCwd === null
            ? []
            : [
                {
                  repositoryId: secondRepositoryId,
                  name: "web",
                  path: secondCwd,
                  scripts: [],
                  createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                  updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                  hasGit: true,
                  hosting: null,
                },
              ]),
        ],
        projectRepositories: [],
      }),
      changes: Stream.empty,
    });
    const lineBranchStoreLayer = Layer.mock(LineBranchStore.LineBranchStore)({
      listAll: Effect.succeed([]),
      get: ({ lineRootCommitId, repositoryId: requestedRepositoryId }) =>
        Effect.succeed(
          options?.slotBackedSession
            ? Option.some({
                lineRootCommitId,
                repositoryId: requestedRepositoryId,
                branch: lineBranch,
                baseOid:
                  requestedRepositoryId === secondRepositoryId && secondLineBaseOid !== null
                    ? secondLineBaseOid
                    : lineBaseOid,
                built: false,
                repointHold: null,
                createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
              })
            : Option.none(),
        ),
      create: () => Effect.void,
      repointIfUnbuilt: () => Effect.succeed(false),
      markBuilt: ({ lineRootCommitId, repositoryId: builtRepositoryId }) =>
        Effect.sync(() => {
          builtLineRoots.push(lineRootCommitId);
          builtRepositories.push(builtRepositoryId);
        }),
      rename: () => Effect.void,
      recordRepointHold: () => Effect.void,
      changes: Stream.empty,
    });
    const gitVcsDriverLayer = GitVcsDriver.layer.pipe(
      Layer.provide(VcsProcess.layer),
      Layer.provide(NodeServices.layer),
    );
    const checkpointStoreLayer = CheckpointStore.layer.pipe(Layer.provide(VcsDriverRegistry.layer));
    const snapshotChainLayer = SnapshotChain.layer.pipe(
      Layer.provideMerge(gitVcsDriverLayer),
      Layer.provideMerge(checkpointStoreLayer),
      Layer.provideMerge(lineBranchStoreLayer),
      Layer.provideMerge(slotStoreLayer),
    );

    const layer = CheckpointReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(projectionSnapshotLayer),
      Layer.provideMerge(RuntimeReceiptBusLive),
      Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
      Layer.provideMerge(vcsStatusBroadcasterLayer),
      Layer.provideMerge(threadLineServiceLayer),
      Layer.provideMerge(lineBranchStoreLayer),
      Layer.provideMerge(repositoryStoreLayer),
      Layer.provideMerge(slotStoreLayer),
      Layer.provideMerge(SlotRegistry.layer),
      Layer.provideMerge(gitVcsDriverLayer),
      Layer.provideMerge(checkpointStoreLayer),
      Layer.provideMerge(snapshotChainLayer),
      Layer.provideMerge(
        WorkspaceEntries.layer.pipe(
          Layer.provide(WorkspacePaths.layer),
          Layer.provideMerge(VcsDriverRegistry.layer),
        ),
      ),
      Layer.provideMerge(WorkspacePaths.layer),
      Layer.provideMerge(VcsProcess.layer),
      Layer.provideMerge(ServerConfigLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    const reactor = await runtime.runPromise(Effect.service(CheckpointReactor));
    const checkpointStore = await runtime.runPromise(
      Effect.service(CheckpointStore.CheckpointStore),
    );
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));
    const drain = () => Effect.runPromise(reactor.drain);

    const createdAt = "2026-01-01T00:00:00.000Z";
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Test Project",
        workspaceRoot: options?.projectWorkspaceRoot ?? cwd,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine
        .dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-thread-create"),
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: options?.threadBranch ?? null,
          worktreePath: options?.threadWorktreePath ?? cwd,
          createdAt,
        })
        .pipe(
          options?.secondThreadSharingWorktree
            ? Effect.andThen(
                engine.dispatch({
                  type: "thread.create",
                  commandId: CommandId.make("cmd-thread-create-2"),
                  threadId: ThreadId.make("thread-2"),
                  projectId: asProjectId("project-1"),
                  title: "Thread 2",
                  modelSelection: {
                    instanceId: ProviderInstanceId.make("codex"),
                    model: "gpt-5-codex",
                  },
                  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                  runtimeMode: "approval-required",
                  branch: null,
                  worktreePath: options?.threadWorktreePath ?? cwd,
                  createdAt,
                }),
              )
            : Effect.asVoid,
        ),
    );

    if (options?.seedFilesystemCheckpoints ?? true) {
      await runtime.runPromise(
        checkpointStore.captureCheckpoint({
          cwd,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
        }),
      );
      NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "v2\n", "utf8");
      await runtime.runPromise(
        checkpointStore.captureCheckpoint({
          cwd,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
        }),
      );
      NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "v3\n", "utf8");
      await runtime.runPromise(
        checkpointStore.captureCheckpoint({
          cwd,
          checkpointRef: checkpointRefForThreadTurn(ThreadId.make("thread-1"), 2),
        }),
      );
    }

    return {
      engine,
      readModel: () => Effect.runPromise(snapshotQuery.getSnapshot()),
      provider,
      cwd,
      secondCwd,
      drain,
      settledCommits,
      settledRepositories,
      partialStates,
      recordedSnapshots,
      recordedRepositorySnapshots,
      builtLineRoots,
      updatedBranches,
      builtRepositories,
      lineBranch,
      lineRootCommitId,
      repositoryId,
      secondRepositoryId,
      checkpointStore,
    };
  }

  it("captures pre-turn baseline on turn.started and post-turn checkpoint on turn.completed", async () => {
    const harness = await createHarness({ seedFilesystemCheckpoints: false });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-capture"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-1"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-1"),
    });
    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "v2\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-1"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-1"),
      payload: { state: "completed" },
    });

    await waitForEvent(harness.engine, (event) => event.type === "thread.turn-diff-completed");
    const thread = await waitForThread(
      harness.readModel,
      (entry) => entry.latestTurn?.turnId === "turn-1" && entry.checkpoints.length === 1,
    );
    expect(thread.checkpoints[0]?.checkpointTurnCount).toBe(1);
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0)),
    ).toBe(true);
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1)),
    ).toBe(true);
    expect(
      gitShowFileAtRef(
        harness.cwd,
        checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
        "README.md",
      ),
    ).toBe("v1\n");
    expect(
      gitShowFileAtRef(
        harness.cwd,
        checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
        "README.md",
      ),
    ).toBe("v2\n");
  });

  it("captures a settled slot-backed turn without moving or cleaning its branch", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const partialRef = SnapshotChain.lineSnapshotRef(harness.lineRootCommitId);
    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "crashed partial S1\n", "utf8");
    await Effect.runPromise(
      harness.checkpointStore.captureCheckpoint({
        cwd: harness.cwd,
        checkpointRef: partialRef,
      }),
    );
    expect(gitRefExists(harness.cwd, partialRef)).toBe(true);
    const previousSnapshotOid = runGit(harness.cwd, ["rev-parse", partialRef]).trim();

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "settled slot work\n", "utf8");

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-slot-settled"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-slot-settled"),
      payload: { state: "completed" },
    });

    await harness.drain();
    const checkpointRef = checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1);
    const head = runGit(harness.cwd, ["rev-parse", "HEAD"]).trim();
    const snapshotOid = runGit(harness.cwd, ["rev-parse", checkpointRef]).trim();
    expect(snapshotOid).not.toBe(head);
    expect(runGit(harness.cwd, ["rev-parse", `${checkpointRef}^1`]).trim()).toBe(
      previousSnapshotOid,
    );
    expect(runGit(harness.cwd, ["rev-parse", `${checkpointRef}^2`]).trim()).toBe(head);
    expect(runGit(harness.cwd, ["branch", "--show-current"]).trim()).toBe(harness.lineBranch);
    expect(runGit(harness.cwd, ["log", "-1", "--pretty=%s"]).trim()).toBe("Initial");
    expect(runGit(harness.cwd, ["status", "--porcelain"]).trim()).not.toBe("");
    expect(gitShowFileAtRef(harness.cwd, checkpointRef, "README.md")).toBe("settled slot work\n");
    expect(harness.settledCommits).toEqual([head]);
    expect(harness.partialStates).toEqual([false]);
    expect(harness.builtLineRoots.map(String)).toEqual(["line-root-1"]);
    expect(runGit(harness.cwd, ["rev-parse", partialRef]).trim()).toBe(snapshotOid);

    runGit(harness.cwd, ["checkout", "main"]);
    runGit(harness.cwd, ["checkout", harness.lineBranch]);
    if (
      await Effect.runPromise(
        harness.checkpointStore.hasCheckpointRef({ cwd: harness.cwd, checkpointRef: partialRef }),
      )
    ) {
      await Effect.runPromise(
        harness.checkpointStore.restoreCheckpoint({
          cwd: harness.cwd,
          checkpointRef: partialRef,
        }),
      );
    }
    expect(NodeFS.readFileSync(NodePath.join(harness.cwd, "README.md"), "utf8")).toBe(
      "settled slot work\n",
    );

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-next-turn-started-with-settled-tree"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:01:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-after-settled"),
    });
    await harness.drain();
    expect(harness.recordedSnapshots).toHaveLength(1);
    let current = await harness.readModel();
    expect(
      current.threads[0]?.activities.some((activity) => activity.kind === "checkpoint.external"),
    ).toBe(false);

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "outside edit\n", "utf8");
    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-after-outside-edit"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:02:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-after-outside-edit"),
    });
    await harness.drain();
    expect(harness.recordedSnapshots).toHaveLength(2);
    expect(harness.recordedSnapshots[1]).toEqual(expect.objectContaining({ kind: "external" }));
    current = await harness.readModel();
    expect(
      current.threads[0]?.activities.some((activity) => activity.kind === "checkpoint.external"),
    ).toBe(true);
  });

  it("leaves a slot-backed placeholder unsettled until the turn completes", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const threadId = ThreadId.make("thread-1");
    const turnId = asTurnId("turn-placeholder");
    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-placeholder"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId,
      turnId,
    });
    await waitForGitRefExists(harness.cwd, checkpointRefForThreadTurn(threadId, 0));
    await harness.drain();
    const lineRef = SnapshotChain.lineSnapshotRef(harness.lineRootCommitId);
    const initialHead = runGit(harness.cwd, ["rev-parse", "HEAD"]).trim();
    await Effect.runPromise(
      harness.checkpointStore.captureCheckpoint({
        cwd: harness.cwd,
        checkpointRef: lineRef,
        parents: [initialHead],
      }),
    );
    const previousSnapshot = runGit(harness.cwd, ["rev-parse", lineRef]).trim();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-placeholder-slot-capture"),
        threadId,
        turnId,
        completedAt: "2026-01-01T00:00:00.000Z",
        checkpointRef: checkpointRefForThreadTurn(threadId, 1),
        status: "missing",
        files: [],
        assistantMessageId: MessageId.make("assistant-placeholder"),
        checkpointTurnCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await harness.drain();

    expect(harness.recordedSnapshots).toEqual([]);
    let snapshot = await harness.readModel();
    expect(snapshot.threads[0]?.checkpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ turnId, status: "missing", checkpointTurnCount: 1 }),
      ]),
    );

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "placeholder work\n", "utf8");
    runGit(harness.cwd, ["add", "README.md"]);
    runGit(harness.cwd, ["commit", "-m", "commit after placeholder"]);
    const postCommitHead = runGit(harness.cwd, ["rev-parse", "HEAD"]).trim();
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-placeholder"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:01.000Z",
      threadId,
      turnId,
      payload: { state: "completed" },
    });
    await harness.drain();

    const turnRef = checkpointRefForThreadTurn(threadId, 1);
    expect(harness.recordedSnapshots).toEqual([expect.objectContaining({ kind: "settled" })]);
    snapshot = await harness.readModel();
    expect(snapshot.threads[0]?.checkpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          turnId,
          status: "ready",
          checkpointTurnCount: 1,
          snapshotKind: "settled",
          branchMovement: { kind: "added", count: 1 },
        }),
      ]),
    );
    expect(runGit(harness.cwd, ["rev-parse", `${turnRef}^1`]).trim()).toBe(previousSnapshot);
    expect(runGit(harness.cwd, ["rev-parse", `${turnRef}^2`]).trim()).toBe(postCommitHead);

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-after-placeholder-completion"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:02.000Z",
      threadId,
      turnId: asTurnId("turn-after-placeholder"),
    });
    await harness.drain();

    expect(harness.recordedSnapshots.some((recorded) => recorded.kind === "external")).toBe(false);
    snapshot = await harness.readModel();
    expect(
      snapshot.threads[0]?.activities.some((activity) => activity.kind === "checkpoint.external"),
    ).toBe(false);
  });

  it("settles every slot member after a placeholder when the turn completes", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      multiRepositorySlot: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    expect(harness.secondCwd).not.toBeNull();
    const secondCwd = harness.secondCwd!;
    const threadId = ThreadId.make("thread-1");
    const turnId = asTurnId("turn-placeholder-multi");
    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-placeholder-multi"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId,
      turnId,
    });
    const baselineRef = checkpointRefForThreadTurn(threadId, 0);
    await waitForGitRefExists(harness.cwd, baselineRef);
    await waitForGitRefExists(secondCwd, baselineRef);
    await harness.drain();
    const lineRef = SnapshotChain.lineSnapshotRef(harness.lineRootCommitId);
    const primaryInitialHead = runGit(harness.cwd, ["rev-parse", "HEAD"]).trim();
    const secondInitialHead = runGit(secondCwd, ["rev-parse", "HEAD"]).trim();
    await Effect.runPromise(
      Effect.all([
        harness.checkpointStore.captureCheckpoint({
          cwd: harness.cwd,
          checkpointRef: lineRef,
          parents: [primaryInitialHead],
        }),
        harness.checkpointStore.captureCheckpoint({
          cwd: secondCwd,
          checkpointRef: lineRef,
          parents: [secondInitialHead],
        }),
      ]),
    );
    const primaryPreviousSnapshot = runGit(harness.cwd, ["rev-parse", lineRef]).trim();
    const secondPreviousSnapshot = runGit(secondCwd, ["rev-parse", lineRef]).trim();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-placeholder-multi"),
        threadId,
        turnId,
        completedAt: "2026-01-01T00:00:00.000Z",
        checkpointRef: checkpointRefForThreadTurn(threadId, 1),
        status: "missing",
        files: [],
        assistantMessageId: MessageId.make("assistant-placeholder-multi"),
        checkpointTurnCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await harness.drain();
    expect(harness.recordedRepositorySnapshots).toEqual([]);

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "primary commit\n", "utf8");
    runGit(harness.cwd, ["add", "README.md"]);
    runGit(harness.cwd, ["commit", "-m", "commit primary after placeholder"]);
    const primaryHead = runGit(harness.cwd, ["rev-parse", "HEAD"]).trim();
    NodeFS.writeFileSync(NodePath.join(secondCwd, "README.md"), "secondary commit\n", "utf8");
    runGit(secondCwd, ["add", "README.md"]);
    runGit(secondCwd, ["commit", "-m", "commit secondary after placeholder"]);
    const secondHead = runGit(secondCwd, ["rev-parse", "HEAD"]).trim();

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-placeholder-multi"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:01.000Z",
      threadId,
      turnId,
      payload: { state: "completed" },
    });
    await harness.drain();

    const turnRef = checkpointRefForThreadTurn(threadId, 1);
    expect(harness.recordedRepositorySnapshots).toHaveLength(2);
    expect(harness.recordedRepositorySnapshots).toEqual(
      expect.arrayContaining([
        { repositoryId: harness.repositoryId, kind: "settled", departedRef: null },
        { repositoryId: harness.secondRepositoryId, kind: "settled", departedRef: null },
      ]),
    );
    const snapshot = await harness.readModel();
    const checkpoint = snapshot.threads[0]?.checkpoints.find((entry) => entry.turnId === turnId);
    expect(checkpoint?.repositories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repositoryId: harness.repositoryId,
          branchMovement: expect.objectContaining({ kind: "added" }),
        }),
        expect.objectContaining({
          repositoryId: harness.secondRepositoryId,
          branchMovement: expect.objectContaining({ kind: "added" }),
        }),
      ]),
    );
    expect(runGit(harness.cwd, ["rev-parse", `${turnRef}^1`]).trim()).toBe(primaryPreviousSnapshot);
    expect(runGit(secondCwd, ["rev-parse", `${turnRef}^1`]).trim()).toBe(secondPreviousSnapshot);
    expect(runGit(harness.cwd, ["rev-parse", `${turnRef}^2`]).trim()).toBe(primaryHead);
    expect(runGit(secondCwd, ["rev-parse", `${turnRef}^2`]).trim()).toBe(secondHead);
  });

  it("replaces a plain thread placeholder immediately", async () => {
    const harness = await createHarness({
      hasSession: false,
      seedFilesystemCheckpoints: false,
    });
    const threadId = ThreadId.make("thread-1");
    const turnId = asTurnId("turn-placeholder-plain");

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-placeholder-plain"),
        threadId,
        turnId,
        completedAt: "2026-01-01T00:00:00.000Z",
        checkpointRef: checkpointRefForThreadTurn(threadId, 1),
        status: "missing",
        files: [],
        assistantMessageId: MessageId.make("assistant-placeholder-plain"),
        checkpointTurnCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await harness.drain();

    const snapshot = await harness.readModel();
    expect(snapshot.threads[0]?.checkpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ turnId, status: "ready", checkpointTurnCount: 1 }),
      ]),
    );
  });

  it("captures exactly once when placeholder and runtime completion race", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const threadId = ThreadId.make("thread-1");
    const turnId = asTurnId("turn-raced-completion");
    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "raced work\n", "utf8");
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-raced-placeholder"),
        threadId,
        turnId,
        completedAt: "2026-01-01T00:00:00.000Z",
        checkpointRef: checkpointRefForThreadTurn(threadId, 1),
        status: "missing",
        files: [],
        assistantMessageId: MessageId.make("assistant-raced"),
        checkpointTurnCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-raced-runtime-completion"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId,
      turnId,
      payload: { state: "completed" },
    });
    await harness.drain();

    expect(harness.recordedSnapshots).toHaveLength(1);
    expect(harness.recordedSnapshots[0]).toEqual(expect.objectContaining({ kind: "settled" }));
  });

  it("keeps the settled capture when a placeholder lands after completion", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const threadId = ThreadId.make("thread-1");
    const turnId = asTurnId("turn-late-placeholder");
    NodeFS.writeFileSync(
      NodePath.join(harness.cwd, "README.md"),
      "late placeholder work\n",
      "utf8",
    );
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-late-placeholder-completion"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId,
      turnId,
      payload: { state: "completed" },
    });
    await harness.drain();
    const turnRef = checkpointRefForThreadTurn(threadId, 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-late-placeholder"),
        threadId,
        turnId,
        completedAt: "2026-01-01T00:00:01.000Z",
        checkpointRef: CheckpointRef.make("provider-diff:evt-late"),
        status: "missing",
        files: [],
        assistantMessageId: MessageId.make("assistant-late-placeholder"),
        checkpointTurnCount: 1,
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    await harness.drain();

    expect(harness.recordedSnapshots).toEqual([expect.objectContaining({ kind: "settled" })]);
    const snapshot = await harness.readModel();
    const checkpoint = snapshot.threads[0]?.checkpoints.find((entry) => entry.turnId === turnId);
    expect(checkpoint).toEqual(
      expect.objectContaining({
        status: "ready",
        checkpointRef: turnRef,
        snapshotKind: "settled",
      }),
    );
  });

  it("keeps a placeholder turn partial when completion is interrupted", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const threadId = ThreadId.make("thread-1");
    const turnId = asTurnId("turn-placeholder-interrupted");
    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-placeholder-interrupted"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId,
      turnId,
    });
    await waitForGitRefExists(harness.cwd, checkpointRefForThreadTurn(threadId, 0));
    await harness.drain();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make("cmd-placeholder-interrupted"),
        threadId,
        turnId,
        completedAt: "2026-01-01T00:00:00.000Z",
        checkpointRef: checkpointRefForThreadTurn(threadId, 1),
        status: "missing",
        files: [],
        assistantMessageId: MessageId.make("assistant-placeholder-interrupted"),
        checkpointTurnCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await harness.drain();
    expect(harness.recordedSnapshots).toEqual([]);

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-placeholder-interrupted"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:01.000Z",
      threadId,
      turnId,
      payload: { state: "interrupted" },
    });
    await harness.drain();

    expect(harness.recordedSnapshots).toEqual([expect.objectContaining({ kind: "partial" })]);
  });

  it("keeps interrupted slot-backed work as a partial chained snapshot", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const originalHead = runGit(harness.cwd, ["rev-parse", "HEAD"]).trim();
    NodeFS.writeFileSync(
      NodePath.join(harness.cwd, "README.md"),
      "interrupted slot work\n",
      "utf8",
    );

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-slot-interrupted"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-slot-interrupted"),
      payload: { state: "interrupted" },
    });

    await harness.drain();
    const checkpointRef = checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1);
    expect(runGit(harness.cwd, ["rev-parse", "HEAD"]).trim()).toBe(originalHead);
    expect(gitShowFileAtRef(harness.cwd, checkpointRef, "README.md")).toBe(
      "interrupted slot work\n",
    );
    const snapshot = await harness.readModel();
    const checkpoints = snapshot.threads.find(
      (thread) => thread.id === ThreadId.make("thread-1"),
    )?.checkpoints;
    expect(harness.settledCommits).toEqual([]);
    expect(harness.partialStates).toEqual([true]);
    expect(harness.builtLineRoots.map(String)).toEqual(["line-root-1"]);
    expect(checkpoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ partial: true, snapshotKind: "partial" })]),
    );
  });

  it("records a departed branch without moving the line branch", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const lineTip = runGit(harness.cwd, ["rev-parse", harness.lineBranch]).trim();
    runGit(harness.cwd, ["checkout", "-b", "sibling"]);
    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "departed work\n", "utf8");
    runGit(harness.cwd, ["add", "README.md"]);
    runGit(harness.cwd, ["commit", "-m", "departed commit"]);
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-departed"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-departed"),
      payload: { state: "completed" },
    });
    await harness.drain();
    expect(runGit(harness.cwd, ["rev-parse", harness.lineBranch]).trim()).toBe(lineTip);
    expect(runGit(harness.cwd, ["branch", "--show-current"]).trim()).toBe("sibling");
    expect(harness.recordedSnapshots).toEqual([
      expect.objectContaining({ kind: "settled", departedRef: "refs/heads/sibling" }),
    ]);
    const snapshot = await harness.readModel();
    expect(snapshot.threads[0]?.checkpoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ departedRef: "refs/heads/sibling" })]),
    );
  });

  it("adopts a hand-renamed line branch while settling the turn", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    runGit(harness.cwd, ["branch", "-m", "renamed-by-hand"]);
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-renamed"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-renamed"),
      payload: { state: "completed" },
    });
    await harness.drain();
    expect(harness.recordedSnapshots).toEqual([
      expect.objectContaining({
        kind: "settled",
        departedRef: null,
        branchMovement: { kind: "unchanged" },
      }),
    ]);
    expect(harness.updatedBranches).toEqual(["renamed-by-hand"]);
    const snapshot = await harness.readModel();
    expect(snapshot.threads[0]?.branch).toBe("renamed-by-hand");
    expect(snapshot.threads[0]?.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "line.branch-renamed",
          summary: "Branch renamed to `renamed-by-hand` by hand",
        }),
      ]),
    );
  });

  it("leaves an untouched line unbuilt after a settled turn", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-untouched"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-untouched"),
      payload: { state: "completed" },
    });
    await harness.drain();
    expect(harness.builtLineRoots).toEqual([]);
  });

  it("records a detached HEAD departure without moving the line branch", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const lineTip = runGit(harness.cwd, ["rev-parse", harness.lineBranch]).trim();
    runGit(harness.cwd, ["checkout", "--detach"]);
    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "detached work\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-detached"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-detached"),
      payload: { state: "completed" },
    });
    await harness.drain();
    expect(runGit(harness.cwd, ["rev-parse", harness.lineBranch]).trim()).toBe(lineTip);
    expect(runGit(harness.cwd, ["branch", "--show-current"]).trim()).toBe("");
    expect(harness.recordedSnapshots).toEqual([
      expect.objectContaining({ kind: "settled", departedRef: "detached" }),
    ]);
    const snapshot = await harness.readModel();
    expect(snapshot.threads[0]?.checkpoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ departedRef: "detached" })]),
    );
  });

  it("settles after the recorded branch is deleted with detached HEAD", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const lineCommit = runGit(harness.cwd, ["rev-parse", harness.lineBranch]).trim();
    runGit(harness.cwd, ["checkout", "--detach", lineCommit]);
    runGit(harness.cwd, ["branch", "-D", harness.lineBranch]);
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-deleted-line"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-deleted-line"),
      payload: { state: "completed" },
    });
    await harness.drain();
    expect(harness.recordedSnapshots).toEqual([
      expect.objectContaining({
        kind: "settled",
        departedRef: "detached",
        branchTipOid: lineCommit,
      }),
    ]);
    const snapshot = await harness.readModel();
    expect(snapshot.threads[0]?.checkpoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ departedRef: "detached" })]),
    );
  });

  it("captures dirty work found at turn start as an external snapshot", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "external work\n", "utf8");
    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-external"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-external"),
    });
    await harness.drain();
    const lineRef = SnapshotChain.lineSnapshotRef(harness.lineRootCommitId);
    expect(gitShowFileAtRef(harness.cwd, lineRef, "README.md")).toBe("external work\n");
    expect(harness.recordedSnapshots).toEqual([expect.objectContaining({ kind: "external" })]);
    expect(harness.builtLineRoots.map(String)).toEqual(["line-root-1"]);
    const snapshot = await harness.readModel();
    expect(
      snapshot.threads[0]?.activities.some((activity) => activity.kind === "checkpoint.external"),
    ).toBe(true);
    NodeFS.writeFileSync(NodePath.join(harness.cwd, "agent.txt"), "agent work\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-after-external"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:01:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-external"),
      payload: { state: "completed" },
    });
    await harness.drain();
    const completed = await harness.readModel();
    expect(completed.threads[0]?.checkpoints[0]?.files.map((file) => file.path)).toEqual([
      "agent.txt",
    ]);
  });

  it("does not capture an external snapshot for a clean unmoved line", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-clean-line"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-clean-line"),
    });
    await harness.drain();
    expect(harness.recordedSnapshots).toEqual([]);
    const snapshot = await harness.readModel();
    expect(
      snapshot.threads[0]?.activities.some((activity) => activity.kind === "checkpoint.external"),
    ).toBe(false);
  });

  it("captures external work from the domain turn-start hook", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "domain external work\n", "utf8");

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-domain-external"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("message-domain-external"),
          role: "user",
          text: "start turn",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await harness.drain();

    const lineRef = SnapshotChain.lineSnapshotRef(harness.lineRootCommitId);
    expect(gitShowFileAtRef(harness.cwd, lineRef, "README.md")).toBe("domain external work\n");
    expect(harness.recordedSnapshots).toEqual([expect.objectContaining({ kind: "external" })]);
    const snapshot = await harness.readModel();
    expect(
      snapshot.threads[0]?.activities.some((activity) => activity.kind === "checkpoint.external"),
    ).toBe(true);
  });

  it("refreshes local git status state on turn completion using the session cwd", async () => {
    const gitStatusRefreshCalls: string[] = [];
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      gitStatusRefreshCalls,
    });

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-refresh-local-status"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-refresh-local-status"),
      payload: { state: "completed" },
    });

    await harness.drain();

    expect(gitStatusRefreshCalls).toEqual([harness.cwd]);
  });

  it("adopts a drifted checkout as the thread branch on a dedicated worktree", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      threadBranch: "t3code/original-branch",
      localStatusRefName: "t3code/renamed-by-agent",
    });

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-branch-drift"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-branch-drift"),
      payload: { state: "completed" },
    });

    await harness.drain();
    await waitForEvent(
      harness.engine,
      (event) =>
        event.type === "thread.meta-updated" &&
        (event as unknown as { payload: { branch?: string } }).payload.branch ===
          "t3code/renamed-by-agent",
    );

    const snapshot = await harness.readModel();
    const thread = snapshot.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.branch).toBe("t3code/renamed-by-agent");
  });

  it("does not adopt a drifted checkout when the worktree is shared by another thread", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      threadBranch: "t3code/original-branch",
      localStatusRefName: "t3code/renamed-by-agent",
      secondThreadSharingWorktree: true,
    });

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-branch-drift-shared"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-branch-drift-shared"),
      payload: { state: "completed" },
    });

    await harness.drain();

    const snapshot = await harness.readModel();
    const thread = snapshot.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.branch).toBe("t3code/original-branch");
  });

  it("does not adopt a temporary placeholder checkout as the thread branch", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      threadBranch: "t3code/original-branch",
      localStatusRefName: "t3code/0a1b2c3d",
    });

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-branch-drift-temp"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-branch-drift-temp"),
      payload: { state: "completed" },
    });

    await harness.drain();

    const snapshot = await harness.readModel();
    const thread = snapshot.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.branch).toBe("t3code/original-branch");
  });

  it("ignores auxiliary thread turn completion while primary turn is active", async () => {
    const harness = await createHarness({ seedFilesystemCheckpoints: false });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-primary-running"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-main"),
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-main"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-main"),
    });
    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "v2\n", "utf8");

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-aux"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-aux"),
      payload: { state: "completed" },
    });

    await harness.drain();
    const midReadModel = await harness.readModel();
    const midThread = midReadModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(midThread?.checkpoints).toHaveLength(0);

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-main"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-main"),
      payload: { state: "completed" },
    });

    const thread = await waitForThread(
      harness.readModel,
      (entry) => entry.latestTurn?.turnId === "turn-main" && entry.checkpoints.length === 1,
    );
    expect(thread.checkpoints[0]?.checkpointTurnCount).toBe(1);
  });

  it("captures pre-turn and completion checkpoints for claude runtime events", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      providerName: ProviderDriverKind.make("claudeAgent"),
    });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-capture-claude"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-claude-1"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-claude-1"),
    });
    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "v2\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-claude-1"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-claude-1"),
      payload: { state: "completed" },
    });

    await waitForEvent(harness.engine, (event) => event.type === "thread.turn-diff-completed");
    const thread = await waitForThread(
      harness.readModel,
      (entry) => entry.latestTurn?.turnId === "turn-claude-1" && entry.checkpoints.length === 1,
    );

    expect(thread.checkpoints[0]?.checkpointTurnCount).toBe(1);
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1)),
    ).toBe(true);
  });

  it("appends capture failure activity when turn diff summary cannot be derived", async () => {
    const harness = await createHarness({ seedFilesystemCheckpoints: false });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-missing-baseline-diff"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-missing-baseline"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-missing-baseline"),
      payload: { state: "completed" },
    });

    await waitForEvent(harness.engine, (event) => event.type === "thread.turn-diff-completed");
    const thread = await waitForThread(
      harness.readModel,
      (entry) =>
        entry.checkpoints.length === 1 &&
        entry.activities.some((activity) => activity.kind === "checkpoint.capture.failed"),
    );

    expect(thread.checkpoints[0]?.checkpointTurnCount).toBe(1);
    expect(
      thread.activities.some((activity) => activity.kind === "checkpoint.capture.failed"),
    ).toBe(true);
  });

  it("captures pre-turn baseline from project workspace root when thread worktree is unset", async () => {
    const harness = await createHarness({
      hasSession: false,
      seedFilesystemCheckpoints: false,
      threadWorktreePath: null,
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-for-baseline"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("message-user-1"),
          role: "user",
          text: "start turn",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );
    expect(
      gitShowFileAtRef(
        harness.cwd,
        checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
        "README.md",
      ),
    ).toBe("v1\n");
  });

  it("captures turn completion checkpoint from project workspace root when provider session cwd is unavailable", async () => {
    const harness = await createHarness({
      hasSession: false,
      seedFilesystemCheckpoints: false,
      threadWorktreePath: null,
    });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-missing-provider-cwd"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-missing-cwd"),
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "v2\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-missing-provider-cwd"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-missing-cwd"),
      payload: { state: "completed" },
    });

    await waitForEvent(harness.engine, (event) => event.type === "thread.turn-diff-completed");
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1)),
    ).toBe(true);
    expect(
      gitShowFileAtRef(
        harness.cwd,
        checkpointRefForThreadTurn(ThreadId.make("thread-1"), 1),
        "README.md",
      ),
    ).toBe("v2\n");
  });

  it("ignores non-v2 checkpoint.captured runtime events", async () => {
    const harness = await createHarness();
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-checkpoint-captured"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "checkpoint.captured",
      eventId: EventId.make("evt-checkpoint-captured-3"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-3"),
      turnCount: 3,
      status: "completed",
    });

    await harness.drain();
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.checkpoints.some((checkpoint) => checkpoint.checkpointTurnCount === 3)).toBe(
      false,
    );
  });

  it("continues processing runtime events after a single checkpoint runtime failure", async () => {
    const nonRepositorySessionCwd = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-checkpoint-runtime-non-repo-"),
    );
    tempDirs.push(nonRepositorySessionCwd);

    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      providerSessionCwd: nonRepositorySessionCwd,
    });
    const createdAt = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-non-repo-runtime"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-runtime-capture-failure"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-runtime-failure"),
      payload: { state: "completed" },
    });

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-after-runtime-failure"),
      provider: ProviderDriverKind.make("codex"),

      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      turnId: asTurnId("turn-after-runtime-failure"),
    });

    await waitForGitRefExists(
      harness.cwd,
      checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0),
    );
    expect(
      gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.make("thread-1"), 0)),
    ).toBe(true);
  });

  it("snapshots every slot member on settle and marks built only where the tree changed", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      multiRepositorySlot: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    expect(harness.secondCwd).not.toBeNull();
    const secondCwd = harness.secondCwd!;
    const threadId = ThreadId.make("thread-1");
    const primaryHeadBefore = runGit(harness.cwd, ["rev-parse", "HEAD"]).trim();
    const secondHeadBefore = runGit(secondCwd, ["rev-parse", "HEAD"]).trim();

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-multi-slot"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId,
      turnId: asTurnId("turn-multi-slot"),
    });
    const baselineRef = checkpointRefForThreadTurn(threadId, 0);
    await waitForGitRefExists(harness.cwd, baselineRef);
    await waitForGitRefExists(secondCwd, baselineRef);
    await harness.drain();

    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "primary changed\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-multi-slot"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:01.000Z",
      threadId,
      turnId: asTurnId("turn-multi-slot"),
      payload: { state: "completed" },
    });
    await harness.drain();

    const checkpointRef = checkpointRefForThreadTurn(threadId, 1);
    // Neither branch moved: the runtime only snapshots.
    expect(runGit(harness.cwd, ["rev-parse", "HEAD"]).trim()).toBe(primaryHeadBefore);
    expect(runGit(secondCwd, ["rev-parse", "HEAD"]).trim()).toBe(secondHeadBefore);
    expect(runGit(harness.cwd, ["status", "--porcelain"]).trim()).not.toBe("");
    // Both members carry a turn snapshot pinned to their HEAD.
    expect(gitShowFileAtRef(harness.cwd, checkpointRef, "README.md")).toBe("primary changed\n");
    expect(runGit(harness.cwd, ["rev-parse", `${checkpointRef}^1`]).trim()).toBe(primaryHeadBefore);
    expect(runGit(secondCwd, ["rev-parse", `${checkpointRef}^1`]).trim()).toBe(secondHeadBefore);
    expect(runGit(secondCwd, ["rev-parse", `${checkpointRef}^{tree}`]).trim()).toBe(
      runGit(secondCwd, ["rev-parse", "HEAD^{tree}"]).trim(),
    );
    // Built is per repository, read from the chain: only the changed tree counts.
    expect(harness.builtRepositories).toEqual([harness.repositoryId]);
    expect(harness.recordedRepositorySnapshots).toEqual([
      { repositoryId: harness.repositoryId, kind: "settled", departedRef: null },
      { repositoryId: harness.secondRepositoryId, kind: "settled", departedRef: null },
    ]);
    expect(harness.recordedSnapshots).toEqual([expect.objectContaining({ kind: "settled" })]);
    expect(harness.partialStates).toEqual([false]);

    const snapshot = await harness.readModel();
    const checkpoint = snapshot.threads
      .find((thread) => thread.id === threadId)
      ?.checkpoints.at(-1);
    expect(checkpoint?.files).toEqual([expect.objectContaining({ path: "README.md" })]);
    expect(checkpoint?.repositories).toEqual([
      {
        repositoryId: harness.repositoryId,
        repositoryName: "server",
        files: [expect.objectContaining({ path: "README.md" })],
        branchMovement: { kind: "unchanged" },
      },
      {
        repositoryId: harness.secondRepositoryId,
        repositoryName: "web",
        files: [],
        branchMovement: { kind: "unchanged" },
      },
    ]);
  });

  it("uses registry names for repository groups on a legacy session", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      multiRepositorySlot: true,
      legacySessionWithoutRepositoryRows: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const threadId = ThreadId.make("thread-1");
    NodeFS.writeFileSync(NodePath.join(harness.cwd, "README.md"), "legacy session work\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-legacy-slot"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:01.000Z",
      threadId,
      turnId: asTurnId("turn-legacy-slot"),
      payload: { state: "completed" },
    });
    await harness.drain();

    const snapshot = await harness.readModel();
    const checkpoint = snapshot.threads
      .find((thread) => thread.id === threadId)
      ?.checkpoints.at(-1);
    expect(checkpoint?.repositories?.map((repository) => repository.repositoryName)).toEqual([
      "server",
      "web",
    ]);
  });

  it("keeps an interrupted turn's work in every member as partial snapshots", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      multiRepositorySlot: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const secondCwd = harness.secondCwd!;
    const threadId = ThreadId.make("thread-1");
    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-turn-started-multi-partial"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId,
      turnId: asTurnId("turn-multi-partial"),
    });
    const baselineRef = checkpointRefForThreadTurn(threadId, 0);
    await waitForGitRefExists(harness.cwd, baselineRef);
    await waitForGitRefExists(secondCwd, baselineRef);
    await harness.drain();
    NodeFS.writeFileSync(NodePath.join(secondCwd, "README.md"), "secondary partial\n", "utf8");

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-multi-partial"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId,
      turnId: asTurnId("turn-multi-partial"),
      payload: { state: "interrupted" },
    });
    await harness.drain();

    const checkpointRef = checkpointRefForThreadTurn(threadId, 1);
    expect(gitShowFileAtRef(secondCwd, checkpointRef, "README.md")).toBe("secondary partial\n");
    expect(gitRefExists(harness.cwd, checkpointRef)).toBe(true);
    expect(harness.recordedRepositorySnapshots.map((entry) => entry.kind)).toEqual([
      "partial",
      "partial",
    ]);
    expect(harness.builtRepositories).toEqual([harness.secondRepositoryId]);
    expect(harness.partialStates).toEqual([true]);
    const snapshot = await harness.readModel();
    const checkpoint = snapshot.threads
      .find((thread) => thread.id === threadId)
      ?.checkpoints.at(-1);
    expect(checkpoint).toEqual(expect.objectContaining({ partial: true, snapshotKind: "partial" }));
    expect(checkpoint?.repositories?.map((repository) => repository.files.length)).toEqual([0, 1]);
  });

  it("records a departure in any member on the turn and the repository row", async () => {
    const harness = await createHarness({
      seedFilesystemCheckpoints: false,
      slotBackedSession: true,
      multiRepositorySlot: true,
      threadBranch: "mercurian/checkpoint-line",
    });
    const secondCwd = harness.secondCwd!;
    const threadId = ThreadId.make("thread-1");
    runGit(secondCwd, ["checkout", "-b", "feature/elsewhere"]);
    NodeFS.writeFileSync(NodePath.join(secondCwd, "README.md"), "moved away\n", "utf8");
    runGit(secondCwd, ["add", "-A"]);
    runGit(secondCwd, ["commit", "-m", "elsewhere"]);

    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-turn-completed-multi-departed"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId,
      turnId: asTurnId("turn-multi-departed"),
      payload: { state: "completed" },
    });
    await harness.drain();

    expect(harness.recordedRepositorySnapshots).toEqual([
      { repositoryId: harness.repositoryId, kind: "settled", departedRef: null },
      {
        repositoryId: harness.secondRepositoryId,
        kind: "settled",
        departedRef: "refs/heads/feature/elsewhere",
      },
    ]);
    expect(harness.recordedSnapshots).toEqual([
      expect.objectContaining({ kind: "settled", departedRef: "refs/heads/feature/elsewhere" }),
    ]);
    const snapshot = await harness.readModel();
    const checkpoint = snapshot.threads
      .find((thread) => thread.id === threadId)
      ?.checkpoints.at(-1);
    expect(checkpoint?.departedRef).toBe("refs/heads/feature/elsewhere");
    expect(checkpoint?.repositories?.map((repository) => repository.departedRef)).toEqual([
      undefined,
      "refs/heads/feature/elsewhere",
    ]);
  });
});
