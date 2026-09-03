import { assert, describe, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import {
  EventId,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  ThreadId,
  type OrchestrationCommand,
  type PlanStreamItem,
  type PlanningModelSelection,
  type ProviderRuntimeEvent,
  type ServerProvider,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as OrchestrationEngine from "../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadDeletionReactor from "../../orchestration/Services/ThreadDeletionReactor.ts";
import * as ProviderRegistry from "../../provider/Services/ProviderRegistry.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import { CommitId, HistoryId, type Commit } from "../commitTree/schema.ts";
import * as LineRuntimeService from "../lineRuntimes/LineRuntimeService.ts";
import * as LineRuntimeStore from "../lineRuntimes/LineRuntimeStore.ts";
import type { LineRuntimeRecord } from "../lineRuntimes/schema.ts";
import * as MemoryIndex from "../memory/MemoryIndex.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as PlanTurnRegistry from "../planning/PlanTurnRegistry.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as SlotRegistry from "../worktreeSlots/SlotRegistry.ts";
import * as SlotService from "../worktreeSlots/SlotService.ts";
import * as SlotStore from "../worktreeSlots/SlotStore.ts";
import { WorktreeSlotId } from "../worktreeSlots/schema.ts";
import * as WorkspaceSettingsStore from "../workspace/WorkspaceSettingsStore.ts";
import * as PlanningAssistant from "./PlanningAssistant.ts";
import {
  measureTranscript,
  planningSystemAppendix,
  TRANSCRIPT_FRAMING_MARGIN,
  type TranscriptEntry,
} from "./PlanningPrompt.ts";

const now = DateTime.makeUnsafe("2026-09-03T12:00:00.000Z");
const planId = PlanId.make("plan");
const projectId = MercurianProjectId.make("project");
const repositoryId = MercurianRepositoryId.make("repository");
const claude = ProviderDriverKind.make("claudeAgent");
const claudeInstance = ProviderInstanceId.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");
const codexInstance = ProviderInstanceId.make("codex");

const provider = (
  driver: typeof claude | typeof codex,
  instanceId: typeof claudeInstance | typeof codexInstance,
  model: string,
  overrides: Partial<ServerProvider> = {},
): ServerProvider => ({
  instanceId,
  driver,
  enabled: true,
  installed: true,
  version: "1",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-03T12:00:00.000Z",
  models: [{ slug: model, name: model, isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const claudeProvider = provider(claude, claudeInstance, "opus");
const codexProvider = provider(codex, codexInstance, "gpt-5.4");

const messageItem = (id: string, parents: ReadonlyArray<string> = [], text = id, sequence = 1) => ({
  _tag: "message" as const,
  commitId: MercurianCommitId.make(id),
  parents: parents.map((parent) => MercurianCommitId.make(parent)),
  sequence,
  authorKind: "human" as const,
  text,
  createdAt: now,
});

const commit = (id: string, kind: Commit["kind"], payload: unknown, sequence: number): Commit => ({
  commitId: CommitId.make(id),
  historyId: HistoryId.make("history"),
  sequence,
  kind,
  authorKind: "human",
  parents: [],
  published: true,
  createdAt: now,
  payload,
});

interface HarnessOptions {
  readonly planningModel?: PlanningModelSelection | null;
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly timeline?: ReadonlyArray<ReturnType<typeof messageItem>>;
  readonly unreachableRepositories?: ReadonlyArray<string>;
  readonly lineThreadRuntimeMode?: RuntimeMode;
  readonly repositoryNames?: ReadonlyArray<string>;
  readonly ancestors?: (commitId: CommitId) => ReadonlyArray<Commit>;
  readonly planText?: string;
  readonly spec?: { readonly goal: string; readonly acceptanceCriteria: string } | null;
}

interface HarnessState {
  readonly commands: OrchestrationCommand[];
  readonly ensureInputs: Array<LineRuntimeService.EnsureLineRuntimeInput>;
  readonly appended: Array<Record<string, unknown>>;
  readonly artifactParents: Array<{ readonly kind: "spec" | "plan"; readonly parent: string }>;
  readonly runtimes: Map<string, LineRuntimeRecord>;
  spec: { readonly goal: string; readonly acceptanceCriteria: string } | null;
  planText: string;
}

const makeHarness = (options: HarnessOptions = {}) => {
  let publishEvent = (_event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Effect.die("provider event stream is not initialized");
  const timeline = [...(options.timeline ?? [messageItem("root", [], "First")])];
  const state: HarnessState = {
    commands: [],
    ensureInputs: [],
    appended: [],
    artifactParents: [],
    runtimes: new Map(),
    spec: options.spec ?? null,
    planText: options.planText ?? "",
  };
  let artifactSequence = 0;
  const repositoryNames = options.repositoryNames ?? ["server"];
  const repositorySnapshot = {
    repositories: repositoryNames.map((name, index) => ({
      repositoryId: MercurianRepositoryId.make(`repository-${index}`),
      name,
      path: `/repo/${name}`,
      scripts: [],
      hasGit: true,
    })),
    projectRepositories: repositoryNames.map((_name, index) => ({
      projectId,
      repositoryId: MercurianRepositoryId.make(`repository-${index}`),
    })),
  };
  const providerServiceLayer = Layer.effect(
    ProviderService.ProviderService,
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
      publishEvent = (event) => PubSub.publish(events, event).pipe(Effect.asVoid);
      return ProviderService.ProviderService.of({
        streamEvents: Stream.fromPubSub(events),
      } as never);
    }),
  );
  const dependencies = Layer.mergeAll(
    Layer.mock(PlanningStore.PlanningStore)({
      getPlanSnapshot: () =>
        Effect.succeed({
          plan: { planId, projectId, title: "Plan" },
          timeline,
          planText: state.planText,
          spec: state.spec === null ? null : { document: state.spec },
          codingSessions: [],
          lineRuntimes: [],
        } as never),
      appendAssistantMessage: (input) =>
        Effect.sync(() => {
          state.appended.push(input as never);
          return {
            commitId: MercurianCommitId.make(`assistant-${state.appended.length}`),
          } as never;
        }),
      saveAssistantSpecRevision: (input) =>
        Effect.sync(() => {
          state.artifactParents.push({ kind: "spec", parent: String(input.parentCommitId) });
          state.spec = input.document;
          artifactSequence += 1;
          return { commitId: MercurianCommitId.make(`artifact-${artifactSequence}`) } as never;
        }),
      saveAssistantPlanRevision: (input) =>
        Effect.sync(() => {
          state.artifactParents.push({ kind: "plan", parent: String(input.parentCommitId) });
          state.planText = input.text;
          artifactSequence += 1;
          return { commitId: MercurianCommitId.make(`artifact-${artifactSequence}`) } as never;
        }),
      getPlanTextAt: () => Effect.sync(() => state.planText),
      getSpecAt: () =>
        Effect.sync(() => (state.spec === null ? null : ({ document: state.spec } as never))),
    }),
    Layer.mock(CommitStore.CommitStore)({
      ancestors: ({ commitId }) => Effect.succeed(options.ancestors?.(commitId) ?? []),
    }),
    PlanTurnRegistry.layer,
    Layer.mock(WorkspaceSettingsStore.WorkspaceSettingsStore)({
      getSnapshot: Effect.succeed({
        planningModel:
          options.planningModel === null
            ? null
            : (options.planningModel ?? { provider: claude, model: "opus" }),
      } as never),
    }),
    Layer.mock(RepositoryStore.RepositoryStore)({
      getSnapshot: Effect.succeed(repositorySnapshot as never),
    }),
    Layer.mock(MemoryIndex.MemoryIndex)({}),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed(options.providers ?? [claudeProvider, codexProvider]),
    }),
    providerServiceLayer,
    Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.sync(() => {
          state.commands.push(command);
          return { sequence: state.commands.length };
        }) as never,
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
      getThreadShellById: () =>
        Effect.succeed(
          Option.some({ latestTurn: { state: "running", turnId: "engine-turn" } } as never),
        ),
      getThreadDetailById: () =>
        Effect.succeed(
          Option.some({
            runtimeMode: options.lineThreadRuntimeMode ?? "approval-required",
          } as never),
        ),
    }),
    Layer.mock(LineRuntimeService.LineRuntimeService)({
      ensure: (ensureInput) =>
        Effect.sync(() => {
          state.ensureInputs.push(ensureInput);
          const key = String(ensureInput.lineRootCommitId);
          let runtime = state.runtimes.get(key);
          if (runtime === undefined) {
            runtime = {
              planId,
              lineRootCommitId: ensureInput.lineRootCommitId,
              threadId: ThreadId.make(`thread-${key}`),
              homeRepositoryId: repositoryId,
              branch: `mercurian/${key}`,
              worktreePath: `/tmp/${key}`,
              unreachableRepositories: [...(options.unreachableRepositories ?? [])],
              snapshotOid: null,
              snapshotKind: null,
              departedRef: null,
              branchMovement: null,
              lineBranchMissingOid: null,
              createdAt: now,
              updatedAt: now,
              repositories: [],
            };
            state.runtimes.set(key, runtime);
          }
          return { record: runtime, slotId: WorktreeSlotId.make(`slot-${key}`) };
        }),
    }),
    Layer.mock(LineRuntimeStore.LineRuntimeStore)({
      getOrNone: (_planId, lineRootCommitId) =>
        Effect.succeed(Option.fromNullishOr(state.runtimes.get(String(lineRootCommitId)))),
      listByPlan: () => Effect.succeed([...state.runtimes.values()]),
      recordLineBranchMissing: () => Effect.void,
    }),
    Layer.mock(SlotStore.SlotStore)({ listAll: Effect.succeed([]) }),
    Layer.mock(SlotRegistry.SlotRegistry)({ lease: () => Effect.succeed(Option.none()) }),
    Layer.mock(SlotService.SlotService)({ release: () => Effect.succeed(true) }),
    Layer.mock(ThreadDeletionReactor.ThreadDeletionReactor)({ drainThrough: () => Effect.void }),
    NodeServicesLayer,
  );
  return {
    state,
    emit: (event: ProviderRuntimeEvent) => Effect.suspend(() => publishEvent(event)),
    layer: Layer.provide(PlanningAssistant.layer, dependencies),
  };
};

let eventSequence = 0;
const runtimeEvent = (
  threadId: ThreadId,
  event: Omit<ProviderRuntimeEvent, "eventId" | "provider" | "threadId" | "createdAt">,
): ProviderRuntimeEvent =>
  ({
    eventId: EventId.make(`event-${(eventSequence += 1)}`),
    provider: claude,
    threadId,
    createdAt: "2026-09-03T12:00:00.000Z",
    ...event,
  }) as ProviderRuntimeEvent;

const subscribeFrames = Effect.fn("PlanningAssistantTest.subscribeFrames")(function* (
  planId: PlanId,
) {
  const assistant = yield* PlanningAssistant.PlanningAssistant;
  const frames = yield* Queue.unbounded<PlanStreamItem>();
  yield* Effect.forkScoped(
    assistant.frames(planId).pipe(Stream.runForEach((frame) => Queue.offer(frames, frame))),
    { startImmediately: true },
  );
  yield* Effect.yieldNow;
  return frames;
});

const start = Effect.fn("PlanningAssistantTest.start")(function* (
  frames: Queue.Queue<PlanStreamItem>,
  input: PlanningAssistant.StartTurnInput,
) {
  const assistant = yield* PlanningAssistant.PlanningAssistant;
  yield* assistant.startTurn(input);
  const waiting = yield* Queue.take(frames);
  const running = yield* Queue.take(frames);
  assert.ok(waiting.kind === "turn-started" && waiting.phase === "waiting-for-slot");
  assert.ok(running.kind === "turn-started" && running.phase === "running");
  return running;
});

describe("PlanningAssistant", () => {
  it.effect("dispatches the human commit id and reuses one thread per line", () => {
    const harness = makeHarness({
      timeline: [messageItem("line-a", [], "A", 1), messageItem("line-b", [], "B", 2)],
    });
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      for (const parentCommitId of ["line-a", "line-a", "line-b"]) {
        const frames = yield* subscribeFrames(planId);
        yield* start(frames, {
          planId,
          parentCommitId: CommitId.make(parentCommitId),
          text: parentCommitId,
        });
        if (parentCommitId === "line-a") {
          yield* harness.emit(
            runtimeEvent(ThreadId.make("thread-line-a"), {
              type: "turn.completed",
              payload: { state: "completed" },
            }),
          );
          yield* Queue.take(frames);
        }
      }
      const starts = harness.state.commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
          command.type === "thread.turn.start",
      );
      assert.deepStrictEqual(
        starts.map((command) => String(command.message.messageId)),
        ["line-a", "line-a", "line-b"],
      );
      assert.strictEqual(starts[0]?.threadId, starts[1]?.threadId);
      assert.notStrictEqual(starts[1]?.threadId, starts[2]?.threadId);
      assert.strictEqual(harness.state.runtimes.size, 2);
      yield* assistant.teardownPlan({ planId, commitPartial: false });
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("sets the line thread's runtime mode before the turn only when it changed", () => {
    const harness = makeHarness({ lineThreadRuntimeMode: "approval-required" });
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      yield* assistant.startTurn({
        planId,
        parentCommitId: CommitId.make("root"),
        text: "First",
        runtimeMode: "full-access",
      });
      const types = harness.state.commands.map((command) => command.type);
      const set = harness.state.commands.find(
        (command) => command.type === "thread.runtime-mode.set",
      );
      assert.ok(set !== undefined && set.type === "thread.runtime-mode.set");
      assert.strictEqual(set.runtimeMode, "full-access");
      assert.ok(types.indexOf("thread.runtime-mode.set") < types.indexOf("thread.turn.start"));
      yield* assistant.teardownPlan({ planId, commitPartial: false });
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect(
    "leaves the line thread's runtime mode alone when the turn carries the same one",
    () => {
      const harness = makeHarness({ lineThreadRuntimeMode: "full-access" });
      return Effect.gen(function* () {
        const assistant = yield* PlanningAssistant.PlanningAssistant;
        yield* assistant.startTurn({
          planId,
          parentCommitId: CommitId.make("root"),
          text: "First",
          runtimeMode: "full-access",
        });
        assert.ok(
          !harness.state.commands.some((command) => command.type === "thread.runtime-mode.set"),
        );
        assert.ok(harness.state.commands.some((command) => command.type === "thread.turn.start"));
        yield* assistant.teardownPlan({ planId, commitPartial: false });
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    },
  );

  it.effect("refuses honestly when no planning model is set", () => {
    const harness = makeHarness({ planningModel: null });
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const frames = yield* subscribeFrames(planId);
      yield* assistant.startTurn({ planId, parentCommitId: CommitId.make("root"), text: "First" });
      const refused = yield* Queue.take(frames);
      assert.ok(refused.kind === "turn-refused" && refused.reason === "unset");
      assert.strictEqual(harness.state.commands.length, 0);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("forwards not-signed-in when the planning model's offerer is signed out", () => {
    const harness = makeHarness({
      providers: [
        provider(claude, claudeInstance, "opus", { auth: { status: "unauthenticated" } }),
      ],
    });
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const frames = yield* subscribeFrames(planId);
      yield* assistant.startTurn({ planId, parentCommitId: CommitId.make("root"), text: "First" });
      const refused = yield* Queue.take(frames);
      assert.ok(refused.kind === "turn-refused" && refused.reason === "not-signed-in");
      assert.strictEqual(harness.state.commands.length, 0);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("one turn at a time: a second start refuses as turn-active", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const frames = yield* subscribeFrames(planId);
      yield* start(frames, { planId, parentCommitId: CommitId.make("root"), text: "First" });
      yield* assistant.startTurn({ planId, parentCommitId: CommitId.make("root"), text: "Again" });
      const refused = yield* Queue.take(frames);
      assert.ok(refused.kind === "turn-refused" && refused.reason === "turn-active");
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("runs a turn under the model recorded on its human commit", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const frames = yield* subscribeFrames(planId);
      yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("root"),
        text: "Use Codex",
        ranUnder: { provider: codex, model: "gpt-5.4" },
      });
      assert.deepStrictEqual(harness.state.ensureInputs[0]?.modelSelection, {
        instanceId: codexInstance,
        model: "gpt-5.4",
      });
      const command = harness.state.commands.find((item) => item.type === "thread.turn.start");
      assert.ok(command?.type === "thread.turn.start");
      assert.strictEqual(command.modelSelection?.instanceId, codexInstance);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("runs a bare-seeded turn under the last-used pair stamped on it", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const frames = yield* subscribeFrames(planId);
      yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("root"),
        text: "Use last pair",
        ranUnder: { provider: claude, model: "opus" },
      });
      assert.deepStrictEqual(harness.state.ensureInputs[0]?.modelSelection, {
        instanceId: claudeInstance,
        model: "opus",
      });
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("streams a reply and settles it as the assistant's commit", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const frames = yield* subscribeFrames(planId);
      const running = yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("root"),
        text: "First",
      });
      const threadId =
        harness.state.ensureInputs.length > 0
          ? ThreadId.make("thread-root")
          : ThreadId.make("missing");
      yield* harness.emit(
        runtimeEvent(threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Complete reply" },
        }),
      );
      const delta = yield* Queue.take(frames);
      assert.ok(delta.kind === "turn-delta" && delta.textDelta === "Complete reply");
      yield* harness.emit(
        runtimeEvent(threadId, { type: "turn.completed", payload: { state: "completed" } }),
      );
      const settled = yield* Queue.take(frames);
      assert.ok(settled.kind === "turn-settled" && settled.turnId === running.turnId);
      assert.strictEqual(harness.state.appended[0]?.text, "Complete reply");
      assert.strictEqual(
        harness.state.appended[0]?.generatedBy &&
          (harness.state.appended[0].generatedBy as PlanningModelSelection).model,
        "opus",
      );
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("stopping lands the partial as a commit marked interrupted", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const frames = yield* subscribeFrames(planId);
      const running = yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("root"),
        text: "First",
      });
      const threadId = ThreadId.make("thread-root");
      yield* harness.emit(
        runtimeEvent(threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Partial" },
        }),
      );
      yield* Queue.take(frames);
      yield* assistant.stopTurn({ planId, turnId: running.turnId });
      assert.ok(harness.state.commands.some((command) => command.type === "thread.turn.interrupt"));
      yield* harness.emit(
        runtimeEvent(threadId, { type: "turn.aborted", payload: { reason: "interrupt" } }),
      );
      yield* Queue.take(frames);
      assert.strictEqual(harness.state.appended[0]?.text, "Partial");
      assert.strictEqual(harness.state.appended[0]?.interrupted, true);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("a stop the adapter never answers settles after the grace window", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const frames = yield* subscribeFrames(planId);
      const running = yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("root"),
        text: "First",
      });
      yield* assistant.stopTurn({ planId, turnId: running.turnId });
      yield* TestClock.adjust(Duration.seconds(5));
      yield* Queue.take(frames);
      assert.strictEqual(harness.state.appended.length, 1);
      assert.strictEqual(harness.state.appended[0]?.interrupted, true);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("a question pauses the turn on the person, and the answer resumes it", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const frames = yield* subscribeFrames(planId);
      const running = yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("root"),
        text: "First",
      });
      yield* harness.emit({
        ...runtimeEvent(ThreadId.make("thread-root"), {
          type: "user-input.requested",
          payload: {
            questions: [
              {
                id: "scope",
                header: "Scope",
                question: "Proceed?",
                options: [],
                multiSelect: false,
              },
            ],
          },
        }),
        requestId: "request-scope" as never,
      });
      assert.strictEqual((yield* Queue.take(frames)).kind, "turn-question");
      assert.deepStrictEqual(
        yield* assistant.status,
        new Map([[planId, { isWorking: false, hasPendingInput: true }]]),
      );
      yield* assistant.answerQuestion({
        planId,
        turnId: running.turnId,
        answers: { scope: "Yes" },
      });
      assert.strictEqual((yield* Queue.take(frames)).kind, "turn-question-answered");
      const respond = harness.state.commands.find(
        (command) => command.type === "thread.user-input.respond",
      );
      assert.ok(respond?.type === "thread.user-input.respond");
      assert.strictEqual(respond.requestId, "request-scope");
      assert.deepStrictEqual(respond.answers, { scope: "Yes" });
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("a question pauses only its own turn while the other streams on", () => {
    const harness = makeHarness({
      timeline: [messageItem("left", [], "Left", 1), messageItem("right", [], "Right", 2)],
    });
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const frames = yield* subscribeFrames(planId);
      const left = yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("left"),
        text: "Left",
      });
      yield* start(frames, { planId, parentCommitId: CommitId.make("right"), text: "Right" });
      yield* harness.emit({
        ...runtimeEvent(ThreadId.make("thread-left"), {
          type: "user-input.requested",
          payload: { questions: [{ id: "q", header: "Q", question: "Choose", options: [] }] },
        }),
        requestId: "left-question" as never,
      });
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(ThreadId.make("thread-right"), {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Still working" },
        }),
      );
      const delta = yield* Queue.take(frames);
      assert.ok(delta.kind === "turn-delta" && delta.turnId !== left.turnId);
      assert.deepStrictEqual(
        yield* assistant.status,
        new Map([[planId, { isWorking: true, hasPendingInput: true }]]),
      );
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("streams two branches' replies at once, each settling on its own branch", () => {
    const harness = makeHarness({
      timeline: [messageItem("left", [], "Left", 1), messageItem("right", [], "Right", 2)],
    });
    return Effect.gen(function* () {
      const frames = yield* subscribeFrames(planId);
      yield* start(frames, { planId, parentCommitId: CommitId.make("left"), text: "Left" });
      yield* start(frames, { planId, parentCommitId: CommitId.make("right"), text: "Right" });
      yield* harness.emit(
        runtimeEvent(ThreadId.make("thread-left"), {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Left reply" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(ThreadId.make("thread-right"), {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Right reply" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(ThreadId.make("thread-right"), {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(ThreadId.make("thread-left"), {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames);
      assert.deepStrictEqual(
        harness.state.appended.map((entry) => [entry.parentCommitId, entry.text]),
        [
          ["right", "Right reply"],
          ["left", "Left reply"],
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("stopping one branch's reply leaves the other streaming", () => {
    const harness = makeHarness({
      timeline: [messageItem("left", [], "Left", 1), messageItem("right", [], "Right", 2)],
    });
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const frames = yield* subscribeFrames(planId);
      const left = yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("left"),
        text: "Left",
      });
      const right = yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("right"),
        text: "Right",
      });
      yield* assistant.stopTurn({ planId, turnId: left.turnId });
      yield* harness.emit(
        runtimeEvent(ThreadId.make("thread-left"), {
          type: "turn.aborted",
          payload: { reason: "interrupt" },
        }),
      );
      yield* Queue.take(frames);
      const inFlight = yield* assistant.inFlightTurns(planId);
      assert.deepStrictEqual(
        inFlight.map((turn) => turn.turnId),
        [right.turnId],
      );
      yield* harness.emit(
        runtimeEvent(ThreadId.make("thread-right"), {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Right continues" },
        }),
      );
      assert.strictEqual((yield* Queue.take(frames)).kind, "turn-delta");
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("keeps different providers local to two forked branches", () => {
    const harness = makeHarness({
      timeline: [messageItem("left", [], "Left", 1), messageItem("right", [], "Right", 2)],
    });
    return Effect.gen(function* () {
      const frames = yield* subscribeFrames(planId);
      yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("left"),
        text: "Left",
        ranUnder: { provider: claude, model: "opus" },
      });
      yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("right"),
        text: "Right",
        ranUnder: { provider: codex, model: "gpt-5.4" },
      });
      assert.deepStrictEqual(
        harness.state.ensureInputs.map((entry) => entry.modelSelection),
        [
          { instanceId: claudeInstance, model: "opus" },
          { instanceId: codexInstance, model: "gpt-5.4" },
        ],
      );
      const starts = harness.state.commands.filter(
        (command) => command.type === "thread.turn.start",
      );
      assert.strictEqual(
        starts[0]?.type === "thread.turn.start" && starts[0].modelSelection?.instanceId,
        claudeInstance,
      );
      assert.strictEqual(
        starts[1]?.type === "thread.turn.start" && starts[1].modelSelection?.instanceId,
        codexInstance,
      );
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("the MCP artifact doors write at the turn's tip and keep the chain linear", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const frames = yield* subscribeFrames(planId);
      yield* start(frames, { planId, parentCommitId: CommitId.make("root"), text: "First" });
      const threadId = ThreadId.make("thread-root");
      const refused = yield* assistant
        .saveRevisionFromThread({ threadId: ThreadId.make("other"), text: "x" })
        .pipe(Effect.flip);
      assert.strictEqual(refused._tag, "PlanningTurnNotFoundError");
      yield* assistant.saveSpecRevisionFromThread({
        threadId,
        document: { goal: "Goal", acceptanceCriteria: "Criteria" },
      });
      yield* assistant.saveRevisionFromThread({ threadId, text: "# Revised" });
      assert.deepStrictEqual(harness.state.artifactParents, [
        { kind: "spec", parent: "root" },
        { kind: "plan", parent: "artifact-1" },
      ]);
      assert.strictEqual(yield* assistant.readPlanFromThread({ threadId }), "# Revised");
      assert.deepStrictEqual(yield* assistant.readSpecFromThread({ threadId }), {
        goal: "Goal",
        acceptanceCriteria: "Criteria",
      });
      yield* harness.emit(
        runtimeEvent(threadId, { type: "turn.completed", payload: { state: "completed" } }),
      );
      yield* Queue.take(frames);
      assert.strictEqual(harness.state.appended[0]?.parentCommitId, "artifact-2");
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("narrows visibly for a cwd-only provider", () => {
    const harness = makeHarness({ unreachableRepositories: ["web", "project-memory"] });
    return Effect.gen(function* () {
      const frames = yield* subscribeFrames(planId);
      const running = yield* start(frames, {
        planId,
        parentCommitId: CommitId.make("root"),
        text: "First",
      });
      assert.deepStrictEqual(running.groundingScope?.unreachableRepositories, [
        "web",
        "project-memory",
      ]);
      yield* harness.emit(
        runtimeEvent(ThreadId.make("thread-root"), {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames);
      const groundingScope = harness.state.appended[0]?.groundingScope;
      assert.ok(groundingScope !== undefined);
      assert.deepStrictEqual(
        (groundingScope as { unreachableRepositories: ReadonlyArray<string> })
          .unreachableRepositories,
        ["web", "project-memory"],
      );
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("measures reconstruction from the same material as a rebuilt turn", () => {
    const ancestors = [
      commit("message", "message", { text: "Earlier request" }, 1),
      commit("revision", "plan-revision", { text: "# Plan" }, 2),
      commit(
        "spec",
        "spec-revision",
        { document: { goal: "Goal", acceptanceCriteria: "Done" } },
        3,
      ),
    ];
    const harness = makeHarness({ repositoryNames: ["server", "web"], ancestors: () => ancestors });
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const measured = yield* assistant.measureReconstruction({
        planId,
        parentCommitId: CommitId.make("tip"),
      });
      const entries: ReadonlyArray<TranscriptEntry> = [
        { kind: "message", author: "human", text: "Earlier request" },
        { kind: "plan-revision", author: "human" },
        { kind: "spec-revision", author: "human" },
      ];
      const transcript = measureTranscript({
        entries,
        planText: "# Plan",
        spec: { goal: "Goal", acceptanceCriteria: "Done" },
      });
      const appendix = planningSystemAppendix({
        planTitle: "Plan",
        repositories: [
          { name: "server", path: "/repo/server" },
          { name: "web", path: "/repo/web" },
        ],
        unreachableRepositories: [],
      });
      assert.deepStrictEqual(measured, {
        transcriptChars: transcript.renderedEntryLengths.reduce((sum, length) => sum + length, 0),
        entryCount: 3,
        fixedReservedChars:
          appendix.length +
          transcript.planSectionChars +
          transcript.specSectionChars +
          TRANSCRIPT_FRAMING_MARGIN,
      });
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("measures only the selected fork's ancestor path", () => {
    const harness = makeHarness({
      ancestors: (tip) =>
        tip === CommitId.make("left-tip")
          ? [
              commit("root", "message", { text: "Shared root" }, 1),
              commit("left", "message", { text: "Left only" }, 2),
            ]
          : [commit("root", "message", { text: "Shared root" }, 1)],
    });
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const left = yield* assistant.measureReconstruction({
        planId,
        parentCommitId: CommitId.make("left-tip"),
      });
      const right = yield* assistant.measureReconstruction({
        planId,
        parentCommitId: CommitId.make("right-tip"),
      });
      assert.strictEqual(left.entryCount, 2);
      assert.strictEqual(right.entryCount, 1);
      assert.ok(left.transcriptChars > right.transcriptChars);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("measures an empty ancestor history as zero transcript entries", () => {
    const harness = makeHarness({ ancestors: () => [] });
    return Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const measured = yield* assistant.measureReconstruction({
        planId,
        parentCommitId: CommitId.make("root"),
      });
      assert.strictEqual(measured.entryCount, 0);
      assert.strictEqual(measured.transcriptChars, 0);
      assert.ok(measured.fixedReservedChars > TRANSCRIPT_FRAMING_MARGIN);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("folds command and edit activity into the settled reply", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const frames = yield* subscribeFrames(planId);
      yield* start(frames, { planId, parentCommitId: CommitId.make("root"), text: "First" });
      const threadId = ThreadId.make("thread-root");
      yield* harness.emit(
        runtimeEvent(threadId, {
          type: "item.started",
          itemId: RuntimeItemId.make("command"),
          payload: { itemType: "command_execution", title: "vp test run" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(threadId, {
          type: "item.started",
          itemId: RuntimeItemId.make("edit"),
          payload: { itemType: "file_change", title: "src/ws.ts" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(threadId, { type: "turn.completed", payload: { state: "completed" } }),
      );
      yield* Queue.take(frames);
      assert.deepStrictEqual(harness.state.appended[0]?.grounding, [
        { kind: "command", label: "vp test run" },
        { kind: "edit", label: "src/ws.ts" },
      ]);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });
});
