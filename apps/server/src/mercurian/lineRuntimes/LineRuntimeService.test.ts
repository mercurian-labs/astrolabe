import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  ProjectId,
  ProviderInstanceId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
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
import type { LineRuntimeRecord } from "./schema.ts";
import { make } from "./LineRuntimeService.ts";

const now = DateTime.makeUnsafe("2026-09-04T12:00:00.000Z");
const planId = PlanId.make("plan-runtime");
const projectId = MercurianProjectId.make("project-runtime");
const orchestrationProjectId = ProjectId.make("orchestration-project");
const repositoryId = MercurianRepositoryId.make("repository");
const lineRootCommitId = MercurianCommitId.make("line-root");
const instanceId = ProviderInstanceId.make("codex");

interface HarnessState {
  runtime: LineRuntimeRecord | null;
  orchestrationProjectId: ProjectId | null;
  branchReady: boolean;
  readonly commands: OrchestrationCommand[];
  claimCount: number;
  claimWait: true | undefined;
  persistedProjectId: ProjectId | null;
}

const makeHarness = Effect.gen(function* () {
  const branchChanges = yield* PubSub.unbounded<void>();
  const branchReads = yield* Queue.unbounded<void>();
  const claims = yield* Queue.unbounded<void>();
  const state: HarnessState = {
    runtime: null,
    orchestrationProjectId,
    branchReady: true,
    commands: [],
    claimCount: 0,
    claimWait: undefined,
    persistedProjectId: null,
  };
  const rootPending = (root: MercurianCommitId) =>
    Effect.sync(() => {
      if (state.runtime === null) return;
      const { forkParentCommitId: _forkParentCommitId, ...runtime } = state.runtime;
      state.runtime = { ...runtime, lineRootCommitId: root };
    });
  const layer = Layer.mergeAll(
    Layer.mock(PlanningStore.PlanningStore)({
      getPlanSnapshot: () =>
        Effect.succeed({
          plan: { planId, projectId, title: "Runtime line" },
          timeline: [],
        } as never),
      getProject: () =>
        Effect.succeed({
          projectId,
          name: "Astrolabe",
          orchestrationProjectId: state.orchestrationProjectId,
          createdAt: now,
          updatedAt: now,
        }),
      setOrchestrationProjectId: (_projectId, value) =>
        Effect.sync(() => {
          state.orchestrationProjectId = value;
          state.persistedProjectId = value;
        }),
    }),
    Layer.mock(RepositoryStore.RepositoryStore)({
      getSnapshot: Effect.succeed({
        repositories: [
          {
            repositoryId,
            name: "astrolabe",
            path: "/repo/astrolabe",
            hasGit: true,
            scripts: [],
          },
        ],
        projectRepositories: [{ projectId, repositoryId }],
      } as never),
    }),
    Layer.mock(ProviderService.ProviderService)({
      getCapabilities: () =>
        Effect.succeed({ sessionModelSwitch: "in-session", groundingRoots: "multi" }),
    }),
    Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
      getActiveProjectByWorkspaceRoot: () =>
        Effect.succeed(Option.some({ id: orchestrationProjectId } as never)),
      getShellSnapshot: () =>
        Effect.succeed({
          projects: [
            {
              id: orchestrationProjectId,
              defaultModelSelection: { instanceId, model: "gpt-5.6" },
            },
          ],
          threads: [],
        } as never),
      getThreadShellById: () => Effect.succeed(Option.none()),
    }),
    Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.sync(() => {
          state.commands.push(command);
          return { sequence: state.commands.length };
        }),
    }),
    Layer.mock(LineRuntimeStore.LineRuntimeStore)({
      getOrNone: (_planId, root) =>
        Effect.succeed(
          state.runtime?.lineRootCommitId === root ? Option.some(state.runtime) : Option.none(),
        ),
      listByPlan: () => Effect.succeed(state.runtime === null ? [] : [state.runtime]),
      getByThreadId: (threadId) =>
        Effect.succeed(
          state.runtime?.threadId === threadId ? Option.some(state.runtime) : Option.none(),
        ),
      create: (input) =>
        Effect.sync(() => {
          state.runtime = {
            ...input,
            snapshotOid: null,
            snapshotKind: null,
            departedRef: null,
            branchMovement: null,
            lineBranchMissingOid: null,
            updatedAt: input.createdAt,
          };
        }),
      updateBranch: (_threadId, branch) =>
        Effect.sync(() => {
          if (state.runtime !== null) state.runtime = { ...state.runtime, branch };
        }),
      rootPending: (_threadId, root) => rootPending(root),
      deleteByThread: () => Effect.sync(() => void (state.runtime = null)),
    }),
    Layer.mock(LineBranchStore.LineBranchStore)({
      get: () =>
        Queue.offer(branchReads, undefined).pipe(
          Effect.as(state.branchReady ? Option.some({} as never) : Option.none()),
        ),
      changes: Stream.fromPubSub(branchChanges),
    }),
    Layer.mock(SlotStore.SlotStore)({ listAll: Effect.succeed([]) }),
    Layer.mock(SlotRegistry.SlotRegistry)({ lease: () => Effect.succeed(Option.none()) }),
    Layer.mock(SlotService.SlotService)({
      claim: (input) =>
        Effect.sync(() => {
          state.claimCount += 1;
          state.claimWait = input.wait;
          return {
            slotId: WorktreeSlotId.make("slot"),
            projectId,
            path: "/worktrees/line",
            currentLineRootCommitId: lineRootCommitId,
            members: [
              {
                repositoryId,
                relativePath: ".",
                currentBranch: "mercurian/runtime-line",
              },
            ],
            createdAt: now,
            lastUsedAt: now,
          } as never;
        }).pipe(Effect.tap(() => Queue.offer(claims, undefined))),
    }),
    Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
      refreshStatus: () => Effect.succeed({} as never),
    }),
    Layer.mock(TerminalManager.TerminalManager)({}),
    Layer.mock(ThreadDeletionReactor.ThreadDeletionReactor)({ drainThrough: () => Effect.void }),
    NodeServices.layer,
  );
  return { state, layer, branchChanges, branchReads, claims, rootPending };
});

