import { assert, describe, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  EventId,
  PlanId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type PlanStreamItem,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderSendTurnInput,
  type ServerProvider,
} from "@t3tools/contracts";

import * as Config from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as ProviderRegistry from "../../provider/Services/ProviderRegistry.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as CodingSessionStore from "../codingSessions/CodingSessionStore.ts";
import * as PlanTurnRegistry from "../planning/PlanTurnRegistry.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as MemorySourceStore from "../memory/MemorySourceStore.ts";
import * as MemoryIndex from "../memory/MemoryIndex.ts";
import * as WorkspaceSettingsStore from "../workspace/WorkspaceSettingsStore.ts";
import * as PlanningAssistant from "./PlanningAssistant.ts";
import {
  composeFirstTurnInput,
  measureTranscript,
  planningSystemAppendix,
  TRANSCRIPT_FRAMING_MARGIN,
  transcriptPreamble,
  type TranscriptEntry,
} from "./PlanningPrompt.ts";

const claude = ProviderDriverKind.make("claudeAgent");
const claudeInstance = ProviderInstanceId.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");
const codexInstance = ProviderInstanceId.make("codex");

const reasoningCapabilities = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning effort",
      type: "select" as const,
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    },
  ],
};

const providerSnapshot: ServerProvider = {
  instanceId: claudeInstance,
  driver: claude,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-08T00:00:00.000Z",
  models: [{ slug: "opus", name: "Opus", isCustom: false, capabilities: reasoningCapabilities }],
  slashCommands: [],
  skills: [],
};

const codexSnapshot: ServerProvider = {
  ...providerSnapshot,
  instanceId: codexInstance,
  driver: codex,
  models: [{ slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null }],
};

/**
 * A scripted stand-in for the provider runtime: every call lands in a queue
 * the test can await (receipts, never sleeps), and the test drives the
 * session by publishing canonical events into the same stream the real
 * `ProviderService` would.
 */
interface ProviderHarnessShape {
  readonly startSessions: Queue.Queue<ProviderSessionStartInput>;
  readonly sendTurns: Queue.Queue<ProviderSendTurnInput>;
  readonly interrupts: Queue.Queue<ThreadId>;
  readonly approvals: Queue.Queue<{ readonly requestId: string; readonly decision: string }>;
  readonly userInputs: Queue.Queue<{
    readonly requestId: string;
    readonly answers: Record<string, unknown>;
  }>;
  readonly stops: Queue.Queue<ThreadId>;
  readonly emit: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  /** Grounding capability the fake adapter declares; mutable per test. */
  readonly setGroundingRoots: (roots: "multi" | "cwd-only") => Effect.Effect<void>;
}

class ProviderHarness extends Context.Service<ProviderHarness, ProviderHarnessShape>()(
  "t3/mercurian/assistant/PlanningAssistant.test/ProviderHarness",
) {}

const makeHarness = Effect.gen(function* () {
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const startSessions = yield* Queue.unbounded<ProviderSessionStartInput>();
  const sendTurns = yield* Queue.unbounded<ProviderSendTurnInput>();
  const interrupts = yield* Queue.unbounded<ThreadId>();
  const approvals = yield* Queue.unbounded<{ requestId: string; decision: string }>();
  const userInputs = yield* Queue.unbounded<{
    requestId: string;
    answers: Record<string, unknown>;
  }>();
  const stops = yield* Queue.unbounded<ThreadId>();
  let groundingRoots: "multi" | "cwd-only" = "multi";

  const toSession = (input: ProviderSessionStartInput): ProviderSession => ({
    provider: claude,
    providerInstanceId: claudeInstance,
    status: "running",
    runtimeMode: input.runtimeMode,
    threadId: input.threadId,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });

  const service: ProviderService.ProviderService["Service"] = {
    startSession: (threadId, input) =>
      Queue.offer(startSessions, { ...input, threadId }).pipe(
        Effect.as(toSession({ ...input, threadId })),
      ),
    sendTurn: (input) =>
      Queue.offer(sendTurns, input).pipe(
        Effect.as({ threadId: input.threadId, turnId: TurnId.make("provider-turn") }),
      ),
    interruptTurn: (input) => Queue.offer(interrupts, input.threadId).pipe(Effect.asVoid),
    respondToRequest: (input) =>
      Queue.offer(approvals, {
        requestId: String(input.requestId),
        decision: input.decision,
      }).pipe(Effect.asVoid),
    respondToUserInput: (input) =>
      Queue.offer(userInputs, {
        requestId: String(input.requestId),
        answers: { ...input.answers },
      }).pipe(Effect.asVoid),
    stopSession: (input) => Queue.offer(stops, input.threadId).pipe(Effect.asVoid),
    listSessions: () => Effect.succeed([]),
    getCapabilities: () =>
      Effect.sync(() => ({ sessionModelSwitch: "in-session" as const, groundingRoots })),
    assertConversationRollbackSupported: () => Effect.die("unused in planning tests"),
    getInstanceInfo: () => Effect.die("unused in planning tests"),
    rollbackConversation: () => Effect.die("unused in planning tests"),
    uploadFeedback: () => Effect.die("unused in planning tests"),
    get streamEvents() {
      return Stream.fromPubSub(events);
    },
  };

  const harness: ProviderHarnessShape = {
    startSessions,
    sendTurns,
    interrupts,
    approvals,
    userInputs,
    stops,
    emit: (event) => PubSub.publish(events, event).pipe(Effect.asVoid),
    setGroundingRoots: (roots) =>
      Effect.sync(() => {
        groundingRoots = roots;
      }),
  };

  return { harness, service };
});

// Grounding needs no live git here: every path is "not a repository", which
// is a legal grounding root by design.
const stubProcessRunner = Layer.succeed(
  ProcessRunner.ProcessRunner,
  ProcessRunner.ProcessRunner.of({
    run: () =>
      Effect.succeed({
        stdout: "",
        stderr: "fatal: not a git repository",
        code: 128 as never,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      }),
  }),
);

/**
 * One whole world per test — assistant, stores, harness, in-memory database —
 * because the harness's call queues are receipts, and receipts shared between
 * concurrently running tests would answer the wrong caller.
 */
