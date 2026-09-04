import { assert, describe, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import {
  MercurianCommitId,
  CodingSessionBlockedError,
  MercurianProjectId,
  MercurianRepositoryId,
  MercurianRepositoryScriptId,
  PlanId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type MercurianRepositoryScript,
  type MercurianStartCodingSessionInput,
  type OrchestrationCommand,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as OrchestrationEngine from "../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadDeletionReactor from "../../orchestration/Services/ThreadDeletionReactor.ts";
import * as ProviderRegistry from "../../provider/Services/ProviderRegistry.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as PlanTurnRegistry from "../planning/PlanTurnRegistry.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as MemorySourceStore from "../memory/MemorySourceStore.ts";
import * as LineBranchStore from "../commitTree/LineBranchStore.ts";
import * as SlotService from "../worktreeSlots/SlotService.ts";
import { WorktreeSlotId } from "../worktreeSlots/schema.ts";
import {
  make,
  codingSessionProviderRefusal,
  withCodingSessionBirthCompensation,
} from "./CodingSessionService.ts";

const isCodingSessionBlockedError = Schema.is(CodingSessionBlockedError);
const isSlotServiceError = Schema.is(SlotService.SlotServiceError);

const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make("codex-work"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-14T00:00:00.000Z",
  models: [{ slug: "gpt-5.6", name: "GPT-5.6", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const planId = PlanId.make("plan-coding-session");
const projectId = MercurianProjectId.make("mercurian-project");
const repositoryId = MercurianRepositoryId.make("repository-server");
const secondRepositoryId = MercurianRepositoryId.make("repository-web");
const parentCommitId = MercurianCommitId.make("ready-revision");
const input: MercurianStartCodingSessionInput = {
  planId,
  parentCommitId,
  runtimeMode: "full-access",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex-work"),
    model: "gpt-5.6",
  },
};

type SagaFailurePoint =
  | "project creation"
  | "thread creation"
  | "worktree creation"
  | "metadata update"
  | "turn start"
  | "leaf transaction";

interface SagaState {
  readonly calls: string[];
  readonly commands: OrchestrationCommand[];
  thread: boolean;
  worktree: boolean;
  branch: boolean;
  leaf: boolean;
  session: boolean;
  terminal: boolean;
  readonly repositoryScripts: MercurianRepositoryScript[];
  readonly terminalOpens: Array<Parameters<TerminalManager.TerminalManager["Service"]["open"]>[0]>;
  readonly terminalWrites: Array<
    Parameters<TerminalManager.TerminalManager["Service"]["write"]>[0]
  >;
  failSetupTerminalId: string | null;
  unrelatedProjectHasSetupScript: boolean;
  poolAtCapacity: boolean;
  missingLineBranch: boolean;
  repositoryPresent: boolean;
  secondRepositoryPresent: boolean;
  memorySourcePresent: boolean;
  groundingRoots: "cwd-only" | "multi";
  appendedUnreachableRepositories: ReadonlyArray<string> | null;
  lineBranchMissing: boolean;
  landedSessionBranch: string | null;
  appendedHomeRepositoryId: string | null;
  failurePoint: SagaFailurePoint | null;
}

function sagaState(overrides: Partial<SagaState> = {}): SagaState {
  return {
    calls: [],
    commands: [],
    thread: false,
    worktree: false,
    branch: true,
    leaf: false,
    session: false,
    terminal: false,
    repositoryScripts: [
      {
        scriptId: MercurianRepositoryScriptId.make("install"),
        name: "Install",
        command: "vp install",
        isSetup: true,
      },
      {
        scriptId: MercurianRepositoryScriptId.make("preview"),
        name: "Preview",
        command: "vp dev",
        isSetup: false,
      },
      {
        scriptId: MercurianRepositoryScriptId.make("generate"),
        name: "Generate",
        command: "vp generate",
        isSetup: true,
      },
    ],
    terminalOpens: [],
    terminalWrites: [],
    failSetupTerminalId: null,
    unrelatedProjectHasSetupScript: false,
    poolAtCapacity: false,
    missingLineBranch: false,
    repositoryPresent: true,
    secondRepositoryPresent: false,
    memorySourcePresent: false,
    groundingRoots: "multi",
    appendedUnreachableRepositories: null,
    lineBranchMissing: false,
    landedSessionBranch: null,
    appendedHomeRepositoryId: null,
    failurePoint: null,
    ...overrides,
  };
}

const fail = (point: SagaFailurePoint) => Effect.die(new Error(point));

function runSaga(state: SagaState, request: MercurianStartCodingSessionInput = input) {
  const dependencies = Layer.mergeAll(
    Layer.mock(PlanningStore.PlanningStore)({
      getPlanSnapshot: () =>
        Effect.succeed({
          plan: { planId, projectId, title: "Coding session birth" },
          timeline: [
            {
              _tag: "plan-revision",
              commitId: parentCommitId,
              parents: [],
              sequence: 1,
              createdAt: DateTime.makeUnsafe("2026-08-14T00:00:00.000Z"),
            },
          ],
          codingSessions: [],
        } as never),
      getPlanTextAt: () => Effect.succeed("# Exact implementation plan\n\nShip this."),
      appendCodingSession: (appendInput) =>
        Effect.gen(function* () {
          state.calls.push("leaf");
          state.appendedUnreachableRepositories = appendInput.unreachableRepositories;
          if (state.failurePoint === "leaf transaction") return yield* fail("leaf transaction");
          state.leaf = true;
          state.session = true;
          state.landedSessionBranch = appendInput.branch;
          state.appendedHomeRepositoryId = appendInput.homeRepositoryId;
          return {
            commitId: MercurianCommitId.make("coding-session-leaf"),
            ...appendInput,
          } as never;
        }),
    }),
    Layer.mock(RepositoryStore.RepositoryStore)({
      getSnapshot: Effect.succeed({
        repositories: state.repositoryPresent
          ? [
              {
                repositoryId,
                name: "astrolabe",
                path: "/repo/astrolabe",
                scripts: state.repositoryScripts,
                hasGit: true,
              },
              ...(state.secondRepositoryPresent || state.memorySourcePresent
                ? [
                    {
                      repositoryId: secondRepositoryId,
                      name: "web",
                      path: "/repo/web",
                      scripts: [
                        {
                          scriptId: MercurianRepositoryScriptId.make("web-install"),
                          name: "Web install",
                          command: "vp web:install",
                          isSetup: true,
                        },
                      ],
                      hasGit: true,
                    },
                  ]
                : []),
            ]
          : [],
        projectRepositories: state.repositoryPresent
          ? [
              { projectId, repositoryId },
              ...(state.secondRepositoryPresent
                ? [{ projectId, repositoryId: secondRepositoryId }]
                : []),
            ]
          : [],
      } as never),
      changes: Stream.empty,
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed([provider()]),
      streamChanges: Stream.empty,
    }),
    Layer.mock(MemorySourceStore.MemorySourceStore)({
      getSource: () =>
        Effect.succeed(
          state.memorySourcePresent
            ? Option.some({
                projectId,
                repositoryId: secondRepositoryId,
                subpath: "notes",
                createdAt: DateTime.makeUnsafe("2026-08-14T00:00:00.000Z"),
                updatedAt: DateTime.makeUnsafe("2026-08-14T00:00:00.000Z"),
              })
            : Option.none(),
        ),
    }),
    Layer.mock(LineBranchStore.LineBranchStore)({
      get: ({ lineRootCommitId, repositoryId }) =>
        Effect.succeed(
          Option.some({
            lineRootCommitId,
            repositoryId,
            branch: "mercurian/coding-session-birth-ready-revi",
            baseOid: "base-oid",
            built: false,
            repointHold: null,
            createdAt: DateTime.makeUnsafe("2026-08-14T00:00:00.000Z"),
          }),
        ),
    }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: () => Effect.die("existing coding-session line branches should not be minted"),
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed({ newWorktreesStartFromOrigin: false } as never),
    }),
    Layer.mock(ProviderService.ProviderService)({
      getCapabilities: () =>
        Effect.succeed({
          sessionModelSwitch: "in-session",
          groundingRoots: state.groundingRoots,
        }),
    }),
    Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
      getActiveProjectByWorkspaceRoot: () =>
        Effect.succeed(
          state.unrelatedProjectHasSetupScript
            ? Option.some({
                id: ProjectId.make("existing-project"),
                title: "Existing project",
                workspaceRoot: "/repo/astrolabe",
                defaultModelSelection: null,
                scripts: [
                  {
                    id: "unrelated-setup",
                    name: "Unrelated setup",
                    command: "do-not-run-this",
                    icon: "configure",
                    runOnWorktreeCreate: true,
                  },
                ],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt: "2026-08-14T00:00:00.000Z",
                deletedAt: null,
              } as never)
            : Option.none(),
        ),
    }),
    Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.gen(function* () {
          state.calls.push(`dispatch:${command.type}`);
          state.commands.push(command);
          if (command.type === "project.create" && state.failurePoint === "project creation") {
            return yield* fail("project creation");
          }
          if (command.type === "thread.create" && state.failurePoint === "thread creation") {
            return yield* fail("thread creation");
          }
          if (command.type === "thread.meta.update" && state.failurePoint === "metadata update") {
            return yield* fail("metadata update");
          }
          if (command.type === "thread.turn.start" && state.failurePoint === "turn start") {
            return yield* fail("turn start");
          }
          if (command.type === "thread.create") state.thread = true;
          if (command.type === "thread.delete") state.thread = false;
          return { sequence: state.commands.length };
        }) as never,
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
      refreshStatus: () =>
        Effect.sync(() => {
          state.calls.push("refresh-status");
          return {} as never;
        }),
    }),
    Layer.mock(TerminalManager.TerminalManager)({
      open: (terminalInput) => {
        state.calls.push(`setup:open:${terminalInput.terminalId}`);
        state.terminalOpens.push(terminalInput);
        if (state.failSetupTerminalId === terminalInput.terminalId) {
          return Effect.fail(
            new TerminalManager.TerminalCwdStatError({
              cwd: terminalInput.cwd,
              cause: new Error("terminal unavailable"),
            }),
          );
        }
        state.terminal = true;
        return Effect.succeed({} as never);
      },
      write: (terminalInput) =>
        Effect.sync(() => {
          state.calls.push(`setup:write:${terminalInput.data}`);
          state.terminalWrites.push(terminalInput);
        }),
    }),
    Layer.mock(ThreadDeletionReactor.ThreadDeletionReactor)({
      drainThrough: () =>
        Effect.sync(() => {
          state.calls.push("cleanup:drain");
          state.terminal = false;
        }),
    }),
    Layer.mock(PlanTurnRegistry.PlanTurnRegistry)({
      activeChainMember: () => Effect.succeed(false),
    }),
    Layer.mock(SlotService.SlotService)({
      claim: () =>
        Effect.gen(function* () {
          state.calls.push("slot:claim");
          if (state.poolAtCapacity) {
            return yield* new SlotService.SlotPoolAtCapacityError({
              projectId,
              poolSize: 1,
            });
          }
          if (state.lineBranchMissing) {
            return yield* new SlotService.LineBranchMissingError({
              lineRootCommitId: parentCommitId,
              repositoryId,
              branch: "mercurian/coding-session-birth-ready-revi",
              commitOid: "line-commit",
            });
          }
          if (state.failurePoint === "worktree creation") return yield* fail("worktree creation");
          state.worktree = true;
          const now = DateTime.makeUnsafe("2026-08-14T00:00:00.000Z");
          return {
            slotId: WorktreeSlotId.make("mercurian-project:slot-1"),
            projectId,
            path: "/worktrees/coding-session",
            currentLineRootCommitId: parentCommitId,
            members: [
              {
                repositoryId,
                relativePath: ".",
                currentBranch: state.missingLineBranch
                  ? null
                  : "mercurian/coding-session-birth-ready-revi",
              },
              ...(state.secondRepositoryPresent || state.memorySourcePresent
                ? [
                    {
                      repositoryId: secondRepositoryId,
                      relativePath: "web",
                      currentBranch: "mercurian/coding-session-birth-ready-revi",
                    },
                  ]
                : []),
            ],
            createdAt: now,
            lastUsedAt: now,
          };
        }),
      release: () =>
        Effect.sync(() => {
          state.calls.push("cleanup:slot");
          state.worktree = false;
          return true;
        }),
    }),
  );

  return make.pipe(
    Effect.flatMap((service) => service.start(request)),
    Effect.provide(Layer.merge(dependencies, NodeServicesLayer)),
  );
}

