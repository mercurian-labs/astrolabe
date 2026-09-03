import { assert, describe, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  MercurianRepositoryScriptId,
  PlanId,
  ProjectId,
  ProviderInstanceId,
  type MercurianRepositoryScript,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as OrchestrationEngine from "../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadDeletionReactor from "../../orchestration/Services/ThreadDeletionReactor.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import * as VcsStatusBroadcaster from "../../vcs/VcsStatusBroadcaster.ts";
import * as LineBranchStore from "../commitTree/LineBranchStore.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as SlotRegistry from "../worktreeSlots/SlotRegistry.ts";
import * as SlotService from "../worktreeSlots/SlotService.ts";
import * as SlotStore from "../worktreeSlots/SlotStore.ts";
import { WorktreeSlotId } from "../worktreeSlots/schema.ts";
import * as LineRuntimeStore from "./LineRuntimeStore.ts";
import {
  isLineRuntimeServiceError,
  isRepositoryNotGitError,
  make,
  withLineRuntimeBirthCompensation,
} from "./LineRuntimeService.ts";

const planId = PlanId.make("plan-line-runtime");
const projectId = MercurianProjectId.make("project-line-runtime");
const repositoryId = MercurianRepositoryId.make("repository-server");
const secondRepositoryId = MercurianRepositoryId.make("repository-web");
const lineRootCommitId = MercurianCommitId.make("ready-revision");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" };
const input = {
  planId,
  lineRootCommitId,
  runtimeMode: "full-access" as const,
  modelSelection,
  holder: { kind: "turn" as const },
};

type SagaFailurePoint =
  | "slot claim"
  | "project creation"
  | "thread creation"
  | "metadata update"
  | "runtime record";

interface SagaState {
  readonly calls: string[];
  readonly commands: OrchestrationCommand[];
  thread: boolean;
  slot: boolean;
  record: boolean;
  terminal: boolean;
  readonly repositoryScripts: MercurianRepositoryScript[];
  readonly terminalOpens: Array<Parameters<TerminalManager.TerminalManager["Service"]["open"]>[0]>;
  readonly terminalWrites: Array<
    Parameters<TerminalManager.TerminalManager["Service"]["write"]>[0]
  >;
  failSetupTerminalId: string | null;
  unrelatedProjectHasSetupScript: boolean;
  missingPrimaryLineBranch: boolean;
  lineBranchMissingAtClaim: boolean;
  repositoryPresent: boolean;
  secondRepositoryPresent: boolean;
  secondRepositoryHasGit: boolean;
  groundingRoots: "cwd-only" | "multi";
  recordedUnreachableRepositories: ReadonlyArray<string> | null;
  recordedBranch: string | null;
  recordedHomeRepositoryId: string | null;
  recordedRepositoryIds: ReadonlyArray<string> | null;
  failurePoint: SagaFailurePoint | null;
  claimGate: Deferred.Deferred<void> | null;
  claimEntered: Queue.Queue<void> | null;
  claimWait: boolean | undefined;
  lineBranchRowsPresent: boolean;
  lineBranchSignal: Queue.Queue<void> | null;
}

const scripts: ReadonlyArray<MercurianRepositoryScript> = [
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
];

const sagaState = (overrides: Partial<SagaState> = {}): SagaState => ({
  calls: [],
  commands: [],
  thread: false,
  slot: false,
  record: false,
  terminal: false,
  repositoryScripts: [...scripts],
  terminalOpens: [],
  terminalWrites: [],
  failSetupTerminalId: null,
  unrelatedProjectHasSetupScript: false,
  missingPrimaryLineBranch: false,
  lineBranchMissingAtClaim: false,
  repositoryPresent: true,
  secondRepositoryPresent: false,
  secondRepositoryHasGit: true,
  groundingRoots: "multi",
  recordedUnreachableRepositories: null,
  recordedBranch: null,
  recordedHomeRepositoryId: null,
  recordedRepositoryIds: null,
  failurePoint: null,
  claimGate: null,
  claimEntered: null,
  claimWait: undefined,
  lineBranchRowsPresent: true,
  lineBranchSignal: null,
  ...overrides,
});

const fail = (point: SagaFailurePoint) => Effect.die(new Error(point));

const makeSagaLayer = (state: SagaState) => {
  const now = DateTime.makeUnsafe("2026-09-03T12:00:00.000Z");
  return Layer.mergeAll(
    Layer.mock(PlanningStore.PlanningStore)({
      getPlanSnapshot: () =>
        Effect.succeed({ plan: { planId, projectId, title: "Line runtime birth" } } as never),
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
              ...(state.secondRepositoryPresent
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
                      hasGit: state.secondRepositoryHasGit,
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
    }),
    Layer.mock(ProviderService.ProviderService)({
      getCapabilities: () =>
        Effect.succeed({ sessionModelSwitch: "in-session", groundingRoots: state.groundingRoots }),
    }),
    Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
      getActiveProjectByWorkspaceRoot: () =>
        Effect.succeed(
          state.unrelatedProjectHasSetupScript
            ? Option.some({ id: ProjectId.make("existing-project") } as never)
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
          if (command.type === "thread.create") state.thread = true;
          if (command.type === "thread.delete") state.thread = false;
          return { sequence: state.commands.length };
        }) as never,
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
      refreshStatus: (path) =>
        Effect.sync(() => {
          state.calls.push(`refresh:${path}`);
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
    Layer.mock(SlotService.SlotService)({
      claim: (claimInput) =>
        Effect.gen(function* () {
          state.calls.push("slot:claim");
          state.claimWait = claimInput.wait;
          if (state.claimEntered !== null) yield* Queue.offer(state.claimEntered, undefined);
          if (state.claimGate !== null) yield* Deferred.await(state.claimGate);
          if (state.lineBranchMissingAtClaim) {
            return yield* new SlotService.LineBranchMissingError({
              lineRootCommitId,
              repositoryId,
              branch: "mercurian/line-runtime-ready-revi",
              commitOid: "line-commit",
            });
          }
          if (state.failurePoint === "slot claim") return yield* fail("slot claim");
          state.slot = true;
          return {
            slotId: WorktreeSlotId.make("project-line-runtime:slot-1"),
            projectId,
            path: "/worktrees/line-runtime",
            currentLineRootCommitId: lineRootCommitId,
            members: [
              {
                repositoryId,
                relativePath: ".",
                currentBranch: state.missingPrimaryLineBranch
                  ? null
                  : "mercurian/line-runtime-ready-revi",
              },
              ...(state.secondRepositoryPresent
                ? [
                    {
                      repositoryId: secondRepositoryId,
                      relativePath: "web",
                      currentBranch: "mercurian/line-runtime-ready-revi",
                    },
                  ]
                : []),
            ],
            createdAt: now,
            lastUsedAt: now,
            holder: claimInput.holder,
          } as never;
        }),
      retain: () => Effect.void,
      release: () =>
        Effect.sync(() => {
          state.calls.push("cleanup:slot");
          state.slot = false;
          return true;
        }),
    }),
    Layer.mock(LineBranchStore.LineBranchStore)({
      get: () =>
        Effect.sync(() => (state.lineBranchRowsPresent ? Option.some({} as never) : Option.none())),
      changes:
        state.lineBranchSignal === null ? Stream.never : Stream.fromQueue(state.lineBranchSignal),
    }),
    Layer.mock(SlotStore.SlotStore)({ listAll: Effect.succeed([]) }),
    Layer.mock(SlotRegistry.SlotRegistry)({ lease: () => Effect.succeed(Option.none()) }),
    Layer.mock(LineRuntimeStore.LineRuntimeStore)({
      getOrNone: () => Effect.succeed(Option.none()),
      create: (record) =>
        Effect.gen(function* () {
          state.calls.push("record");
          state.recordedUnreachableRepositories = record.unreachableRepositories;
          state.recordedBranch = record.branch;
          state.recordedHomeRepositoryId = record.homeRepositoryId;
          state.recordedRepositoryIds = record.repositoryIds;
          if (state.failurePoint === "runtime record") return yield* fail("runtime record");
          state.record = true;
        }),
    }),
    NodeServicesLayer,
  );
};

const runSaga = (state: SagaState) =>
  make.pipe(
    Effect.flatMap((service) => service.ensure(input)),
    Effect.provide(makeSagaLayer(state)),
  );

describe("LineRuntimeService", () => {
  it.effect("builds every birth artifact in order", () =>
    Effect.gen(function* () {
      const state = sagaState();
      yield* runSaga(state);
      yield* Effect.yieldNow;
      assert.strictEqual(state.thread, true);
      assert.strictEqual(state.slot, true);
      assert.strictEqual(state.record, true);
      const steps = [
        "slot:claim",
        "dispatch:project.create",
        "dispatch:thread.create",
        "dispatch:thread.meta.update",
        "setup:write:vp install\r",
        "setup:write:vp generate\r",
        "record",
      ];
      assert.deepStrictEqual(
        state.calls.filter((call) => steps.includes(call)),
        steps,
      );
      assert.ok(!state.commands.some((command) => command.type === "thread.turn.start"));
      assert.ok(!state.calls.includes("leaf"));
      const metadata = state.commands.find((command) => command.type === "thread.meta.update");
      assert.ok(metadata?.type === "thread.meta.update");
      assert.deepStrictEqual(metadata.workspaceMembers, [
        { repositoryId, worktreePath: "/worktrees/line-runtime" },
      ]);
      assert.deepStrictEqual(
        state.terminalWrites.map(({ threadId: _threadId, ...write }) => write),
        [
          { terminalId: "setup-repository-server-install", data: "vp install\r" },
          { terminalId: "setup-repository-server-generate", data: "vp generate\r" },
        ],
      );
    }),
  );

  it.effect("dispatches every slot member and runs setup scripts in each repository", () =>
    Effect.gen(function* () {
      const state = sagaState({ secondRepositoryPresent: true });
      yield* runSaga(state);
      const metadata = state.commands.find((command) => command.type === "thread.meta.update");
      assert.ok(metadata?.type === "thread.meta.update");
      assert.deepStrictEqual(metadata.workspaceMembers, [
        { repositoryId, worktreePath: "/worktrees/line-runtime" },
        { repositoryId: secondRepositoryId, worktreePath: "/worktrees/line-runtime/web" },
      ]);
      assert.ok(state.calls.includes("setup:write:vp web:install\r"));
      assert.deepStrictEqual(state.recordedRepositoryIds, [repositoryId, secondRepositoryId]);
    }),
  );

  it.effect("ignores unrelated project scripts when the repository has no setup scripts", () =>
    Effect.gen(function* () {
      const state = sagaState({ repositoryScripts: [], unrelatedProjectHasSetupScript: true });
      yield* runSaga(state);
      assert.deepStrictEqual(state.terminalOpens, []);
      assert.ok(!state.calls.some((call) => call.includes("do-not-run-this")));
      assert.strictEqual(state.record, true);
    }),
  );

  it.effect("records repositories unreachable by a cwd-only provider", () =>
    Effect.gen(function* () {
      const state = sagaState({ secondRepositoryPresent: true, groundingRoots: "cwd-only" });
      yield* runSaga(state);
      assert.deepStrictEqual(state.recordedUnreachableRepositories, ["web"]);
    }),
  );

  it.effect("records setup launch failure and continues", () =>
    Effect.gen(function* () {
      const state = sagaState({ failSetupTerminalId: "setup-repository-server-install" });
      yield* runSaga(state);
      assert.strictEqual(state.record, true);
      assert.ok(state.calls.includes("setup:write:vp generate\r"));
      const failed = state.commands.find(
        (command) =>
          command.type === "thread.activity.append" &&
          command.activity.kind === "setup-script.failed",
      );
      assert.ok(failed?.type === "thread.activity.append");
      assert.strictEqual(
        (failed.activity.payload as Record<string, unknown>).detail,
        "terminal unavailable",
      );
    }),
  );

  it.effect("records the claimed member's branch on the record", () =>
    Effect.gen(function* () {
      const state = sagaState();
      yield* runSaga(state);
      assert.strictEqual(state.recordedBranch, "mercurian/line-runtime-ready-revi");
      assert.strictEqual(state.recordedHomeRepositoryId, repositoryId);
    }),
  );

  it.effect("refuses when the project has no linked git repository", () =>
    Effect.gen(function* () {
      const error = yield* runSaga(sagaState({ repositoryPresent: false })).pipe(Effect.flip);
      assert.ok(isRepositoryNotGitError(error));
    }),
  );

  it.effect("refuses when any linked repository is not git", () =>
    Effect.gen(function* () {
      const error = yield* runSaga(
        sagaState({ secondRepositoryPresent: true, secondRepositoryHasGit: false }),
      ).pipe(Effect.flip);
      assert.ok(isRepositoryNotGitError(error));
    }),
  );

  it.effect("refuses when the claimed slot is missing its primary line branch", () =>
    Effect.gen(function* () {
      const error = yield* runSaga(sagaState({ missingPrimaryLineBranch: true })).pipe(Effect.flip);
      assert.ok(isLineRuntimeServiceError(error));
      if (isLineRuntimeServiceError(error)) {
        assert.strictEqual(error.operation, "ensure:homeLineBranch");
      }
    }),
  );

  it.effect("maps a missing line branch at claim", () =>
    Effect.gen(function* () {
      const error = yield* runSaga(sagaState({ lineBranchMissingAtClaim: true })).pipe(Effect.flip);
      assert.ok(SlotService.isLineBranchMissingError(error));
      if (SlotService.isLineBranchMissingError(error)) {
        assert.strictEqual(error.commitOid, "line-commit");
      }
    }),
  );

  it.effect("waits for the line's branches before claiming a slot", () =>
    Effect.gen(function* () {
      const signal = yield* Queue.unbounded<void>();
      const state = sagaState({ lineBranchRowsPresent: false, lineBranchSignal: signal });
      const fiber = yield* Effect.forkChild(runSaga(state), { startImmediately: true });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      assert.ok(!state.calls.includes("slot:claim"));
      state.lineBranchRowsPresent = true;
      yield* Queue.offer(signal, undefined);
      yield* Fiber.join(fiber);
      assert.ok(state.calls.includes("slot:claim"));
      assert.strictEqual(state.record, true);
    }),
  );

  it.effect("at capacity, ensure waits and completes after a release", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const entered = yield* Queue.unbounded<void>();
      const state = sagaState({ claimGate: gate, claimEntered: entered });
      const fiber = yield* Effect.forkChild(runSaga(state), { startImmediately: true });
      yield* Queue.take(entered);
      assert.strictEqual(state.claimWait, true);
      assert.strictEqual(state.record, false);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(fiber);
      assert.strictEqual(state.record, true);
    }),
  );
});

describe("LineRuntimeService compensation", () => {
  for (const failurePoint of [
    "slot claim",
    "project creation",
    "thread creation",
    "metadata update",
    "runtime record",
  ] as const) {
    it.effect(`cleans every artifact after ${failurePoint} fails and re-emits the cause`, () =>
      Effect.gen(function* () {
        const state = sagaState({ failurePoint });
        const result = yield* Effect.exit(runSaga(state));
        assert.strictEqual(state.thread, false);
        assert.strictEqual(state.slot, false);
        assert.strictEqual(state.record, false);
        assert.ok(result._tag === "Failure");
        assert.match(String(Cause.squash(result.cause)), new RegExp(failurePoint, "u"));
        if (failurePoint === "metadata update" || failurePoint === "runtime record") {
          assert.ok(state.calls.includes("cleanup:drain"));
        }
        if (failurePoint !== "slot claim") assert.ok(state.calls.includes("cleanup:slot"));
      }),
    );
  }

  it.effect("waits for deletion cleanup so setup terminals close before releasing the slot", () =>
    Effect.gen(function* () {
      const state = sagaState({ failurePoint: "runtime record" });
      yield* Effect.exit(runSaga(state));
      assert.strictEqual(state.terminal, false);
      assert.ok(state.calls.indexOf("cleanup:drain") < state.calls.indexOf("cleanup:slot"));
    }),
  );

  it.effect("runs cleanup uninterruptibly and remains interrupted", () =>
    Effect.gen(function* () {
      const cleaned = yield* Ref.make(false);
      const fiber = yield* Effect.forkChild(
        withLineRuntimeBirthCompensation(Effect.never, Ref.set(cleaned, true)),
        { startImmediately: true },
      );
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      assert.strictEqual(yield* Ref.get(cleaned), true);
      assert.ok(exit._tag === "Failure" && Cause.hasInterruptsOnly(exit.cause));
    }),
  );
});