const testLayer = (providers: ReadonlyArray<ServerProvider> = [providerSnapshot]) => {
  const harnessContext = Layer.unwrap(
    Effect.map(makeHarness, ({ harness, service }) =>
      Layer.mergeAll(
        Layer.succeed(ProviderHarness)(harness),
        Layer.succeed(ProviderService.ProviderService)(service),
      ),
    ),
  );
  return PlanningAssistant.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        PlanningStore.layer.pipe(
          Layer.provideMerge(CodingSessionStore.layer),
          Layer.provideMerge(RepositoryStore.layer.pipe(Layer.provide(stubProcessRunner))),
        ),
        WorkspaceSettingsStore.layer,
        MemoryIndex.layer.pipe(
          Layer.provideMerge(MemorySourceStore.layer),
          Layer.provide(stubProcessRunner),
        ),
      ),
    ),
    Layer.provideMerge(PlanTurnRegistry.layer),
    Layer.provideMerge(CommitStore.layer),
    Layer.provideMerge(harnessContext),
    Layer.provideMerge(
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed(providers),
      }),
    ),
    Layer.provideMerge(MercurianSqlite.layerMemory),
    Layer.provideMerge(Config.layerTest(process.cwd(), { prefix: "mercurian-assistant-" })),
    Layer.provideMerge(NodeServicesLayer),
  );
};

const at = (iso: string) => DateTime.makeUnsafe(iso);

let nextEventNumber = 0;

const runtimeEvent = (
  threadId: ThreadId,
  event: Omit<ProviderRuntimeEvent, "eventId" | "provider" | "threadId" | "createdAt">,
): ProviderRuntimeEvent =>
  ({
    eventId: EventId.make(`event-${(nextEventNumber += 1)}`),
    provider: claude,
    threadId,
    createdAt: "2026-08-08T00:00:00.000Z",
    ...event,
  }) as ProviderRuntimeEvent;

const seedPlan = Effect.fn("seedPlan")(function* (message = "Reshape the sidebar") {
  const store = yield* PlanningStore.PlanningStore;
  const settings = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
  yield* settings.recordLastUsedPlanningModel({ provider: claude, model: "opus" });
  const project = yield* store.createProject({
    name: "Astrolabe",
    createdAt: at("2026-08-08T00:00:00.000Z"),
  });
  const created = yield* store.createPlan({
    lastUsed: null,
    projectId: project.projectId,
    message,
    createdAt: at("2026-08-08T00:00:00.000Z"),
  });
  return { created, root: created.timeline[0]! };
});

const subscribeFrames = Effect.fn("subscribeFrames")(function* (planId: PlanId) {
  const assistant = yield* PlanningAssistant.PlanningAssistant;
  const frames = yield* Queue.unbounded<PlanStreamItem>();
  yield* Effect.forkScoped(
    assistant.frames(planId).pipe(Stream.runForEach((frame) => Queue.offer(frames, frame))),
    { startImmediately: true },
  );
  return frames;
});

/**
 * Two repositories in the project's set, returned in the set's own order —
 * which is the store's to decide (links added in one batch tie on
 * `added_at`), so the test reads it back rather than assuming insertion
 * order.
 */
const seedTwoRepositories = Effect.fn("seedTwoRepositories")(function* (created: {
  readonly plan: { readonly projectId: import("@t3tools/contracts").MercurianProjectId };
}) {
  const repositories = yield* RepositoryStore.RepositoryStore;
  const alpha = yield* repositories.addRepository({
    path: "/tmp",
    name: "alpha",
    createdAt: at("2026-08-08T00:00:00.000Z"),
  });
  const beta = yield* repositories.addRepository({
    path: "/usr",
    name: "beta",
    createdAt: at("2026-08-08T00:00:00.000Z"),
  });
  yield* repositories.setProjectRepositories({
    projectId: created.plan.projectId,
    repositoryIds: [alpha.repositoryId, beta.repositoryId],
    addedAt: at("2026-08-08T00:00:00.000Z"),
  });
  const snapshot = yield* repositories.getSnapshot;
  const ordered = snapshot.projectRepositories
    .filter((link) => link.projectId === created.plan.projectId)
    .map((link) =>
      snapshot.repositories.find((repository) => repository.repositoryId === link.repositoryId)!,
    );
  return { first: ordered[0]!, second: ordered[1]! };
});

const seedMemory = Effect.fn("seedMemory")(function* (
  projectId: import("@t3tools/contracts").MercurianProjectId,
  notes: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "planning-memory-" });
  for (const [name, markdown] of Object.entries(notes)) {
    yield* fs.writeFileString(path.join(root, `${name}.md`), markdown);
  }
  const repositories = yield* RepositoryStore.RepositoryStore;
  const source = yield* repositories.addRepository({
    path: root,
    name: "project-memory",
    createdAt: at("2026-08-08T00:00:00.000Z"),
  });
  const memorySources = yield* MemorySourceStore.MemorySourceStore;
  yield* memorySources.designate({
    projectId,
    repositoryId: source.repositoryId,
    now: at("2026-08-08T00:00:00.000Z"),
  });
  return yield* fs.realPath(root);
});

