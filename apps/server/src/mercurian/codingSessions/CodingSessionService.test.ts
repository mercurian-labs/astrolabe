import { assert, describe, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import {
  MercurianCommitId,
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
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import * as OrchestrationEngine from "../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadDeletionReactor from "../../orchestration/Services/ThreadDeletionReactor.ts";
import * as ProviderRegistry from "../../provider/Services/ProviderRegistry.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as PlanTurnRegistry from "../planning/PlanTurnRegistry.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import {
  make,
  codingSessionBranchCasDeleteArgs,
  codingSessionProviderRefusal,
  withCodingSessionBirthCompensation,
} from "./CodingSessionService.ts";

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
const parentCommitId = MercurianCommitId.make("ready-revision");
const input: MercurianStartCodingSessionInput = {
  planId,
  parentCommitId,
  repositoryId,
  baseRef: "main",
  startFromOrigin: true,
  runtimeMode: "full-access",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex-work"),
    model: "gpt-5.6",
  },
};

type SagaFailurePoint =
  | "project creation"
  | "thread creation"
  | "origin fetch/base resolution"
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
  movedBranch: boolean;
  originExists: boolean;
  repositoryPresent: boolean;
  failurePoint: SagaFailurePoint | null;
}

const executeResult = (exitCode = 0, stdout = "") =>
  ({
    exitCode,
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  }) as const;