const serviceFor = (harness: Effect.Success<typeof makeHarness>) =>
  make.pipe(Effect.provide(harness.layer));

describe("LineRuntimeService", () => {
  it.effect("ensureThread is idempotent and never claims a slot", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const service = yield* serviceFor(harness);
      const first = yield* service.ensureThread({ planId, lineRootCommitId });
      const second = yield* service.ensureThread({ planId, lineRootCommitId });
      assert.strictEqual(second.threadId, first.threadId);
      assert.strictEqual(
        harness.state.commands.filter(({ type }) => type === "thread.create").length,
        1,
      );
      assert.strictEqual(harness.state.claimCount, 0);
    }),
  );

  it.effect("ensureThread lazily records the orchestration project found by workspace root", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.state.orchestrationProjectId = null;
      const service = yield* serviceFor(harness);
      yield* service.ensureThread({ planId, lineRootCommitId });
      assert.strictEqual(harness.state.persistedProjectId, orchestrationProjectId);
      assert.ok(!harness.state.commands.some(({ type }) => type === "project.create"));
    }),
  );

  it.effect("ensureProjectRuntime performs the project lookup without birthing a thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      harness.state.orchestrationProjectId = null;
      const service = yield* serviceFor(harness);
      const resolved = yield* service.ensureProjectRuntime(projectId);
      assert.strictEqual(resolved, orchestrationProjectId);
      assert.strictEqual(harness.state.persistedProjectId, orchestrationProjectId);
      assert.ok(!harness.state.commands.some(({ type }) => type === "thread.create"));
      assert.strictEqual(harness.state.claimCount, 0);
    }),
  );

  it.effect("ensureSlot claims a slot for a line rooted by its first send", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const service = yield* serviceFor(harness);
      const runtime = yield* service.ensureThread({
        planId,
        forkParentCommitId: MercurianCommitId.make("fork-parent"),
      });
      assert.strictEqual(runtime.lineRootCommitId, null);
      yield* harness.rootPending(lineRootCommitId);
      harness.state.branchReady = false;
      const claimed = yield* service
        .ensureSlot({ threadId: runtime.threadId, holder: { kind: "turn" } })
        .pipe(Effect.forkChild);
      yield* Queue.take(harness.branchReads);
      assert.strictEqual(harness.state.claimCount, 0);
      harness.state.branchReady = true;
      yield* PubSub.publish(harness.branchChanges, undefined);
      yield* Queue.take(harness.claims);
      yield* Fiber.join(claimed);
      assert.strictEqual(harness.state.claimWait, true);
      assert.ok(harness.state.commands.some(({ type }) => type === "thread.meta.update"));
    }),
  );

  it.effect("opening a legacy plan-only line births a thread without claiming a slot", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const service = yield* serviceFor(harness);
      const runtime = yield* service.ensureThread({ planId, lineRootCommitId });
      assert.strictEqual(runtime.lineRootCommitId, lineRootCommitId);
      assert.strictEqual(harness.state.claimCount, 0);
    }),
  );
});