describe("PlanningAssistant", () => {
  it.effect("streams a reply and settles it as the assistant's commit", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const settings = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const frames = yield* subscribeFrames(created.plan.planId);
      yield* settings.recordLastUsedPlanningModel({
        provider: claude,
        model: "opus",
        options: [{ id: "effort", value: "high" }],
      });

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reshape the sidebar",
      });

      // The session opened read-only under the resolved planning model, and
      // the first turn carried the appendix.
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.runtimeMode, "approval-required");
      assert.strictEqual(session.approvalPolicy, "never");
      assert.deepStrictEqual(session.modelSelection, {
        instanceId: claudeInstance,
        model: "opus",
        options: [{ id: "effort", value: "high" }],
      });
      assert.strictEqual(session.isolateProviderSettings, true);
      const firstTurn = yield* Queue.take(harness.sendTurns);
      assert.ok(firstTurn.input?.includes("planning assistant"));
      assert.ok(firstTurn.input?.includes("Reply to this message:\nReshape the sidebar"));

      const startedFrame = yield* Queue.take(frames);
      assert.strictEqual(startedFrame.kind, "turn-started");

      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Here is " },
        }),
      );
      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "the shape." },
        }),
      );
      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "tool.progress",
          payload: { toolName: "Read", summary: "Read apps/web/src/sidebar.tsx", toolUseId: "t1" },
        }),
      );

      const delta1 = yield* Queue.take(frames);
      assert.ok(delta1.kind === "turn-delta" && delta1.textDelta === "Here is ");
      assert.strictEqual(delta1.kind === "turn-delta" ? delta1.offset : -1, 0);
      const delta2 = yield* Queue.take(frames);
      assert.ok(delta2.kind === "turn-delta" && delta2.offset === 8);
      const grounding = yield* Queue.take(frames);
      assert.ok(
        grounding.kind === "turn-grounding" && grounding.item.label === "apps/web/src/sidebar.tsx",
      );

      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      const settled = yield* Queue.take(frames);
      assert.strictEqual(settled.kind, "turn-settled");

      const snapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const reply = snapshot.timeline.at(-1);
      assert.ok(reply !== undefined && reply._tag === "message");
      assert.strictEqual(reply.authorKind, "assistant");
      assert.strictEqual(reply.text, "Here is the shape.");
      assert.strictEqual(reply.interrupted, undefined);
      assert.strictEqual(reply.grounding?.length, 1);
      assert.deepStrictEqual(reply.generatedBy, {
        provider: claude,
        model: "opus",
        options: [{ id: "effort", value: "high" }],
      });
      assert.deepStrictEqual([...reply.parents], [root.commitId]);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("stopping lands the partial as a commit marked interrupted", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reshape the sidebar",
      });
      const session = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      const startedForStop = yield* Queue.take(frames);
      assert.ok(startedForStop.kind === "turn-started");

      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Partial" },
        }),
      );
      yield* Queue.take(frames);

      yield* assistant.stopTurn({ planId: created.plan.planId, turnId: startedForStop.turnId });
      const interrupted = yield* Queue.take(harness.interrupts);
      assert.strictEqual(interrupted, session.threadId);

      // The adapter answers the interrupt with an aborted turn.
      yield* harness.emit(
        runtimeEvent(session.threadId, { type: "turn.aborted", payload: { reason: "interrupt" } }),
      );
      const settled = yield* Queue.take(frames);
      assert.strictEqual(settled.kind, "turn-settled");

      const snapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const reply = snapshot.timeline.at(-1);
      assert.ok(reply !== undefined && reply._tag === "message");
      assert.strictEqual(reply.text, "Partial");
      assert.strictEqual(reply.interrupted, true);

      // Stopping again is a no-op, not an error.
      yield* assistant.stopTurn({ planId: created.plan.planId, turnId: startedForStop.turnId });
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("a stop the adapter never answers settles after the grace window", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reshape the sidebar",
      });
      const session = yield* Queue.take(harness.startSessions);
      const startedStuck = yield* Queue.take(frames);
      assert.ok(startedStuck.kind === "turn-started");
      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Stuck" },
        }),
      );
      yield* Queue.take(frames);

      // The interrupt is delivered — and the wedged provider never answers.
      yield* assistant.stopTurn({ planId: created.plan.planId, turnId: startedStuck.turnId });
      yield* Queue.take(harness.interrupts);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.seconds(6));

      const settled = yield* Queue.take(frames);
      assert.strictEqual(settled.kind, "turn-settled");
      const snapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const reply = snapshot.timeline.at(-1);
      assert.ok(reply !== undefined && reply._tag === "message");
      assert.strictEqual(reply.text, "Stuck");
      assert.strictEqual(reply.interrupted, true);
    }).pipe(
      Effect.scoped,
      // provideMerge, not a sibling merge: the harness layer must be BUILT
      // under the test clock so the grace sleep it schedules is virtual.
      Effect.provide(testLayer().pipe(Layer.provideMerge(TestClock.layer()))),
    ),
  );

  it.effect("a question pauses the turn on the person, and the answer resumes it", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reshape the sidebar",
      });
      const session = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      const startedQuestionTurn = yield* Queue.take(frames);
      assert.ok(startedQuestionTurn.kind === "turn-started");

      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "user-input.requested",
          payload: {
            questions: [
              {
                id: "q1",
                header: "Scope",
                question: "Web first?",
                options: [{ label: "Yes", description: "Start narrow" }],
                multiSelect: false,
              },
            ],
          },
        }),
        requestId: "input-1" as never,
      });

      const questionFrame = yield* Queue.take(frames);
      assert.ok(questionFrame.kind === "turn-question");
      const status = yield* assistant.status;
      assert.deepStrictEqual(status.get(created.plan.planId), {
        isWorking: false,
        hasPendingInput: true,
      });
      const inFlight = yield* assistant.inFlightTurns(created.plan.planId);
      assert.strictEqual(inFlight[0]?.questions?.[0]?.question, "Web first?");

      yield* assistant.answerQuestion({
        planId: created.plan.planId,
        turnId: startedQuestionTurn.turnId,
        answers: { q1: "Yes" },
      });
      const delivered = yield* Queue.take(harness.userInputs);
      assert.strictEqual(delivered.requestId, "input-1");
      const answeredFrame = yield* Queue.take(frames);
      assert.strictEqual(answeredFrame.kind, "turn-question-answered");

      // A second answer has nothing to answer.
      const refused = yield* Effect.flip(
        assistant.answerQuestion({
          planId: created.plan.planId,
          turnId: startedQuestionTurn.turnId,
          answers: {},
        }),
      );
      assert.strictEqual(refused._tag, "NoPendingQuestionError");

      yield* harness.emit(
        runtimeEvent(session.threadId, { type: "turn.completed", payload: { state: "completed" } }),
      );
      yield* Queue.take(frames); // turn-settled

      const snapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const reply = snapshot.timeline.at(-1);
      assert.ok(reply !== undefined && reply._tag === "message");
      assert.deepStrictEqual(reply.question?.answers, { q1: "Yes" });
      assert.strictEqual(reply.question?.questions[0]?.id, "q1");
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("auto-answers approvals for reads and the planning MCP door", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reshape the sidebar",
      });
      const session = yield* Queue.take(harness.startSessions);
      yield* Queue.take(frames); // turn-started

      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "request.opened",
          payload: { requestType: "file_read_approval", detail: "docs/plan.md" },
        }),
        requestId: "req-read" as never,
      });
      const approved = yield* Queue.take(harness.approvals);
      assert.deepStrictEqual(approved, { requestId: "req-read", decision: "acceptForSession" });
      // The approved read is grounding, and no approval frame ever exists.
      const groundingFrame = yield* Queue.take(frames);
      assert.ok(groundingFrame.kind === "turn-grounding");

      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "request.opened",
          payload: {
            requestType: "dynamic_tool_call",
            detail: "mcp__t3-code__save_plan_revision: {}",
            args: {
              toolName: "mcp__t3-code__save_plan_revision",
              input: {},
              toolUseId: "tool-save-plan",
            },
          },
        }),
        requestId: "req-save-plan" as never,
      });
      const approvedPlanningTool = yield* Queue.take(harness.approvals);
      assert.deepStrictEqual(approvedPlanningTool, {
        requestId: "req-save-plan",
        decision: "acceptForSession",
      });

      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "request.opened",
          payload: {
            requestType: "dynamic_tool_call",
            detail: "mcp__t3-code__preview_click: {}",
            args: {
              toolName: "mcp__t3-code__preview_click",
              input: {},
              toolUseId: "tool-preview-click",
            },
          },
        }),
        requestId: "req-preview" as never,
      });
      const declinedDynamicTool = yield* Queue.take(harness.approvals);
      assert.deepStrictEqual(declinedDynamicTool, {
        requestId: "req-preview",
        decision: "decline",
      });

      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "request.opened",
          payload: { requestType: "command_execution_approval", detail: "npm test" },
        }),
        requestId: "req-cmd" as never,
      });
      const declined = yield* Queue.take(harness.approvals);
      assert.deepStrictEqual(declined, { requestId: "req-cmd", decision: "decline" });
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("refuses honestly when no planning model is set", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;

      // No planning model chosen: the message stands, the stream says why
      // nothing follows, and no session ever starts.
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-08T00:00:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "First",
        createdAt: at("2026-08-08T00:00:00.000Z"),
      });
      const root = created.timeline[0]!;
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "First",
      });
      const refusedUnset = yield* Queue.take(frames);
      assert.ok(refusedUnset.kind === "turn-refused" && refusedUnset.reason === "unset");
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("forwards not-signed-in when the planning model's offerer is signed out", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan("First");
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "First",
      });
      const refused = yield* Queue.take(frames);
      assert.ok(refused.kind === "turn-refused" && refused.reason === "not-signed-in");
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(testLayer([{ ...providerSnapshot, auth: { status: "unauthenticated" } }])),
    ),
  );

  it.effect("one turn at a time: a second start refuses as turn-active", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const { created, root } = yield* seedPlan();
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "First",
      });
      const started = yield* Queue.take(frames);
      assert.strictEqual(started.kind, "turn-started");

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Again",
      });
      const refused = yield* Queue.take(frames);
      assert.ok(refused.kind === "turn-refused" && refused.reason === "turn-active");
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("grounds every repository of the project for a multi-root provider", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const { first, second } = yield* seedTwoRepositories(created);

      const frames = yield* subscribeFrames(created.plan.planId);
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reshape the sidebar",
      });
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.cwd, first.path);
      assert.deepStrictEqual([...(session.additionalDirectories ?? [])], [second.path]);
      const startedFrame = yield* Queue.take(frames);
      assert.ok(startedFrame.kind === "turn-started" && startedFrame.groundingScope === undefined);
      const firstTurn = yield* Queue.take(harness.sendTurns);
      assert.ok(firstTurn.input?.includes("alpha"));
      assert.ok(firstTurn.input?.includes("beta"));
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("grounds reachable memory and resolves note mentions on the first turn", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const { first, second } = yield* seedTwoRepositories(created);
      const memoryRoot = yield* seedMemory(created.plan.projectId, {
        Composer: "The composer design.",
        Plans: "The frontier includes [[Future]].",
      });

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Use [[Composer]] and [[Future]].",
      });
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.cwd, first.path);
      assert.deepStrictEqual(session.additionalDirectories, [second.path, memoryRoot]);
      const sent = yield* Queue.take(harness.sendTurns);
      const sentInput = sent.input ?? "";
      assert.ok(sentInput.includes(`Project memory (durable design truth`));
      assert.ok(sentInput.includes(`- ${memoryRoot}`));
      assert.ok(sentInput.includes(`- Composer: ${memoryRoot}/Composer.md`));
      assert.ok(sentInput.includes("- Future: not yet written — linked from Plans"));
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("resolves note mentions when continuing a live session", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan("First");
      const memoryRoot = yield* seedMemory(created.plan.projectId, {
        Composer: "The composer design.",
      });
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "First",
      });
      const session = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames); // turn-started
      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "First reply" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames); // turn-settled
      const reply = (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.at(
        -1,
      )!;
      const message = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: reply.commitId,
        text: "Consult [[Composer]].",
        modelChoice: { provider: claude, model: "opus" },
        lastUsed: null,
        createdAt: at("2026-08-08T00:30:00.000Z"),
      });
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: message.commitId,
        text: message.text,
        ...(message.ranUnder === undefined ? {} : { ranUnder: message.ranUnder }),
      });
      const continued = yield* Queue.take(harness.sendTurns);
      assert.strictEqual(continued.threadId, session.threadId);
      assert.strictEqual(
        continued.input,
        `Consult [[Composer]].\n\n---\n\nMemory notes mentioned in this message:\n- Composer: ${memoryRoot}/Composer.md`,
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("narrows visibly for a cwd-only provider", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      yield* harness.setGroundingRoots("cwd-only");
      const { first, second } = yield* seedTwoRepositories(created);
      yield* seedMemory(created.plan.projectId, {});

      const frames = yield* subscribeFrames(created.plan.planId);
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reshape the sidebar",
      });

      // The turn opens on the first repository alone — and says out loud
      // which ones were out of reach, on the frame and in the prompt.
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.cwd, first.path);
      assert.strictEqual(session.additionalDirectories, undefined);
      const startedFrame = yield* Queue.take(frames);
      assert.ok(startedFrame.kind === "turn-started");
      assert.deepStrictEqual(startedFrame.groundingScope?.unreachableRepositories, [
        second.name,
        "project-memory",
      ]);
      const firstTurn = yield* Queue.take(harness.sendTurns);
      assert.ok(firstTurn.input?.includes("Out of reach in this session"));

      // The narrowing lands in the settled record too.
      yield* harness.emit(
        runtimeEvent(session.threadId, { type: "turn.completed", payload: { state: "completed" } }),
      );
      yield* Queue.take(frames); // turn-settled
      const store = yield* PlanningStore.PlanningStore;
      const snapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const reply = snapshot.timeline.at(-1);
      assert.ok(reply !== undefined && reply._tag === "message");
      assert.deepStrictEqual(reply.groundingScope?.unreachableRepositories, [
        second.name,
        "project-memory",
      ]);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("the MCP artifact doors write at the turn's tip and keep the chain linear", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reshape the sidebar",
      });
      const session = yield* Queue.take(harness.startSessions);
      yield* Queue.take(frames); // turn-started

      // A thread that is not an active planning turn is refused.
      const refused = yield* Effect.flip(
        assistant.saveRevisionFromThread({ threadId: ThreadId.make("coding-thread"), text: "x" }),
      );
      assert.strictEqual(refused._tag, "PlanningTurnNotFoundError");
      const refusedSpec = yield* Effect.flip(
        assistant.saveSpecRevisionFromThread({
          threadId: ThreadId.make("coding-thread"),
          document: { goal: "No", acceptanceCriteria: "Must not land" },
        }),
      );
      assert.strictEqual(refusedSpec._tag, "PlanningTurnNotFoundError");

      // The turn's own thread revises both artifacts mid-turn, then reads back
      // what it wrote from the newly advanced tip.
      assert.strictEqual(yield* assistant.readSpecFromThread({ threadId: session.threadId }), null);
      yield* assistant.saveSpecRevisionFromThread({
        threadId: session.threadId,
        document: { goal: "Behavior", acceptanceCriteria: "The sidebar is resizable." },
      });
      yield* assistant.saveRevisionFromThread({
        threadId: session.threadId,
        text: "# Revised by the assistant",
      });
      const readBack = yield* assistant.readPlanFromThread({ threadId: session.threadId });
      assert.strictEqual(readBack, "# Revised by the assistant");
      assert.deepStrictEqual(yield* assistant.readSpecFromThread({ threadId: session.threadId }), {
        goal: "Behavior",
        acceptanceCriteria: "The sidebar is resizable.",
      });

      yield* harness.emit(
        runtimeEvent(session.threadId, { type: "turn.completed", payload: { state: "completed" } }),
      );
      yield* Queue.take(frames); // turn-settled

      // Spec, plan, then response are ordered in one ancestry chain.
      const snapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const [message, specRevision, revision, reply] = snapshot.timeline;
      assert.ok(specRevision !== undefined && specRevision._tag === "spec-revision");
      assert.strictEqual(specRevision.authorKind, "assistant");
      assert.deepStrictEqual([...specRevision.parents], [message!.commitId]);
      assert.ok(revision !== undefined && revision._tag === "plan-revision");
      assert.strictEqual(revision.authorKind, "assistant");
      assert.deepStrictEqual([...revision.parents], [specRevision.commitId]);
      assert.ok(reply !== undefined && reply._tag === "message");
      assert.deepStrictEqual([...reply.parents], [revision.commitId]);
      assert.strictEqual(snapshot.planText, "# Revised by the assistant");
      assert.deepStrictEqual(snapshot.spec?.document, {
        goal: "Behavior",
        acceptanceCriteria: "The sidebar is resizable.",
      });
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("a fork rebuilds the session with the ancestor transcript", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reshape the sidebar",
      });
      const firstSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames); // turn-started
      yield* harness.emit(
        runtimeEvent(firstSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Answer one" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(firstSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames); // turn-settled

      // A fork: a second human message from the root, which already led on.
      const fork = yield* store.appendMessage({
        lastUsed: null,
        planId: created.plan.planId,
        text: "Try another direction",
        parentCommitId: root.commitId,
        createdAt: at("2026-08-08T00:10:00.000Z"),
      });
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: fork.commitId,
        text: "Try another direction",
      });

      // A fresh session opens whose first turn resumes the conversation this
      // branch actually has — and the first branch's session survives the
      // fork: its branch may keep planning concurrently.
      const rebuilt = yield* Queue.take(harness.startSessions);
      assert.ok(Option.isNone(yield* Queue.poll(harness.stops)));
      assert.notStrictEqual(rebuilt.threadId, firstSession.threadId);
      const resumeTurn = yield* Queue.take(harness.sendTurns);
      const resumeInput = resumeTurn.input ?? "";
      assert.ok(resumeInput.includes("resuming a planning conversation"));
      assert.ok(resumeInput.includes("Reshape the sidebar"));
      assert.ok(resumeInput.includes("Reply to this message:\nTry another direction"));
      // The other branch's reply is not on this path.
      assert.ok(!resumeInput.includes("Answer one"));
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("measures reconstruction from the same material as a rebuilt turn", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan("Reconstruct this plan");
      const repositories = yield* seedTwoRepositories(created);
      const planRevision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "# Approach\n\nKeep the renderer shared.",
        createdAt: at("2026-08-08T00:20:00.000Z"),
      });
      const specDocument = {
        goal: "Expose the real reconstruction budget.",
        acceptanceCriteria: "The measurement matches the rebuilt prompt.",
      };
      const specRevision = yield* store.saveSpecRevision({
        planId: created.plan.planId,
        parentCommitId: planRevision.commitId,
        expectedSpecRevisionCommitId: null,
        document: specDocument,
        createdAt: at("2026-08-08T00:21:00.000Z"),
      });
      const message = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: specRevision.commitId,
        text: "How full is the next reply?",
        lastUsed: null,
        createdAt: at("2026-08-08T00:22:00.000Z"),
      });

      const measured = yield* assistant.measureReconstruction({
        planId: created.plan.planId,
        parentCommitId: message.commitId,
      });
      const entries: ReadonlyArray<TranscriptEntry> = [
        { kind: "message", author: "human", text: "Reconstruct this plan" },
        { kind: "plan-revision", author: "human" },
        { kind: "spec-revision", author: "human" },
      ];
      const transcript = measureTranscript({
        entries,
        planText: "# Approach\n\nKeep the renderer shared.",
        spec: specDocument,
      });
      const appendix = planningSystemAppendix({
        planTitle: "Reconstruct this plan",
        repositories: [repositories.first, repositories.second].map(({ name, path }) => ({
          name,
          path,
        })),
        unreachableRepositories: [],
      });
      assert.deepStrictEqual(measured, {
        transcriptChars: transcript.renderedEntryLengths.reduce((sum, length) => sum + length, 0),
        entryCount: entries.length,
        fixedReservedChars:
          appendix.length +
          transcript.planSectionChars +
          transcript.specSectionChars +
          TRANSCRIPT_FRAMING_MARGIN,
      });

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: message.commitId,
        text: message.text,
      });
      yield* Queue.take(harness.startSessions);
      const sent = yield* Queue.take(harness.sendTurns);
      const preamble = transcriptPreamble({
        entries,
        planText: "# Approach\n\nKeep the renderer shared.",
        spec: specDocument,
        reservedChars: appendix.length + message.text.length,
      });
      assert.strictEqual(
        sent.input,
        composeFirstTurnInput({ appendix, preamble, message: message.text }),
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("measures an empty ancestor history as zero transcript entries", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const { created, root } = yield* seedPlan("First message");
      const measured = yield* assistant.measureReconstruction({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
      });

      assert.strictEqual(measured.entryCount, 0);
      assert.strictEqual(measured.transcriptChars, 0);
      assert.ok(measured.fixedReservedChars > TRANSCRIPT_FRAMING_MARGIN);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("measures only the selected fork's ancestor path", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const { created, root } = yield* seedPlan("Shared root");
      const left = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Left branch only",
        lastUsed: null,
        createdAt: at("2026-08-08T00:23:00.000Z"),
      });
      const leftTip = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: left.commitId,
        text: "Continue left",
        lastUsed: null,
        createdAt: at("2026-08-08T00:24:00.000Z"),
      });
      const right = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Right branch only",
        lastUsed: null,
        createdAt: at("2026-08-08T00:25:00.000Z"),
      });

      const leftMeasure = yield* assistant.measureReconstruction({
        planId: created.plan.planId,
        parentCommitId: leftTip.commitId,
      });
      const rightMeasure = yield* assistant.measureReconstruction({
        planId: created.plan.planId,
        parentCommitId: right.commitId,
      });

      assert.strictEqual(leftMeasure.entryCount, 2);
      assert.strictEqual(rightMeasure.entryCount, 1);
      assert.ok(leftMeasure.transcriptChars > rightMeasure.transcriptChars);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("includes a standalone human spec revision in the next turn input", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const revision = yield* store.saveSpecRevision({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        expectedSpecRevisionCommitId: null,
        document: {
          goal: "Keep the revised navigation contract",
          acceptanceCriteria: "The sidebar preserves the active project while it resizes.",
        },
        createdAt: at("2026-08-08T00:01:00.000Z"),
      });
      const message = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
        text: "What should change in the plan?",
        lastUsed: null,
        createdAt: at("2026-08-08T00:02:00.000Z"),
      });

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: message.commitId,
        text: message.text,
      });

      yield* Queue.take(harness.startSessions);
      const turn = yield* Queue.take(harness.sendTurns);
      const input = turn.input ?? "";
      assert.ok(input.includes("[The person revised the spec.]"));
      assert.ok(input.includes("Goal / user story:\nKeep the revised navigation contract"));
      assert.ok(
        input.includes(
          "Acceptance criteria:\n---\nThe sidebar preserves the active project while it resizes.",
        ),
      );
      assert.ok(input.includes("Reply to this message:\nWhat should change in the plan?"));
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("runs a turn under the model recorded on its human commit", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-08T00:20:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Run this with Codex",
        modelChoice: { provider: codex, model: "gpt-5.4" },
        lastUsed: { provider: claude, model: "opus" },
        createdAt: at("2026-08-08T00:21:00.000Z"),
      });
      const root = created.timeline[0]!;
      assert.ok(root._tag === "message" && root.ranUnder !== undefined);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: root.text,
        ranUnder: root.ranUnder!,
      });
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.providerInstanceId, codexInstance);
      assert.deepStrictEqual(session.modelSelection, {
        instanceId: codexInstance,
        model: "gpt-5.4",
      });
    }).pipe(Effect.scoped, Effect.provide(testLayer([providerSnapshot, codexSnapshot]))),
  );

  it.effect("runs a bare-seeded turn under the last-used pair stamped on it", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-08T00:25:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Use what this workspace used last",
        lastUsed: { provider: claude, model: "opus" },
        createdAt: at("2026-08-08T00:26:00.000Z"),
      });
      const root = created.timeline[0]!;
      assert.ok(root._tag === "message");
      assert.deepStrictEqual(root.ranUnder, { provider: claude, model: "opus" });
      assert.ok(root.ranUnder !== undefined);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: root.text,
        ranUnder: root.ranUnder,
      });
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.providerInstanceId, claudeInstance);
      assert.strictEqual(session.modelSelection?.model, "opus");
      assert.strictEqual(session.modelSelection?.options, undefined);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("continues the same option triple and rebuilds when depth alone changes", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-08T00:27:00.000Z"),
      });
      const high = {
        provider: claude,
        model: "opus",
        options: [{ id: "effort", value: "high" }],
      } as const;
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Start deep",
        modelChoice: high,
        lastUsed: null,
        createdAt: at("2026-08-08T00:27:00.000Z"),
      });
      const root = created.timeline[0]!;
      assert.ok(root._tag === "message" && root.ranUnder !== undefined);
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: root.text,
        ranUnder: root.ranUnder,
      });
      const firstSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(firstSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "First" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(firstSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames);
      const firstReply = (yield* store.getPlanSnapshot({
        planId: created.plan.planId,
      })).timeline.at(-1)!;

      const same = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: firstReply.commitId,
        text: "/cmd args",
        modelChoice: { ...high, options: high.options.toReversed() },
        lastUsed: null,
        createdAt: at("2026-08-08T00:28:00.000Z"),
      });
      assert.ok(same.ranUnder !== undefined);
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: same.commitId,
        text: same.text,
        ranUnder: same.ranUnder,
      });
      const continued = yield* Queue.take(harness.sendTurns);
      assert.strictEqual(continued.threadId, firstSession.threadId);
      assert.strictEqual(continued.input, "/cmd args");
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(firstSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Second" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(firstSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames);
      const secondReply = (yield* store.getPlanSnapshot({
        planId: created.plan.planId,
      })).timeline.at(-1)!;

      const shallow = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: secondReply.commitId,
        text: "Use less depth",
        modelChoice: {
          provider: claude,
          model: "opus",
          options: [{ id: "effort", value: "low" }],
        },
        lastUsed: null,
        createdAt: at("2026-08-08T00:29:00.000Z"),
      });
      assert.ok(shallow.ranUnder !== undefined);
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: shallow.commitId,
        text: shallow.text,
        ranUnder: shallow.ranUnder,
      });
      assert.strictEqual(yield* Queue.take(harness.stops), firstSession.threadId);
      const rebuilt = yield* Queue.take(harness.startSessions);
      assert.deepStrictEqual(rebuilt.modelSelection, {
        instanceId: claudeInstance,
        model: "opus",
        options: [{ id: "effort", value: "low" }],
      });
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("a model switch between turns forces a model rebuild", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const settings = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
      const harness = yield* ProviderHarness;
      const frames = yield* Queue.unbounded<PlanStreamItem>();
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-08T00:30:00.000Z"),
      });
      yield* settings.recordLastUsedPlanningModel({ provider: claude, model: "opus" });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Start with Opus",
        lastUsed: { provider: claude, model: "opus" },
        createdAt: at("2026-08-08T00:31:00.000Z"),
      });
      const root = created.timeline[0]!;
      assert.ok(root._tag === "message" && root.ranUnder !== undefined);
      yield* Effect.forkScoped(
        assistant
          .frames(created.plan.planId)
          .pipe(Stream.runForEach((frame) => Queue.offer(frames, frame))),
        { startImmediately: true },
      );

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: root.text,
        ranUnder: root.ranUnder!,
      });
      const firstSession = yield* Queue.take(harness.startSessions);
      assert.strictEqual(firstSession.modelSelection?.model, "opus");
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames); // turn-started
      yield* harness.emit(
        runtimeEvent(firstSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "First reply" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(firstSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames); // turn-settled

      const firstSnapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const firstReply = firstSnapshot.timeline.at(-1)!;
      const next = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: firstReply.commitId,
        text: "Switch to Sonnet",
        modelChoice: { provider: claude, model: "sonnet" },
        lastUsed: { provider: claude, model: "sonnet" },
        createdAt: at("2026-08-08T00:32:00.000Z"),
      });
      assert.deepStrictEqual(next.ranUnder, {
        provider: claude,
        model: "sonnet",
      });
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: next.commitId,
        text: next.text,
        ranUnder: next.ranUnder!,
      });
      assert.strictEqual(yield* Queue.take(harness.stops), firstSession.threadId);
      const secondSession = yield* Queue.take(harness.startSessions);
      assert.strictEqual(secondSession.modelSelection?.model, "sonnet");
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames); // turn-started
      yield* harness.emit(
        runtimeEvent(secondSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Second reply" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(secondSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames); // turn-settled

      const replies = (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline
        .filter((item) => item._tag === "message")
        .filter((item) => item.authorKind === "assistant");
      assert.deepStrictEqual(
        replies.map((reply) => ({ text: reply.text, generatedBy: reply.generatedBy })),
        [
          { text: "First reply", generatedBy: { provider: claude, model: "opus" } },
          { text: "Second reply", generatedBy: { provider: claude, model: "sonnet" } },
        ],
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        testLayer([
          {
            ...providerSnapshot,
            models: [
              ...providerSnapshot.models,
              { slug: "sonnet", name: "Sonnet", isCustom: false, capabilities: null },
            ],
          },
        ]),
      ),
    ),
  );

  it.effect("keeps different providers local to two forked branches", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-08T00:40:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Fork this plan",
        lastUsed: null,
        createdAt: at("2026-08-08T00:41:00.000Z"),
      });
      const root = created.timeline[0]!.commitId;
      const left = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root,
        text: "Claude branch",
        modelChoice: { provider: claude, model: "opus" },
        lastUsed: null,
        createdAt: at("2026-08-08T00:42:00.000Z"),
      });
      const right = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root,
        text: "Codex branch",
        modelChoice: { provider: codex, model: "gpt-5.4" },
        lastUsed: null,
        createdAt: at("2026-08-08T00:43:00.000Z"),
      });
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: left.commitId,
        text: left.text,
        ranUnder: left.ranUnder!,
      });
      const leftSession = yield* Queue.take(harness.startSessions);
      assert.strictEqual(leftSession.providerInstanceId, claudeInstance);
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(leftSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Left answer" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(leftSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: right.commitId,
        text: right.text,
        ranUnder: right.ranUnder!,
      });
      // The Claude branch's session survives: branches plan concurrently now.
      const rightSession = yield* Queue.take(harness.startSessions);
      assert.ok(Option.isNone(yield* Queue.poll(harness.stops)));
      assert.strictEqual(rightSession.providerInstanceId, codexInstance);
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(rightSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Right answer" },
        }),
      );
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(rightSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      yield* Queue.take(frames);

      const replies = (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline
        .filter((item) => item._tag === "message")
        .filter((item) => item.authorKind === "assistant");
      assert.deepStrictEqual(
        replies.map((reply) => ({ parents: [...reply.parents], generatedBy: reply.generatedBy })),
        [
          {
            parents: [left.commitId],
            generatedBy: { provider: claude, model: "opus" },
          },
          {
            parents: [right.commitId],
            generatedBy: { provider: codex, model: "gpt-5.4" },
          },
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer([providerSnapshot, codexSnapshot]))),
  );

  it.effect("streams two branches' replies at once, each settling on its own branch", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const left = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Branch A question",
        lastUsed: null,
        createdAt: at("2026-08-08T05:00:00.000Z"),
      });
      const right = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Branch B question",
        lastUsed: null,
        createdAt: at("2026-08-08T05:01:00.000Z"),
      });
      const frames = yield* subscribeFrames(created.plan.planId);

      // Both turns open before either settles: disjoint chains, both claims stand.
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: left.commitId,
        text: left.text,
      });
      const leftSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      const leftStarted = yield* Queue.take(frames);
      assert.ok(leftStarted.kind === "turn-started");

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: right.commitId,
        text: right.text,
      });
      const rightSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      const rightStarted = yield* Queue.take(frames);
      assert.ok(rightStarted.kind === "turn-started");
      assert.notStrictEqual(rightSession.threadId, leftSession.threadId);

      // A joining window is coherent for both streams at once.
      const partials = yield* assistant.inFlightTurns(created.plan.planId);
      assert.deepStrictEqual(
        partials.map((turn) => String(turn.parentCommitId)).sort(),
        [String(left.commitId), String(right.commitId)].sort(),
      );
      assert.deepStrictEqual((yield* assistant.status).get(created.plan.planId), {
        isWorking: true,
        hasPendingInput: false,
      });

      // Interleaved deltas ride their own turns.
      yield* harness.emit(
        runtimeEvent(leftSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Left answer" },
        }),
      );
      const leftDelta = yield* Queue.take(frames);
      assert.ok(leftDelta.kind === "turn-delta" && leftDelta.turnId === leftStarted.turnId);
      yield* harness.emit(
        runtimeEvent(rightSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Right answer" },
        }),
      );
      const rightDelta = yield* Queue.take(frames);
      assert.ok(rightDelta.kind === "turn-delta" && rightDelta.turnId === rightStarted.turnId);

      // The right turn settles; the left keeps streaming untouched.
      yield* harness.emit(
        runtimeEvent(rightSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      const rightSettled = yield* Queue.take(frames);
      assert.ok(
        rightSettled.kind === "turn-settled" && rightSettled.turnId === rightStarted.turnId,
      );
      const stillStreaming = yield* assistant.inFlightTurns(created.plan.planId);
      assert.deepStrictEqual(
        stillStreaming.map((turn) => String(turn.parentCommitId)),
        [String(left.commitId)],
      );

      yield* harness.emit(
        runtimeEvent(leftSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      const leftSettled = yield* Queue.take(frames);
      assert.ok(leftSettled.kind === "turn-settled" && leftSettled.turnId === leftStarted.turnId);

      // Each reply is a commit on its own branch, and nothing crossed.
      const replies = (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline
        .filter((item) => item._tag === "message")
        .filter((item) => item.authorKind === "assistant");
      assert.deepStrictEqual(
        replies
          .map((reply) => ({ parents: [...reply.parents], text: reply.text }))
          .sort((a, b) => a.text.localeCompare(b.text)),
        [
          { parents: [left.commitId], text: "Left answer" },
          { parents: [right.commitId], text: "Right answer" },
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("a question pauses only its own turn while the other streams on", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const left = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Branch A question",
        lastUsed: null,
        createdAt: at("2026-08-08T05:10:00.000Z"),
      });
      const right = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Branch B question",
        lastUsed: null,
        createdAt: at("2026-08-08T05:11:00.000Z"),
      });
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: left.commitId,
        text: left.text,
      });
      const leftSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      const leftStarted = yield* Queue.take(frames);
      assert.ok(leftStarted.kind === "turn-started");
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: right.commitId,
        text: right.text,
      });
      const rightSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      const rightStarted = yield* Queue.take(frames);
      assert.ok(rightStarted.kind === "turn-started");

      yield* harness.emit({
        ...runtimeEvent(leftSession.threadId, {
          type: "user-input.requested",
          payload: {
            questions: [
              {
                id: "q1",
                header: "Scope",
                question: "Web first?",
                options: [{ label: "Yes", description: "Start narrow" }],
                multiSelect: false,
              },
            ],
          },
        }),
        requestId: "input-left" as never,
      });
      const questionFrame = yield* Queue.take(frames);
      assert.ok(
        questionFrame.kind === "turn-question" && questionFrame.turnId === leftStarted.turnId,
      );

      // The plan both works and waits: the right turn streams while the left
      // waits on the person.
      assert.deepStrictEqual((yield* assistant.status).get(created.plan.planId), {
        isWorking: true,
        hasPendingInput: true,
      });
      yield* harness.emit(
        runtimeEvent(rightSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Still streaming" },
        }),
      );
      const rightDelta = yield* Queue.take(frames);
      assert.ok(rightDelta.kind === "turn-delta" && rightDelta.turnId === rightStarted.turnId);

      // Answering resumes only the asking turn.
      yield* assistant.answerQuestion({
        planId: created.plan.planId,
        turnId: leftStarted.turnId,
        answers: { q1: "Yes" },
      });
      const delivered = yield* Queue.take(harness.userInputs);
      assert.strictEqual(delivered.requestId, "input-left");
      const answeredFrame = yield* Queue.take(frames);
      assert.ok(
        answeredFrame.kind === "turn-question-answered" &&
          answeredFrame.turnId === leftStarted.turnId,
      );

      // Answering the turn that asked nothing has nothing to answer.
      const refused = yield* Effect.flip(
        assistant.answerQuestion({
          planId: created.plan.planId,
          turnId: rightStarted.turnId,
          answers: {},
        }),
      );
      assert.strictEqual(refused._tag, "NoPendingQuestionError");
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("stopping one branch's reply leaves the other streaming", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const left = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Branch A question",
        lastUsed: null,
        createdAt: at("2026-08-08T05:20:00.000Z"),
      });
      const right = yield* store.appendMessage({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Branch B question",
        lastUsed: null,
        createdAt: at("2026-08-08T05:21:00.000Z"),
      });
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: left.commitId,
        text: left.text,
      });
      const leftSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      const leftStarted = yield* Queue.take(frames);
      assert.ok(leftStarted.kind === "turn-started");
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: right.commitId,
        text: right.text,
      });
      const rightSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      const rightStarted = yield* Queue.take(frames);
      assert.ok(rightStarted.kind === "turn-started");

      yield* harness.emit(
        runtimeEvent(leftSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Cut short" },
        }),
      );
      yield* Queue.take(frames);

      yield* assistant.stopTurn({ planId: created.plan.planId, turnId: leftStarted.turnId });
      const interrupted = yield* Queue.take(harness.interrupts);
      assert.strictEqual(interrupted, leftSession.threadId);
      yield* harness.emit(
        runtimeEvent(leftSession.threadId, {
          type: "turn.aborted",
          payload: { reason: "interrupt" },
        }),
      );
      const settled = yield* Queue.take(frames);
      assert.ok(settled.kind === "turn-settled" && settled.turnId === leftStarted.turnId);

      // The right turn never noticed.
      const remaining = yield* assistant.inFlightTurns(created.plan.planId);
      assert.deepStrictEqual(
        remaining.map((turn) => String(turn.parentCommitId)),
        [String(right.commitId)],
      );
      yield* harness.emit(
        runtimeEvent(rightSession.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Unbothered" },
        }),
      );
      const rightDelta = yield* Queue.take(frames);
      assert.ok(rightDelta.kind === "turn-delta" && rightDelta.turnId === rightStarted.turnId);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  for (const [label, ranUnder, providers, expected] of [
    [
      "an override whose provider has no instance",
      { provider: codex, model: "gpt-5.4" },
      [providerSnapshot],
      "no-instance",
    ],
    [
      "an override whose model is absent",
      { provider: claude, model: "sonnet" },
      [providerSnapshot],
      "model-unavailable",
    ],
    [
      "an override whose recorded option is absent",
      { provider: claude, model: "opus", options: [{ id: "effort", value: "max" }] },
      [providerSnapshot],
      "option-unavailable",
    ],
  ] as const) {
    it.effect(`refuses ${label}`, () =>
      Effect.gen(function* () {
        const assistant = yield* PlanningAssistant.PlanningAssistant;
        const harness = yield* ProviderHarness;
        const { created, root } = yield* seedPlan();
        const frames = yield* subscribeFrames(created.plan.planId);
        yield* assistant.startTurn({
          planId: created.plan.planId,
          parentCommitId: root.commitId,
          text: "Reshape the sidebar",
          ranUnder,
        });
        const refused = yield* Queue.take(frames);
        assert.ok(refused.kind === "turn-refused" && refused.reason === expected);
        assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
      }).pipe(Effect.scoped, Effect.provide(testLayer(providers))),
    );
  }
});
