import { assert, describe, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  EventId,
  MercurianCommitId,
  MercurianRepositoryId,
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
import * as WorkspaceSettingsStore from "../workspace/WorkspaceSettingsStore.ts";
import * as PlanningAssistant from "./PlanningAssistant.ts";

const claude = ProviderDriverKind.make("claudeAgent");
const claudeInstance = ProviderInstanceId.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");
const codexInstance = ProviderInstanceId.make("codex");

const providerSnapshot: ServerProvider = {
  instanceId: claudeInstance,
  driver: claude,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-08T00:00:00.000Z",
  models: [{ slug: "opus", name: "Opus", isCustom: false, capabilities: null }],
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
    getInstanceInfo: () => Effect.die("unused in planning tests"),
    rollbackConversation: () => Effect.die("unused in planning tests"),
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
    Layer.provide(NodeServicesLayer),
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
    .map(
      (link) =>
        snapshot.repositories.find((repository) => repository.repositoryId === link.repositoryId)!,
    );
  return { first: ordered[0]!, second: ordered[1]! };
});

describe("PlanningAssistant", () => {
  it.effect("streams a reply and settles it as the assistant's commit", () =>
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

      // The session opened read-only under the resolved planning model, and
      // the first turn carried the appendix.
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.runtimeMode, "approval-required");
      assert.strictEqual(session.modelSelection?.model, "opus");
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
      assert.deepStrictEqual(reply.generatedBy, { provider: claude, model: "opus" });
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
      yield* Queue.take(frames); // turn-started

      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Partial" },
        }),
      );
      yield* Queue.take(frames);

      yield* assistant.stopTurn({ planId: created.plan.planId });
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
      yield* assistant.stopTurn({ planId: created.plan.planId });
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
      yield* Queue.take(frames); // turn-started
      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Stuck" },
        }),
      );
      yield* Queue.take(frames);

      // The interrupt is delivered — and the wedged provider never answers.
      yield* assistant.stopTurn({ planId: created.plan.planId });
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
      yield* Queue.take(frames); // turn-started

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
      const inFlight = yield* assistant.inFlight(created.plan.planId);
      assert.strictEqual(inFlight?.questions?.[0]?.question, "Web first?");

      yield* assistant.answerQuestion({
        planId: created.plan.planId,
        answers: { q1: "Yes" },
      });
      const delivered = yield* Queue.take(harness.userInputs);
      assert.strictEqual(delivered.requestId, "input-1");
      const answeredFrame = yield* Queue.take(frames);
      assert.strictEqual(answeredFrame.kind, "turn-question-answered");

      // A second answer has nothing to answer.
      const refused = yield* Effect.flip(
        assistant.answerQuestion({ planId: created.plan.planId, answers: {} }),
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

  it.effect("narrows visibly for a cwd-only provider", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      yield* harness.setGroundingRoots("cwd-only");
      const { first, second } = yield* seedTwoRepositories(created);

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
      assert.deepStrictEqual(startedFrame.groundingScope?.unreachableRepositories, [second.name]);
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
      assert.deepStrictEqual(reply.groundingScope?.unreachableRepositories, [second.name]);
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

      // The old session stops; a fresh one opens whose first turn resumes
      // the conversation this branch actually has.
      const stopped = yield* Queue.take(harness.stops);
      assert.strictEqual(stopped, firstSession.threadId);
      const rebuilt = yield* Queue.take(harness.startSessions);
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
      assert.strictEqual(yield* Queue.take(harness.stops), leftSession.threadId);
      const rightSession = yield* Queue.take(harness.startSessions);
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

  it.effect("runs implement analysis under the overridden branch choice", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const settings = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
      const harness = yield* ProviderHarness;
      yield* settings.recordLastUsedPlanningModel({ provider: claude, model: "opus" });
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-08T00:50:00.000Z"),
      });
      const created = yield* store.createPlan({
        projectId: project.projectId,
        message: "Plan with Codex",
        modelChoice: { provider: codex, model: "gpt-5.4" },
        lastUsed: { provider: claude, model: "opus" },
        createdAt: at("2026-08-08T00:51:00.000Z"),
      });
      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        parentCommitId: created.timeline[0]!.commitId,
        text: "# Ready to implement",
        createdAt: at("2026-08-08T00:52:00.000Z"),
      });

      yield* assistant.tryImplement({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
      });
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.providerInstanceId, codexInstance);
      assert.deepStrictEqual(session.modelSelection, {
        instanceId: codexInstance,
        model: "gpt-5.4",
      });
    }).pipe(Effect.scoped, Effect.provide(testLayer([providerSnapshot, codexSnapshot]))),
  );

  it.effect("records and publishes an atomic verdict without writing history", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created } = yield* seedPlan();
      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Implement the service boundary",
        createdAt: at("2026-08-08T01:00:00.000Z"),
      });
      const { first, second } = yield* seedTwoRepositories(created);
      const before = (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline
        .length;
      const frames = yield* subscribeFrames(created.plan.planId);

      const unknownThread = yield* Effect.flip(
        assistant.saveImplementProposalFromThread({
          threadId: ThreadId.make("coding-thread"),
          repositories: [first.name],
        }),
      );
      assert.strictEqual(unknownThread._tag, "PlanningTurnNotFoundError");

      yield* assistant.tryImplement({ planId: created.plan.planId });
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.runtimeMode, "approval-required");
      assert.strictEqual(session.cwd, first.path);
      assert.deepStrictEqual(session.additionalDirectories, [second.path]);
      const prompt = (yield* Queue.take(harness.sendTurns)).input ?? "";
      assert.ok(prompt.includes("save_implement_proposal"));
      assert.ok(prompt.includes("# Implement the service boundary"));
      const started = yield* Queue.take(frames);
      assert.strictEqual(started.kind, "implement-started");
      assert.deepStrictEqual(
        yield* assistant.status,
        new Map([[created.plan.planId, { isWorking: true, hasPendingInput: false }]]),
      );

      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "request.opened",
          payload: {
            requestType: "dynamic_tool_call",
            detail: "t3-code_save_implement_proposal: {}",
            args: {
              toolName: "t3-code_save_implement_proposal",
              input: {},
              toolUseId: "tool-save-implement-proposal",
            },
          },
        }),
        requestId: "req-opencode-save-implement" as never,
      });
      assert.deepStrictEqual(yield* Queue.take(harness.approvals), {
        requestId: "req-opencode-save-implement",
        decision: "acceptForSession",
      });

      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "request.opened",
          payload: {
            requestType: "unknown",
            detail: "*",
            args: {},
          },
        }),
        requestId: "req-opencode-anonymous" as never,
      });
      assert.deepStrictEqual(yield* Queue.take(harness.approvals), {
        requestId: "req-opencode-anonymous",
        decision: "decline",
      });

      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "request.opened",
          payload: {
            requestType: "dynamic_tool_call",
            detail: "other-server_save_plan_revision_helper: {}",
            args: {
              toolName: "other-server_save_plan_revision_helper",
              input: {},
              toolUseId: "tool-unrelated-plan-helper",
            },
          },
        }),
        requestId: "req-unrelated-plan-helper" as never,
      });
      assert.deepStrictEqual(yield* Queue.take(harness.approvals), {
        requestId: "req-unrelated-plan-helper",
        decision: "decline",
      });

      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "hidden analysis" },
        }),
      );
      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "user-input.requested",
          payload: { questions: [] },
        }),
        requestId: "implement-question" as never,
      });
      assert.deepStrictEqual(yield* Queue.take(harness.userInputs), {
        requestId: "implement-question",
        answers: {},
      });
      const revisionRefused = yield* Effect.flip(
        assistant.saveRevisionFromThread({ threadId: session.threadId, text: "Must not land" }),
      );
      assert.strictEqual(revisionRefused._tag, "PlanningTurnNotFoundError");
      yield* assistant.saveImplementProposalFromThread({
        threadId: session.threadId,
        repositories: ["wrong-first-call"],
      });
      yield* assistant.saveImplementProposalFromThread({
        threadId: session.threadId,
        repositories: [first.name],
      });
      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      const analyzed = yield* Queue.take(frames);
      if (analyzed.kind !== "implement-analyzed") {
        assert.fail(`expected implement-analyzed, received ${analyzed.kind}`);
      }
      assert.deepStrictEqual(analyzed.proposal.verdict, {
        kind: "atomic",
        repositoryId: first.repositoryId,
        repositoryName: first.name,
      });
      assert.strictEqual(
        analyzed.proposal.parentCommitId,
        MercurianCommitId.make(revision.commitId),
      );
      assert.strictEqual(
        (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.length,
        before,
      );
      assert.deepStrictEqual(yield* Queue.take(frames), {
        kind: "implement-ready",
        ready: {
          commitId: MercurianCommitId.make(revision.commitId),
          repositoryId: first.repositoryId,
          repositoryName: first.name,
        },
      });
      assert.deepStrictEqual(
        (yield* store.listImplementVerdicts({ planId: created.plan.planId })).map(
          ({ commitId, verdict }) => ({ commitId, verdict }),
        ),
        [
          {
            commitId: revision.commitId,
            verdict: {
              kind: "ready",
              payload: {
                repositoryId: first.repositoryId,
                repositoryName: first.name,
              },
            },
          },
        ],
      );
      assert.strictEqual(yield* Queue.take(harness.stops), session.threadId);
      assert.ok((yield* assistant.implementProposal(created.plan.planId)) !== undefined);
      yield* assistant.cancelImplementProposal(created.plan.planId);
      assert.deepStrictEqual(yield* Queue.take(frames), {
        kind: "implement-cancelled",
        turnId: analyzed.proposal.turnId,
      });
      assert.strictEqual(yield* assistant.implementProposal(created.plan.planId), undefined);
      yield* assistant.cancelImplementProposal(created.plan.planId);
      assert.strictEqual(yield* Queue.size(frames), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("short-circuits a recorded ready verdict without a model or provider session", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-08T01:10:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Ready plan",
        createdAt: at("2026-08-08T01:10:00.000Z"),
      });
      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Ready without another analysis",
        createdAt: at("2026-08-08T01:11:00.000Z"),
      });
      const repositoryId = MercurianRepositoryId.make("recorded-ready-repository");
      yield* store.recordImplementVerdict({
        planId: created.plan.planId,
        commitId: revision.commitId,
        verdict: {
          kind: "ready",
          payload: { repositoryId, repositoryName: "recorded-ready" },
        },
        recordedAt: at("2026-08-08T01:12:00.000Z"),
      });
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.tryImplement({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
      });
      const analyzed = yield* Queue.take(frames);
      assert.ok(analyzed.kind === "implement-analyzed");
      if (analyzed.kind === "implement-analyzed") {
        assert.deepStrictEqual(analyzed.proposal.verdict, {
          kind: "atomic",
          repositoryId,
          repositoryName: "recorded-ready",
        });
        assert.strictEqual(
          analyzed.proposal.parentCommitId,
          MercurianCommitId.make(revision.commitId),
        );
      }
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
      assert.strictEqual(yield* assistant.inFlightImplement(created.plan.planId), undefined);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("refuses a recorded ready short-circuit while a reply turn is active", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created } = yield* seedPlan();
      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Ready after the reply",
        createdAt: at("2026-08-08T01:15:00.000Z"),
      });
      const repositoryId = MercurianRepositoryId.make("active-ready-repository");
      yield* store.recordImplementVerdict({
        planId: created.plan.planId,
        commitId: revision.commitId,
        verdict: {
          kind: "ready",
          payload: { repositoryId, repositoryName: "active-ready" },
        },
        recordedAt: at("2026-08-08T01:16:00.000Z"),
      });
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
        text: "Finish this reply first",
      });
      const session = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      assert.strictEqual((yield* Queue.take(frames)).kind, "turn-started");

      const refused = yield* Effect.flip(
        assistant.tryImplement({
          planId: created.plan.planId,
          parentCommitId: revision.commitId,
        }),
      );
      assert.strictEqual(refused._tag, "PlanTurnActiveError");
      assert.strictEqual(yield* Queue.size(frames), 0);
      assert.strictEqual(yield* assistant.implementProposal(created.plan.planId), undefined);

      yield* assistant.teardownPlan({ planId: created.plan.planId, commitPartial: false });
      assert.strictEqual((yield* Queue.take(frames)).kind, "turn-settled");
      assert.strictEqual(yield* Queue.take(harness.stops), session.threadId);

      yield* assistant.tryImplement({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
      });
      const analyzed = yield* Queue.take(frames);
      assert.ok(
        analyzed.kind === "implement-analyzed" && analyzed.proposal.verdict.kind === "atomic",
      );
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("short-circuits a fully covered recorded verdict without a provider session", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created } = yield* seedPlan();
      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Both repositories",
        createdAt: at("2026-08-08T01:20:00.000Z"),
      });
      const { first, second } = yield* seedTwoRepositories(created);
      yield* store.recordImplementVerdict({
        planId: created.plan.planId,
        commitId: revision.commitId,
        verdict: {
          kind: "needs-split",
          payload: {
            repositories: [
              { repositoryId: first.repositoryId, repositoryName: first.name },
              { repositoryId: second.repositoryId, repositoryName: second.name },
            ],
            rationale: "Two implementation roots.",
          },
        },
        recordedAt: at("2026-08-08T01:21:00.000Z"),
      });
      yield* store.saveSplits({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
        splits: [
          { repositoryId: first.repositoryId, text: "First projection" },
          { repositoryId: second.repositoryId, text: "Second projection" },
        ],
        createdAt: at("2026-08-08T01:22:00.000Z"),
      });
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
        text: "Finish this reply first",
      });
      const session = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      assert.strictEqual((yield* Queue.take(frames)).kind, "turn-started");

      const refused = yield* Effect.flip(
        assistant.tryImplement({
          planId: created.plan.planId,
          parentCommitId: revision.commitId,
        }),
      );
      assert.strictEqual(refused._tag, "PlanTurnActiveError");
      assert.strictEqual(yield* Queue.size(frames), 0);
      assert.strictEqual(yield* assistant.implementProposal(created.plan.planId), undefined);

      yield* assistant.teardownPlan({ planId: created.plan.planId, commitPartial: false });
      assert.strictEqual((yield* Queue.take(frames)).kind, "turn-settled");
      assert.strictEqual(yield* Queue.take(harness.stops), session.threadId);

      yield* assistant.tryImplement({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
      });
      const analyzed = yield* Queue.take(frames);
      assert.ok(analyzed.kind === "implement-analyzed");
      if (analyzed.kind === "implement-analyzed") {
        assert.deepStrictEqual(analyzed.proposal.verdict, {
          kind: "already-covered",
          repositories: [
            { repositoryId: first.repositoryId, repositoryName: first.name },
            { repositoryId: second.repositoryId, repositoryName: second.name },
          ],
        });
      }
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
      assert.strictEqual(yield* assistant.inFlightImplement(created.plan.planId), undefined);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("runs the implement turn when a recorded verdict is only partially covered", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created } = yield* seedPlan();
      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Both repositories",
        createdAt: at("2026-08-08T01:30:00.000Z"),
      });
      const { first, second } = yield* seedTwoRepositories(created);
      yield* store.recordImplementVerdict({
        planId: created.plan.planId,
        commitId: revision.commitId,
        verdict: {
          kind: "needs-split",
          payload: {
            repositories: [
              { repositoryId: first.repositoryId, repositoryName: first.name },
              { repositoryId: second.repositoryId, repositoryName: second.name },
            ],
          },
        },
        recordedAt: at("2026-08-08T01:31:00.000Z"),
      });
      yield* store.saveSplits({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
        splits: [{ repositoryId: first.repositoryId, text: "First projection" }],
        createdAt: at("2026-08-08T01:32:00.000Z"),
      });
      const frames = yield* subscribeFrames(created.plan.planId);

      yield* assistant.tryImplement({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
      });
      const session = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      const started = yield* Queue.take(frames);
      assert.strictEqual(started.kind, "implement-started");
      yield* assistant.teardownPlan({ planId: created.plan.planId, commitPartial: false });
      const stopped = yield* Queue.take(frames);
      assert.ok(stopped.kind === "implement-failed" && stopped.reason === "stopped");
      assert.strictEqual(yield* Queue.take(harness.stops), session.threadId);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("validates multi-repository proposals and reports every failure without commits", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created } = yield* seedPlan();
      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Change both packages",
        createdAt: at("2026-08-08T02:00:00.000Z"),
      });
      const { first, second } = yield* seedTwoRepositories(created);
      const frames = yield* subscribeFrames(created.plan.planId);
      const before = (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline
        .length;

      const analyze = Effect.fn("test.analyze")(function* (
        proposal?: PlanningAssistant.PendingImplementProposal,
      ) {
        yield* assistant.tryImplement({ planId: created.plan.planId });
        const session = yield* Queue.take(harness.startSessions);
        yield* Queue.take(harness.sendTurns);
        yield* Queue.take(frames);
        if (proposal !== undefined) {
          yield* assistant.saveImplementProposalFromThread({
            threadId: session.threadId,
            ...proposal,
          });
        }
        yield* harness.emit(
          runtimeEvent(session.threadId, {
            type: "turn.completed",
            payload: { state: "completed" },
          }),
        );
        const result = yield* Queue.take(frames);
        yield* Queue.take(harness.stops);
        return result;
      });

      const absent = yield* analyze();
      assert.ok(absent.kind === "implement-failed" && absent.reason === "no-proposal");
      const unknown = yield* analyze({ repositories: ["not-a-project-repository"] });
      assert.ok(unknown.kind === "implement-failed" && unknown.reason === "invalid-proposal");
      const mismatch = yield* analyze({
        repositories: [first.name, second.name],
        splits: [{ repository: first.name, text: "Only one" }],
      });
      assert.ok(mismatch.kind === "implement-failed" && mismatch.reason === "invalid-proposal");
      const valid = yield* analyze({
        repositories: [first.name, second.name],
        rationale: "The protocol and implementation move together.",
        splits: [
          { repository: first.name, text: "First projection" },
          { repository: second.name, text: "Second projection" },
        ],
      });
      assert.ok(
        valid.kind === "implement-analyzed" && valid.proposal.verdict.kind === "needs-split",
      );
      assert.strictEqual(
        valid.kind === "implement-analyzed" && valid.proposal.verdict.kind === "needs-split"
          ? valid.proposal.verdict.splits.length
          : 0,
        2,
      );
      assert.deepStrictEqual(
        (yield* store.listImplementVerdicts({ planId: created.plan.planId })).map(
          ({ commitId, verdict }) => ({ commitId, verdict }),
        ),
        [
          {
            commitId: revision.commitId,
            verdict: {
              kind: "needs-split",
              payload: {
                repositories: [
                  { repositoryId: first.repositoryId, repositoryName: first.name },
                  { repositoryId: second.repositoryId, repositoryName: second.name },
                ],
                rationale: "The protocol and implementation move together.",
              },
            },
          },
        ],
      );
      assert.ok((yield* assistant.implementProposal(created.plan.planId)) !== undefined);
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
        text: "Revisit the plan",
      });
      yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames);
      assert.strictEqual(yield* assistant.implementProposal(created.plan.planId), undefined);
      yield* assistant.teardownPlan({ planId: created.plan.planId, commitPartial: false });
      yield* Queue.take(frames);
      yield* Queue.take(harness.stops);

      const repositories = yield* RepositoryStore.RepositoryStore;
      const duplicate = yield* repositories.addRepository({
        path: "/var",
        name: first.name,
        createdAt: at("2026-08-08T02:10:00.000Z"),
      });
      yield* repositories.setProjectRepositories({
        projectId: created.plan.projectId,
        repositoryIds: [first.repositoryId, second.repositoryId, duplicate.repositoryId],
        addedAt: at("2026-08-08T02:11:00.000Z"),
      });
      const ambiguous = yield* analyze({ repositories: [first.name] });
      assert.ok(ambiguous.kind === "implement-failed" && ambiguous.reason === "invalid-proposal");
      assert.strictEqual(
        (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.length,
        before,
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("stops and tears down implement turns without landing history", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created } = yield* seedPlan();
      yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Implement me",
        createdAt: at("2026-08-08T03:00:00.000Z"),
      });
      yield* seedTwoRepositories(created);
      const before = (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline
        .length;
      const frames = yield* subscribeFrames(created.plan.planId);
      yield* assistant.tryImplement({ planId: created.plan.planId });
      const session = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames);
      yield* assistant.stopTurn({ planId: created.plan.planId });
      yield* Queue.take(harness.interrupts);
      yield* harness.emit(
        runtimeEvent(session.threadId, { type: "turn.aborted", payload: { reason: "interrupt" } }),
      );
      const stopped = yield* Queue.take(frames);
      assert.ok(stopped.kind === "implement-failed" && stopped.reason === "stopped");
      yield* Queue.take(harness.stops);
      assert.strictEqual(
        (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.length,
        before,
      );

      yield* assistant.tryImplement({ planId: created.plan.planId });
      yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames);
      yield* assistant.teardownPlan({ planId: created.plan.planId, commitPartial: false });
      const tornDown = yield* Queue.take(frames);
      assert.ok(tornDown.kind === "implement-failed" && tornDown.reason === "stopped");
      yield* Queue.take(harness.stops);
      assert.strictEqual(
        (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.length,
        before,
      );

      yield* assistant.tryImplement({ planId: created.plan.planId });
      const failedSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(harness.sendTurns);
      yield* Queue.take(frames);
      yield* harness.emit(
        runtimeEvent(failedSession.threadId, {
          type: "session.exited",
          payload: { reason: "provider exited" },
        }),
      );
      const providerFailure = yield* Queue.take(frames);
      assert.ok(
        providerFailure.kind === "implement-failed" && providerFailure.reason === "provider-error",
      );
      yield* Queue.take(harness.stops);
      assert.strictEqual(
        (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.length,
        before,
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("refuses empty plans and conflicting reply/implement turns synchronously", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const empty = yield* Effect.flip(assistant.tryImplement({ planId: created.plan.planId }));
      assert.ok(empty._tag === "ImplementBlockedError" && empty.reason === "plan-empty");
      const revision = yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Ready",
        createdAt: at("2026-08-08T04:00:00.000Z"),
      });
      yield* seedTwoRepositories(created);
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: revision.commitId,
        text: "Reply",
      });
      yield* Queue.take(harness.startSessions);
      const conflict = yield* Effect.flip(assistant.tryImplement({ planId: created.plan.planId }));
      assert.strictEqual(conflict._tag, "PlanTurnActiveError");
      yield* assistant.teardownPlan({ planId: created.plan.planId, commitPartial: false });

      const frames = yield* subscribeFrames(created.plan.planId);
      yield* assistant.tryImplement({ planId: created.plan.planId });
      yield* Queue.take(harness.startSessions);
      yield* Queue.take(frames);
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "Reply while analyzing",
      });
      const refused = yield* Queue.take(frames);
      assert.ok(refused.kind === "turn-refused" && refused.reason === "turn-active");
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("refuses an implement turn when the planning model is unset", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const project = yield* store.createProject({
        name: "Astrolabe",
        createdAt: at("2026-08-08T04:30:00.000Z"),
      });
      const created = yield* store.createPlan({
        lastUsed: null,
        projectId: project.projectId,
        message: "Ready plan",
        createdAt: at("2026-08-08T04:30:00.000Z"),
      });
      yield* store.savePlanRevision({
        planId: created.plan.planId,
        text: "# Ready",
        createdAt: at("2026-08-08T04:31:00.000Z"),
      });
      const refused = yield* Effect.flip(assistant.tryImplement({ planId: created.plan.planId }));
      assert.ok(refused._tag === "ImplementBlockedError" && refused.reason === "model-unset");
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  for (const [label, providers, expected] of [
    ["no provider instance", [], "no-instance"],
    [
      "unavailable model",
      [
        {
          ...providerSnapshot,
          models: [{ slug: "sonnet", name: "Sonnet", isCustom: false, capabilities: null }],
        },
      ],
      "model-unavailable",
    ],
  ] as const) {
    it.effect(`refuses an implement turn for ${label}`, () =>
      Effect.gen(function* () {
        const assistant = yield* PlanningAssistant.PlanningAssistant;
        const store = yield* PlanningStore.PlanningStore;
        const { created } = yield* seedPlan();
        yield* store.savePlanRevision({
          planId: created.plan.planId,
          text: "# Ready",
          createdAt: at("2026-08-08T05:00:00.000Z"),
        });
        const refused = yield* Effect.flip(assistant.tryImplement({ planId: created.plan.planId }));
        assert.ok(refused._tag === "ImplementBlockedError" && refused.reason === expected);
      }).pipe(Effect.scoped, Effect.provide(testLayer(providers))),
    );
  }
});