describe("CodingSessionService validation", () => {
  it("validates the exact provider instance and model", () => {
    assert.strictEqual(codingSessionProviderRefusal(undefined, "gpt-5.6"), "no-instance");
    assert.strictEqual(
      codingSessionProviderRefusal(provider({ enabled: false }), "gpt-5.6"),
      "no-instance",
    );
    assert.strictEqual(
      codingSessionProviderRefusal(provider({ installed: false }), "gpt-5.6"),
      "no-instance",
    );
    assert.strictEqual(
      codingSessionProviderRefusal(provider({ availability: "unavailable" }), "gpt-5.6"),
      "no-instance",
    );
    assert.strictEqual(codingSessionProviderRefusal(provider(), "other"), "model-unavailable");
    assert.strictEqual(codingSessionProviderRefusal(provider(), "gpt-5.6"), null);
  });

  it.effect("builds every birth artifact in order and lands the leaf last", () =>
    Effect.gen(function* () {
      const state = sagaState();
      const result = yield* runSaga(state);
      yield* Effect.yieldNow;
      assert.strictEqual(result.commitId, "coding-session-leaf");
      assert.strictEqual(state.thread, true);
      assert.strictEqual(state.worktree, true);
      assert.strictEqual(state.branch, true);
      assert.strictEqual(state.leaf, true);
      assert.strictEqual(state.session, true);
      const orderedBirthSteps = [
        "slot:claim",
        "dispatch:project.create",
        "dispatch:thread.create",
        "dispatch:thread.meta.update",
        "setup:write:vp install\r",
        "setup:write:vp generate\r",
        "dispatch:thread.turn.start",
        "leaf",
      ];
      assert.deepStrictEqual(
        state.calls.filter((call) => orderedBirthSteps.includes(call)),
        orderedBirthSteps,
      );
      assert.ok(state.calls.includes("refresh-status"));
      const turnIndex = state.calls.indexOf("dispatch:thread.turn.start");
      const metadataIndex = state.commands.findIndex(
        (command) => command.type === "thread.meta.update",
      );
      const metadata = state.commands[metadataIndex];
      assert.ok(metadata?.type === "thread.meta.update");
      if (metadata?.type === "thread.meta.update") {
        assert.strictEqual(metadata.worktreePath, "/worktrees/coding-session");
        assert.deepStrictEqual(metadata.workspaceMembers, [
          {
            repositoryId,
            worktreePath: "/worktrees/coding-session",
          },
        ]);
      }
      assert.ok(
        metadataIndex < state.commands.findIndex((command) => command.type === "thread.turn.start"),
      );
      assert.ok(turnIndex > state.calls.indexOf("setup:write:vp generate\r"));
      assert.ok(state.calls.indexOf("leaf") > turnIndex);
      assert.deepStrictEqual(
        state.terminalOpens.map(({ threadId: _threadId, ...open }) => open),
        [
          {
            terminalId: "setup-repository-server-install",
            cwd: "/worktrees/coding-session",
            worktreePath: "/worktrees/coding-session",
            env: {
              T3CODE_PROJECT_ROOT: "/repo/astrolabe",
              T3CODE_WORKTREE_PATH: "/worktrees/coding-session",
            },
          },
          {
            terminalId: "setup-repository-server-generate",
            cwd: "/worktrees/coding-session",
            worktreePath: "/worktrees/coding-session",
            env: {
              T3CODE_PROJECT_ROOT: "/repo/astrolabe",
              T3CODE_WORKTREE_PATH: "/worktrees/coding-session",
            },
          },
        ],
      );
      assert.deepStrictEqual(
        state.terminalWrites.map(({ threadId: _threadId, ...write }) => write),
        [
          { terminalId: "setup-repository-server-install", data: "vp install\r" },
          { terminalId: "setup-repository-server-generate", data: "vp generate\r" },
        ],
      );
      assert.ok(!state.calls.some((call) => call.includes("setup-preview")));
      assert.ok(!state.calls.some((call) => call.includes("vp dev")));

      const projectCreate = state.commands.find((command) => command.type === "project.create");
      assert.ok(projectCreate?.type === "project.create");
      if (projectCreate?.type === "project.create") {
        assert.strictEqual(projectCreate.title, "astrolabe");
      }
      const threadCreate = state.commands.find((command) => command.type === "thread.create");
      assert.ok(threadCreate?.type === "thread.create");
      if (threadCreate?.type === "thread.create") {
        assert.strictEqual(threadCreate.title, "Coding session birth");
        assert.strictEqual(threadCreate.runtimeMode, "full-access");
        assert.strictEqual(threadCreate.modelSelection.instanceId, "codex-work");
        assert.strictEqual(threadCreate.branch, "mercurian/coding-session-birth-ready-revi");
      }
      const turn = state.commands.find((command) => command.type === "thread.turn.start");
      assert.ok(turn?.type === "thread.turn.start");
      if (turn?.type === "thread.turn.start") {
        assert.strictEqual(turn.message.text, "# Exact implementation plan\n\nShip this.");
        assert.deepStrictEqual(turn.message.attachments, []);
        assert.strictEqual("bootstrap" in turn, false);
      }
    }),
  );

  it.effect("dispatches every slot member and runs setup scripts in each repository", () =>
    Effect.gen(function* () {
      const state = sagaState({ secondRepositoryPresent: true });
      yield* runSaga(state);
      const metadata = state.commands.find((command) => command.type === "thread.meta.update");
      assert.ok(metadata?.type === "thread.meta.update");
      if (metadata?.type === "thread.meta.update") {
        assert.deepStrictEqual(metadata.workspaceMembers, [
          { repositoryId, worktreePath: "/worktrees/coding-session" },
          { repositoryId: secondRepositoryId, worktreePath: "/worktrees/coding-session/web" },
        ]);
      }
      assert.ok(state.calls.includes("setup:write:vp web:install\r"));
      assert.ok(
        state.terminalOpens.some(
          (open) =>
            open.terminalId === "setup-repository-web-web-install" &&
            open.cwd === "/worktrees/coding-session/web",
        ),
      );
    }),
  );

  it.effect("adds the slot memory root to the first-turn text", () =>
    Effect.gen(function* () {
      const state = sagaState({ memorySourcePresent: true });
      yield* runSaga(state);
      const turn = state.commands.find((command) => command.type === "thread.turn.start");
      assert.ok(turn?.type === "thread.turn.start");
      if (turn?.type === "thread.turn.start") {
        assert.include(turn.message.text, "# Exact implementation plan\n\nShip this.");
        assert.include(turn.message.text, "Project memory (durable design truth");
        assert.include(turn.message.text, "/worktrees/coding-session/web/notes");
        assert.include(turn.message.text, "lands on this line's memory branch as its own commit");
      }
    }),
  );

  it.effect("records repositories unreachable by a cwd-only provider", () =>
    Effect.gen(function* () {
      const state = sagaState({
        secondRepositoryPresent: true,
        groundingRoots: "cwd-only",
      });
      yield* runSaga(state);
      assert.deepStrictEqual(state.appendedUnreachableRepositories, ["web"]);
    }),
  );

  it.effect("ignores unrelated project scripts when the repository has no setup scripts", () =>
    Effect.gen(function* () {
      const state = sagaState({
        repositoryScripts: [],
        unrelatedProjectHasSetupScript: true,
      });
      yield* runSaga(state);
      assert.ok(state.calls.includes("slot:claim"));
      assert.ok(!state.calls.includes("dispatch:thread.activity.append"));
      assert.deepStrictEqual(state.terminalOpens, []);
      assert.deepStrictEqual(state.terminalWrites, []);
      assert.ok(!state.calls.some((call) => call.includes("do-not-run-this")));
      assert.ok(state.calls.includes("dispatch:thread.turn.start"));
    }),
  );

  it.effect("records setup launch failure and continues to the turn and leaf", () =>
    Effect.gen(function* () {
      const state = sagaState({ failSetupTerminalId: "setup-repository-server-install" });
      yield* runSaga(state);
      assert.strictEqual(state.leaf, true);
      assert.ok(state.calls.includes("dispatch:thread.activity.append"));
      assert.ok(
        state.calls.indexOf("setup:write:vp generate\r") <
          state.calls.indexOf("dispatch:thread.turn.start"),
      );
      const activity = state.commands.find(
        (command) =>
          command.type === "thread.activity.append" &&
          command.activity.kind === "setup-script.failed",
      );
      assert.ok(activity?.type === "thread.activity.append");
      if (activity?.type === "thread.activity.append") {
        assert.strictEqual(activity.activity.kind, "setup-script.failed");
        assert.strictEqual(activity.activity.tone, "error");
        assert.strictEqual(
          (activity.activity.payload as Record<string, unknown>).scriptId,
          "install",
        );
        assert.strictEqual(
          (activity.activity.payload as Record<string, unknown>).detail,
          "terminal unavailable",
        );
      }
    }),
  );

  it.effect("refuses when the project has no linked git repository", () =>
    Effect.gen(function* () {
      const refusal = yield* runSaga(sagaState({ repositoryPresent: false })).pipe(Effect.flip);
      assert.ok(isCodingSessionBlockedError(refusal));
      if (isCodingSessionBlockedError(refusal)) {
        assert.strictEqual(refusal.reason, "repository-not-git");
      }
    }),
  );

  it.effect("maps a full repository pool to the typed coding-session refusal", () =>
    Effect.gen(function* () {
      const refusal = yield* runSaga(sagaState({ poolAtCapacity: true })).pipe(Effect.flip);
      assert.ok(isCodingSessionBlockedError(refusal));
      if (isCodingSessionBlockedError(refusal)) {
        assert.strictEqual(refusal.reason, "pool-at-capacity");
      }
    }),
  );

  it.effect("maps a missing line branch at claim to a typed refusal", () =>
    Effect.gen(function* () {
      const refusal = yield* runSaga(sagaState({ lineBranchMissing: true })).pipe(Effect.flip);
      assert.ok(isCodingSessionBlockedError(refusal));
      if (isCodingSessionBlockedError(refusal)) {
        assert.strictEqual(refusal.reason, "line-branch-missing");
      }
    }),
  );

  it.effect("records the claimed member's branch on the leaf", () =>
    Effect.gen(function* () {
      const state = sagaState();
      yield* runSaga(state);
      assert.strictEqual(state.landedSessionBranch, "mercurian/coding-session-birth-ready-revi");
      assert.strictEqual(state.appendedHomeRepositoryId, repositoryId);
    }),
  );

  it.effect("refuses when the claimed slot is missing its primary line branch", () =>
    Effect.gen(function* () {
      const refusal = yield* runSaga(sagaState({ missingLineBranch: true })).pipe(Effect.flip);
      assert.ok(isSlotServiceError(refusal));
      if (isSlotServiceError(refusal)) {
        assert.strictEqual(refusal.operation, "claim:lineBranch");
      }
    }),
  );
});

