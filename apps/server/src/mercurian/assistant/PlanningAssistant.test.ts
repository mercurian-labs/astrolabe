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
import * as PlanTurnRegistry from "../planning/PlanTurnRegistry.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as WorkspaceSettingsStore from "../workspace/WorkspaceSettingsStore.ts";
import * as PlanningAssistant from "./PlanningAssistant.ts";

const claude = ProviderDriverKind.make("claudeAgent");
const claudeInstance = ProviderInstanceId.make("claudeAgent");

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
        PlanningStore.layer,
        RepositoryStore.layer.pipe(Layer.provide(stubProcessRunner)),
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
  yield* settings.setPlanningModel({ provider: claude, model: "opus" });
  const project = yield* store.createProject({
    name: "Astrolabe",
    createdAt: at("2026-08-08T00:00:00.000Z"),
  });
  const created = yield* store.createPlan({
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

const seedDerivablePlan = Effect.fn("seedDerivablePlan")(function* () {
  const store = yield* PlanningStore.PlanningStore;
  const repositories = yield* RepositoryStore.RepositoryStore;
  const { created, root } = yield* seedPlan();
  const source = yield* store.savePlanRevision({
    planId: created.plan.planId,
    parentCommitId: root.commitId,
    text: "# Technical plans\n\nDerive one for this repository.",
    createdAt: at("2026-08-08T00:01:00.000Z"),
  });
  const repository = yield* repositories.addRepository({
    path: "/tmp",
    name: "astrolabe",
    createdAt: at("2026-08-08T00:01:00.000Z"),
  });
  yield* repositories.setProjectRepositories({
    projectId: created.plan.projectId,
    repositoryIds: [repository.repositoryId],
    addedAt: at("2026-08-08T00:01:00.000Z"),
  });
  return { created, root, source, repository };
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

  it.effect("auto-answers approvals: reads for the session, everything else declined", () =>
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

  it.effect("the MCP door writes at the turn's tip and keeps the chain linear", () =>
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
      const technicalRefused = yield* Effect.flip(
        assistant.saveTechnicalPlanFromThread({
          threadId: session.threadId,
          text: "Not a derivation",
        }),
      );
      assert.strictEqual(technicalRefused._tag, "PlanningTurnNotFoundError");
      const unknownTechnicalRefused = yield* Effect.flip(
        assistant.saveTechnicalPlanFromThread({
          threadId: ThreadId.make("coding-thread"),
          text: "Still not a derivation",
        }),
      );
      assert.strictEqual(unknownTechnicalRefused._tag, "PlanningTurnNotFoundError");

      // The turn's own thread revises mid-turn, then reads back what it wrote.
      yield* assistant.saveRevisionFromThread({
        threadId: session.threadId,
        text: "# Revised by the assistant",
      });
      const readBack = yield* assistant.readPlanFromThread({ threadId: session.threadId });
      assert.strictEqual(readBack, "# Revised by the assistant");

      yield* harness.emit(
        runtimeEvent(session.threadId, { type: "turn.completed", payload: { state: "completed" } }),
      );
      yield* Queue.take(frames); // turn-settled

      // The revision parents on the human message; the settled reply parents
      // on the revision: linear by construction.
      const snapshot = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      const [message, revision, reply] = snapshot.timeline;
      assert.ok(revision !== undefined && revision._tag === "plan-revision");
      assert.strictEqual(revision.authorKind, "assistant");
      assert.deepStrictEqual([...revision.parents], [message!.commitId]);
      assert.ok(reply !== undefined && reply._tag === "message");
      assert.deepStrictEqual([...reply.parents], [revision.commitId]);
      assert.strictEqual(snapshot.planText, "# Revised by the assistant");
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

  it.effect("ordinary messages and plan edits never start a derivation", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const harness = yield* ProviderHarness;
      const { created, source } = yield* seedDerivablePlan();

      // seedDerivablePlan has already landed both a message and a direct edit.
      assert.strictEqual(yield* assistant.inFlightDerivation(created.plan.planId), undefined);
      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: source.commitId,
        text: "Refine the plan",
      });
      yield* Queue.take(harness.startSessions);
      const sent = yield* Queue.take(harness.sendTurns);
      assert.ok(!sent.input?.includes("save_technical_plan"));
      assert.strictEqual(yield* assistant.inFlightDerivation(created.plan.planId), undefined);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("derives only on demand and settles exactly one stamped human commit", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, source, repository } = yield* seedDerivablePlan();
      const frames = yield* subscribeFrames(created.plan.planId);

      // Plan creation and its edit did not derive anything. startDerivation is
      // the sole entry into the repository-scoped flavor.
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
      assert.strictEqual(yield* assistant.inFlightDerivation(created.plan.planId), undefined);
      const before = yield* store.getPlanSnapshot({ planId: created.plan.planId });

      yield* assistant.startDerivation({
        planId: created.plan.planId,
        repositoryId: repository.repositoryId,
        parentCommitId: source.commitId,
        createdAt: at("2026-08-08T00:02:00.000Z"),
      });
      const session = yield* Queue.take(harness.startSessions);
      assert.strictEqual(session.cwd, repository.path);
      assert.strictEqual(session.additionalDirectories, undefined);
      assert.strictEqual(session.runtimeMode, "approval-required");
      const sent = yield* Queue.take(harness.sendTurns);
      assert.ok(sent.input?.includes("save_technical_plan"));
      assert.ok(sent.input?.includes("# Technical plans"));
      const started = yield* Queue.take(frames);
      assert.ok(
        started.kind === "derivation-started" &&
          started.derivation.repositoryId === repository.repositoryId,
      );

      const revisionRefused = yield* assistant
        .saveRevisionFromThread({
          threadId: session.threadId,
          text: "A derivation cannot revise the source plan",
        })
        .pipe(Effect.flip);
      assert.strictEqual(revisionRefused._tag, "PlanningTurnNotFoundError");

      // The shared claim protects the derivation point from human writes.
      const messageRefusal = yield* store
        .appendMessage({
          planId: created.plan.planId,
          parentCommitId: source.commitId,
          text: "Race",
          createdAt: at("2026-08-08T00:02:30.000Z"),
        })
        .pipe(Effect.flip);
      assert.strictEqual(messageRefusal._tag, "PlanTurnActiveError");
      const revisionRefusal = yield* store
        .savePlanRevision({
          planId: created.plan.planId,
          parentCommitId: source.commitId,
          text: "Race",
          createdAt: at("2026-08-08T00:02:30.000Z"),
        })
        .pipe(Effect.flip);
      assert.strictEqual(revisionRefusal._tag, "PlanTurnActiveError");

      // Narration is not conversation and emits no delta frame.
      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Working on it" },
        }),
      );
      yield* Effect.yieldNow;
      assert.strictEqual(yield* Queue.size(frames), 0);

      // Questions are auto-answered empty and never become pending input.
      yield* harness.emit({
        ...runtimeEvent(session.threadId, {
          type: "user-input.requested",
          payload: {
            questions: [
              {
                id: "q1",
                header: "Choice",
                question: "Which approach?",
                options: [{ label: "A", description: "Use A" }],
              },
            ],
          },
        }),
        requestId: "derivation-question" as never,
      });
      assert.deepStrictEqual(yield* Queue.take(harness.userInputs), {
        requestId: "derivation-question",
        answers: {},
      });
      assert.deepStrictEqual((yield* assistant.status).get(created.plan.planId), {
        isWorking: true,
        hasPendingInput: false,
      });
      assert.strictEqual(
        yield* assistant.readPlanFromThread({ threadId: session.threadId }),
        "# Technical plans\n\nDerive one for this repository.",
      );

      yield* harness.emit(
        runtimeEvent(session.threadId, {
          type: "tool.progress",
          payload: {
            toolName: "Read",
            summary: "Read apps/server/src/ws.ts",
            toolUseId: "derive-read",
          },
        }),
      );
      const grounding = yield* Queue.take(frames);
      assert.ok(grounding.kind === "turn-grounding");

      yield* assistant.saveTechnicalPlanFromThread({
        threadId: session.threadId,
        text: "# Repository implementation plan",
      });
      yield* harness.emit(
        runtimeEvent(session.threadId, { type: "turn.completed", payload: { state: "completed" } }),
      );
      const settled = yield* Queue.take(frames);
      assert.ok(settled.kind === "derivation-settled");
      assert.strictEqual(yield* Queue.take(harness.stops), session.threadId);

      const after = yield* store.getPlanSnapshot({ planId: created.plan.planId });
      assert.strictEqual(after.timeline.length, before.timeline.length + 1);
      const technical = after.timeline.at(-1);
      assert.ok(technical !== undefined && technical._tag === "technical-plan");
      assert.strictEqual(technical.authorKind, "human");
      assert.deepStrictEqual([...technical.parents], [source.commitId]);
      assert.strictEqual(technical.sourceRevisionCommitId, source.commitId);
      assert.strictEqual(
        (yield* store.getTechnicalPlanAt({
          planId: created.plan.planId,
          commitId: technical.commitId,
        })).text,
        "# Repository implementation plan",
      );
      assert.strictEqual(yield* assistant.inFlightDerivation(created.plan.planId), undefined);

      const upToDate = yield* assistant
        .startDerivation({
          planId: created.plan.planId,
          repositoryId: repository.repositoryId,
          parentCommitId: technical.commitId,
          createdAt: at("2026-08-08T00:03:00.000Z"),
        })
        .pipe(Effect.flip);
      assert.ok(
        upToDate._tag === "TechnicalPlanDerivationBlockedError" && upToDate.reason === "up-to-date",
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("failed and stopped derivations land nothing and remain retryable", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, source, repository } = yield* seedDerivablePlan();
      const frames = yield* subscribeFrames(created.plan.planId);
      const before = yield* store.getPlanSnapshot({ planId: created.plan.planId });

      yield* assistant.startDerivation({
        planId: created.plan.planId,
        repositoryId: repository.repositoryId,
        parentCommitId: source.commitId,
        createdAt: at("2026-08-08T01:00:00.000Z"),
      });
      const noDocumentSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(frames); // derivation-started
      yield* harness.emit(
        runtimeEvent(noDocumentSession.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      const noDocument = yield* Queue.take(frames);
      assert.ok(
        noDocument.kind === "derivation-failed" && noDocument.reason === "no-technical-plan",
      );
      assert.strictEqual(
        (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.length,
        before.timeline.length,
      );

      // The same point is retryable because failure stored no up-to-date fact.
      yield* assistant.startDerivation({
        planId: created.plan.planId,
        repositoryId: repository.repositoryId,
        parentCommitId: source.commitId,
        createdAt: at("2026-08-08T01:01:00.000Z"),
      });
      const stoppedSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(frames); // derivation-started
      yield* assistant.stopTurn({ planId: created.plan.planId });
      yield* Queue.take(harness.interrupts);
      yield* harness.emit(
        runtimeEvent(stoppedSession.threadId, {
          type: "turn.aborted",
          payload: { reason: "interrupt" },
        }),
      );
      const stopped = yield* Queue.take(frames);
      assert.ok(stopped.kind === "derivation-failed" && stopped.reason === "stopped");
      assert.strictEqual(
        (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.length,
        before.timeline.length,
      );

      // An abnormal provider end is also all-or-nothing.
      yield* assistant.startDerivation({
        planId: created.plan.planId,
        repositoryId: repository.repositoryId,
        parentCommitId: source.commitId,
        createdAt: at("2026-08-08T01:02:00.000Z"),
      });
      const failedSession = yield* Queue.take(harness.startSessions);
      yield* Queue.take(frames); // derivation-started
      yield* harness.emit(
        runtimeEvent(failedSession.threadId, {
          type: "turn.aborted",
          payload: { reason: "provider exited" },
        }),
      );
      const failed = yield* Queue.take(frames);
      assert.ok(failed.kind === "derivation-failed" && failed.reason === "provider-error");
      assert.strictEqual(
        (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.length,
        before.timeline.length,
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("archive- and delete-shaped teardown both discard a running derivation", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const harness = yield* ProviderHarness;
      const { created, source, repository } = yield* seedDerivablePlan();
      const frames = yield* subscribeFrames(created.plan.planId);
      const before = yield* store.getPlanSnapshot({ planId: created.plan.planId });

      for (const commitPartial of [false, true]) {
        yield* assistant.startDerivation({
          planId: created.plan.planId,
          repositoryId: repository.repositoryId,
          parentCommitId: source.commitId,
          createdAt: at("2026-08-08T01:30:00.000Z"),
        });
        yield* Queue.take(harness.startSessions);
        yield* Queue.take(frames); // derivation-started
        yield* assistant.teardownPlan({ planId: created.plan.planId, commitPartial });
        const failed = yield* Queue.take(frames);
        assert.ok(failed.kind === "derivation-failed" && failed.reason === "stopped");
        assert.strictEqual(
          (yield* store.getPlanSnapshot({ planId: created.plan.planId })).timeline.length,
          before.timeline.length,
        );
      }
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("refuses invalid derivations synchronously before a session starts", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const store = yield* PlanningStore.PlanningStore;
      const repositories = yield* RepositoryStore.RepositoryStore;
      const harness = yield* ProviderHarness;
      const { created, root } = yield* seedPlan();
      const repository = yield* repositories.addRepository({
        path: "/tmp",
        name: "astrolabe",
        createdAt: at("2026-08-08T02:00:00.000Z"),
      });
      yield* repositories.setProjectRepositories({
        projectId: created.plan.projectId,
        repositoryIds: [repository.repositoryId],
        addedAt: at("2026-08-08T02:00:00.000Z"),
      });

      const empty = yield* assistant
        .startDerivation({
          planId: created.plan.planId,
          repositoryId: repository.repositoryId,
          parentCommitId: root.commitId,
          createdAt: at("2026-08-08T02:01:00.000Z"),
        })
        .pipe(Effect.flip);
      assert.ok(
        empty._tag === "TechnicalPlanDerivationBlockedError" && empty.reason === "plan-empty",
      );

      const source = yield* store.savePlanRevision({
        planId: created.plan.planId,
        parentCommitId: root.commitId,
        text: "# Plan",
        createdAt: at("2026-08-08T02:02:00.000Z"),
      });
      const outside = yield* assistant
        .startDerivation({
          planId: created.plan.planId,
          repositoryId: MercurianRepositoryId.make("outside"),
          parentCommitId: source.commitId,
          createdAt: at("2026-08-08T02:03:00.000Z"),
        })
        .pipe(Effect.flip);
      assert.ok(
        outside._tag === "TechnicalPlanDerivationBlockedError" &&
          outside.reason === "repository-not-in-project",
      );

      yield* assistant.startTurn({
        planId: created.plan.planId,
        parentCommitId: source.commitId,
        text: "Keep planning",
      });
      const active = yield* assistant
        .startDerivation({
          planId: created.plan.planId,
          repositoryId: repository.repositoryId,
          parentCommitId: source.commitId,
          createdAt: at("2026-08-08T02:04:00.000Z"),
        })
        .pipe(Effect.flip);
      assert.strictEqual(active._tag, "PlanTurnActiveError");
      // Only the explicit reply turn above opened a session.
      assert.strictEqual(yield* Queue.size(harness.startSessions), 1);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("refuses an unset planning model before a derivation session starts", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const settings = yield* WorkspaceSettingsStore.WorkspaceSettingsStore;
      const harness = yield* ProviderHarness;
      const { created, source, repository } = yield* seedDerivablePlan();
      yield* settings.setPlanningModel(null);

      const refused = yield* assistant
        .startDerivation({
          planId: created.plan.planId,
          repositoryId: repository.repositoryId,
          parentCommitId: source.commitId,
          createdAt: at("2026-08-08T03:00:00.000Z"),
        })
        .pipe(Effect.flip);
      assert.ok(
        refused._tag === "TechnicalPlanDerivationBlockedError" && refused.reason === "model-unset",
      );
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer())),
  );

  it.effect("refuses unavailable planning-model resolutions before opening a session", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const harness = yield* ProviderHarness;
      const { created, source, repository } = yield* seedDerivablePlan();
      const refused = yield* assistant
        .startDerivation({
          planId: created.plan.planId,
          repositoryId: repository.repositoryId,
          parentCommitId: source.commitId,
          createdAt: at("2026-08-08T03:01:00.000Z"),
        })
        .pipe(Effect.flip);
      assert.ok(refused._tag === "TechnicalPlanDerivationBlockedError");
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
      return refused.reason;
    }).pipe(
      Effect.scoped,
      Effect.provide(testLayer([])),
      Effect.map((reason) => assert.strictEqual(reason, "no-instance")),
    ),
  );

  it.effect("refuses a missing model before opening a derivation session", () =>
    Effect.gen(function* () {
      const assistant = yield* PlanningAssistant.PlanningAssistant;
      const harness = yield* ProviderHarness;
      const { created, source, repository } = yield* seedDerivablePlan();
      const refused = yield* assistant
        .startDerivation({
          planId: created.plan.planId,
          repositoryId: repository.repositoryId,
          parentCommitId: source.commitId,
          createdAt: at("2026-08-08T03:02:00.000Z"),
        })
        .pipe(Effect.flip);
      assert.ok(
        refused._tag === "TechnicalPlanDerivationBlockedError" &&
          refused.reason === "model-unavailable",
      );
      assert.strictEqual(yield* Queue.size(harness.startSessions), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer([{ ...providerSnapshot, models: [] }]))),
  );
});