function sagaState(overrides: Partial<SagaState> = {}): SagaState {
  return {
    calls: [],
    commands: [],
    thread: false,
    worktree: false,
    branch: false,
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
    movedBranch: false,
    originExists: true,
    repositoryPresent: true,
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
          readyCommits: [
            {
              commitId: parentCommitId,
              repositoryId,
              repositoryName: "astrolabe",
            },
          ],
        } as never),
      getPlanTextAt: () => Effect.succeed("# Exact implementation plan\n\nShip this."),
      appendCodingSession: (appendInput) =>
        Effect.gen(function* () {
          state.calls.push("leaf");
          if (state.failurePoint === "leaf transaction") return yield* fail("leaf transaction");
          state.leaf = true;
          state.session = true;
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
            ]
          : [],
        projectRepositories: [{ projectId, repositoryId }],
      } as never),
      changes: Stream.empty,
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed([provider()]),
      streamChanges: Stream.empty,
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
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      remoteExists: () => Effect.succeed(state.originExists),
      fetchRemote: () =>
        state.failurePoint === "origin fetch/base resolution"
          ? (fail("origin fetch/base resolution") as never)
          : Effect.sync(() => state.calls.push("fetch")).pipe(Effect.asVoid),
      resolveRemoteTrackingCommit: () =>
        Effect.succeed({ commitSha: "origin-base-oid", remoteRefName: "origin/main" }),
      createWorktree: (createInput) =>
        Effect.gen(function* () {
          state.calls.push(`worktree:${createInput.refName}`);
          state.branch = true;
          if (state.failurePoint === "worktree creation") return yield* fail("worktree creation");
          state.worktree = true;
          return {
            worktree: {
              refName: createInput.newRefName,
              path: "/worktrees/coding-session",
            },
          } as never;
        }),
      removeWorktree: () =>
        Effect.sync(() => {
          state.calls.push("cleanup:worktree");
          state.worktree = false;
        }),
    }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (executeInput) =>
        Effect.sync(() => {
          if (executeInput.operation === "coding-session-base-ref") {
            state.calls.push("local-base");
            return executeResult(0, "local-base-oid\n");
          }
          state.calls.push("cleanup:branch");
          if (!state.movedBranch) state.branch = false;
          return executeResult(state.movedBranch ? 1 : 0);
        }) as never,
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
      drain: Effect.sync(() => {
        state.calls.push("cleanup:drain");
        state.terminal = false;
      }),
    }),
    Layer.mock(PlanTurnRegistry.PlanTurnRegistry)({
      activeChainMember: () => Effect.succeed(false),
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

  it("builds the fixed compare-and-swap branch delete command", () => {
    assert.deepStrictEqual(codingSessionBranchCasDeleteArgs("mercurian/plan-12345678", "abc123"), [
      "update-ref",
      "-d",
      "refs/heads/mercurian/plan-12345678",
      "abc123",
    ]);
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
        "dispatch:project.create",
        "dispatch:thread.create",
        "fetch",
        "worktree:origin-base-oid",
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
            terminalId: "setup-install",
            cwd: "/worktrees/coding-session",
            worktreePath: "/worktrees/coding-session",
            env: {
              T3CODE_PROJECT_ROOT: "/repo/astrolabe",
              T3CODE_WORKTREE_PATH: "/worktrees/coding-session",
            },
          },
          {
            terminalId: "setup-generate",
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
          { terminalId: "setup-install", data: "vp install\r" },
          { terminalId: "setup-generate", data: "vp generate\r" },
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
        assert.match(threadCreate.branch ?? "", /^mercurian\/coding-session-birth-[0-9a-f]{8}$/u);
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

  it.effect("ignores unrelated project scripts when the repository has no setup scripts", () =>
    Effect.gen(function* () {
      const state = sagaState({
        repositoryScripts: [],
        unrelatedProjectHasSetupScript: true,
        originExists: false,
      });
      yield* runSaga(state);
      assert.ok(state.calls.includes("worktree:main"));
      assert.ok(!state.calls.includes("fetch"));
      assert.ok(!state.calls.includes("dispatch:thread.activity.append"));
      assert.deepStrictEqual(state.terminalOpens, []);
      assert.deepStrictEqual(state.terminalWrites, []);
      assert.ok(!state.calls.some((call) => call.includes("do-not-run-this")));
      assert.ok(state.calls.includes("dispatch:thread.turn.start"));
    }),
  );

  it.effect("records setup launch failure and continues to the turn and leaf", () =>
    Effect.gen(function* () {
      const state = sagaState({ failSetupTerminalId: "setup-install" });
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

  it.effect("passes through the ordinary missing-repository refusal", () =>
    Effect.gen(function* () {
      const refusal = yield* runSaga(sagaState({ repositoryPresent: false })).pipe(Effect.flip);
      assert.ok("_tag" in refusal);
      assert.strictEqual(refusal._tag, "MercurianRepositoryNotFoundError");
    }),
  );
});

describe("CodingSessionService compensation", () => {
  for (const failurePoint of [
    "project creation",
    "thread creation",
    "origin fetch/base resolution",
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
        assert.strictEqual(state.branch, false);
        assert.strictEqual(state.leaf, false);
        assert.strictEqual(state.session, false);
        assert.ok(result._tag === "Failure");
        assert.match(String(Cause.squash(result.cause)), new RegExp(failurePoint, "u"));
        if (
          failurePoint === "metadata update" ||
          failurePoint === "turn start" ||
          failurePoint === "leaf transaction"
        ) {
          assert.ok(
            state.calls.indexOf("cleanup:worktree") < state.calls.indexOf("cleanup:branch"),
          );
        }
        if (failurePoint !== "project creation" && failurePoint !== "thread creation") {
          assert.ok(state.calls.includes("cleanup:drain"));
        }
      }),
    );
  }

  it.effect("preserves a moved branch when compare-and-swap cleanup refuses", () =>
    Effect.gen(function* () {
      const state = sagaState({ failurePoint: "leaf transaction", movedBranch: true });
      const messages: string[] = [];
      const logger = Logger.make(({ message }) => messages.push(String(message)));
      yield* Effect.exit(
        runSaga(state).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false }))),
      );
      assert.strictEqual(state.thread, false);
      assert.strictEqual(state.worktree, false);
      assert.strictEqual(state.branch, true);
      assert.ok(state.calls.includes("cleanup:branch"));
      assert.ok(
        messages.some((message) =>
          message.includes("coding-session cleanup preserved a moved branch"),
        ),
      );
    }),
  );

  it.effect("waits for deletion cleanup so setup terminals close before worktree removal", () =>
    Effect.gen(function* () {
      const state = sagaState({ failurePoint: "turn start" });
      yield* Effect.exit(runSaga(state));
      assert.strictEqual(state.terminal, false);
      assert.ok(state.calls.indexOf("cleanup:drain") < state.calls.indexOf("cleanup:worktree"));
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