describe("CodingSessionService compensation", () => {
  for (const failurePoint of [
    "project creation",
    "thread creation",
    "worktree creation",
    "metadata update",
    "turn start",
    "leaf transaction",
  ] as const) {
    it.effect(`cleans every artifact after ${failurePoint} fails and re-emits the cause`, () =>
      Effect.gen(function* () {
        const state = sagaState({ failurePoint });
        const result = yield* Effect.exit(runSaga(state));
        assert.strictEqual(state.thread, false);
        assert.strictEqual(state.worktree, false);
        assert.strictEqual(state.branch, true);
        assert.strictEqual(state.leaf, false);
        assert.strictEqual(state.session, false);
        assert.ok(result._tag === "Failure");
        assert.match(String(Cause.squash(result.cause)), new RegExp(failurePoint, "u"));
        if (
          failurePoint === "metadata update" ||
          failurePoint === "turn start" ||
          failurePoint === "leaf transaction"
        ) {
          assert.ok(state.calls.includes("cleanup:slot"));
        }
        if (
          failurePoint !== "project creation" &&
          failurePoint !== "thread creation" &&
          failurePoint !== "worktree creation"
        ) {
          assert.ok(state.calls.includes("cleanup:drain"));
        }
      }),
    );
  }

  it.effect("waits for deletion cleanup so setup terminals close before releasing the slot", () =>
    Effect.gen(function* () {
      const state = sagaState({ failurePoint: "turn start" });
      yield* Effect.exit(runSaga(state));
      assert.strictEqual(state.terminal, false);
      assert.ok(state.calls.indexOf("cleanup:drain") < state.calls.indexOf("cleanup:slot"));
    }),
  );

  it.effect("runs cleanup uninterruptibly and remains interrupted", () =>
    Effect.gen(function* () {
      const cleaned = yield* Ref.make(false);
      const fiber = yield* Effect.forkChild(
        withCodingSessionBirthCompensation(Effect.never, Ref.set(cleaned, true)),
        { startImmediately: true },
      );
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      assert.strictEqual(yield* Ref.get(cleaned), true);
      assert.ok(exit._tag === "Failure" && Cause.hasInterruptsOnly(exit.cause));
    }),
  );
});
