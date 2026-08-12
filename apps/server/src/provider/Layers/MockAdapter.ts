import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  RuntimeRequestId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("mock");
const CREATED_AT = "2026-01-01T00:00:00.000Z";
const QUESTION_ID = "mock_direction";

export const MOCK_QUESTION = {
  id: QUESTION_ID,
  header: "Direction",
  question: "Which mock planning direction should continue?",
  options: [
    { label: "Focused", description: "Continue with the smallest useful plan." },
    { label: "Expanded", description: "Continue with a more detailed plan." },
  ],
  multiSelect: false,
} as const;

const DEFAULT_REPLY =
  "Mock planning reply: I reviewed the request and prepared a deterministic next step.";
const VERBOSE_REPLY =
  "Mock verbose planning reply: I reviewed the request, mapped the relevant constraints, identified the implementation seam, and prepared a deterministic sequence of focused next steps for development.";
const REVISE_REPLY =
  "Mock revision: I would update the plan with a smaller first milestone and an explicit verification step.";

interface ActiveTurn {
  readonly turnId: TurnId;
  input: string;
  readonly model: string;
  readonly chunks: Array<string>;
  pendingRequestId?: ApprovalRequestId | undefined;
  fiber?: Fiber.Fiber<void, never> | undefined;
}

interface SessionState {
  session: ProviderSession;
  snapshot: ProviderThreadSnapshot;
  turnCount: number;
  active?: ActiveTurn | undefined;
}

export interface MakeMockAdapterOptions {
  readonly interChunkDelay?: Duration.Duration | undefined;
  readonly providerInstanceId?: ProviderSession["providerInstanceId"] | undefined;
}

const sessionNotFound = (threadId: ThreadId) =>
  new ProviderAdapterSessionNotFoundError({
    provider: PROVIDER,
    threadId: String(threadId),
  });

const missingSession = (threadId: ThreadId): Effect.Effect<never, ProviderAdapterError> =>
  Effect.fail(sessionNotFound(threadId));

const chunksFor = (text: string): Array<string> => {
  const words = text.split(" ");
  const chunks: Array<string> = [];
  for (let index = 0; index < words.length; index += 3) {
    const value = words.slice(index, index + 3).join(" ");
    chunks.push(index + 3 < words.length ? `${value} ` : value);
  }
  return chunks;
};

const assistantTextFor = (input: string, model: string): string => {
  if (input.includes("/revise")) return REVISE_REPLY;
  return model === "mock-verbose" ? VERBOSE_REPLY : DEFAULT_REPLY;
};

const chosenAnswer = (answers: Readonly<Record<string, unknown>>): string => {
  const value = answers[QUESTION_ID];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "No option";
};

export const makeMockAdapter = Effect.fn("makeMockAdapter")(function* (
  options: MakeMockAdapterOptions = {},
) {
  const interChunkDelay = options.interChunkDelay ?? Duration.millis(140);
  const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const scope = yield* Effect.scope;
  const sessions = new Map<ThreadId, SessionState>();
  yield* Effect.addFinalizer(() => Queue.shutdown(runtimeEvents));

  const emit = (event: ProviderRuntimeEvent) =>
    Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

  const eventBase = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly ordinal: number;
  }) => ({
    eventId: EventId.make(`mock:${input.threadId}:${input.turnId}:${input.ordinal}`),
    provider: PROVIDER,
    ...(options.providerInstanceId === undefined
      ? {}
      : { providerInstanceId: options.providerInstanceId }),
    threadId: input.threadId,
    turnId: input.turnId,
    createdAt: CREATED_AT,
  });

  const completeSnapshot = (state: SessionState, active: ActiveTurn) => {
    const assistantText = active.chunks.join("");
    const items: Array<unknown> = [
      { type: "userMessage", content: [{ type: "text", text: active.input }] },
    ];
    if (assistantText.length > 0) {
      items.push({ type: "agentMessage", text: assistantText });
    }
    const nextTurn: ProviderThreadTurnSnapshot = { id: active.turnId, items };
    state.snapshot = {
      threadId: state.snapshot.threadId,
      turns: [...state.snapshot.turns, nextTurn],
    };
    const { activeTurnId: _activeTurnId, ...session } = state.session;
    state.session = { ...session, status: "ready", updatedAt: CREATED_AT };
    if (state.active?.turnId === active.turnId) {
      state.active = undefined;
    }
  };

  const emitGrounding = Effect.fn("MockAdapter.emitGrounding")(function* (
    threadId: ThreadId,
    turnId: TurnId,
  ) {
    yield* emit({
      ...eventBase({ threadId, turnId, ordinal: 2 }),
      type: "item.completed",
      itemId: RuntimeItemId.make(`mock:${threadId}:${turnId}:ground-read`),
      payload: {
        itemType: "dynamic_tool_call",
        status: "completed",
        title: "Read",
        detail: "docs/project/technical-plan-m-130-mock-provider-dev-mode.md",
        data: { kind: "read" },
      },
    });
    yield* emit({
      ...eventBase({ threadId, turnId, ordinal: 3 }),
      type: "item.completed",
      itemId: RuntimeItemId.make(`mock:${threadId}:${turnId}:ground-search`),
      payload: {
        itemType: "dynamic_tool_call",
        status: "completed",
        title: "Grep",
        detail: "ProviderInstanceRegistryHydration",
        data: { kind: "search" },
      },
    });
  });

  const emitRevision = Effect.fn("MockAdapter.emitRevision")(function* (
    threadId: ThreadId,
    turnId: TurnId,
  ) {
    yield* emit({
      ...eventBase({ threadId, turnId, ordinal: 4 }),
      type: "item.completed",
      itemId: RuntimeItemId.make(`mock:${threadId}:${turnId}:revision`),
      payload: {
        itemType: "mcp_tool_call",
        status: "declined",
        title: "save_plan_revision",
        detail: "Mock revision preview; no MCP call was made.",
        data: { mock: true },
      },
    });
  });

  const streamReply = Effect.fn("MockAdapter.streamReply")(function* (
    state: SessionState,
    active: ActiveTurn,
    startOrdinal: number,
    replyOverride?: string,
  ) {
    const reply = replyOverride ?? assistantTextFor(active.input, active.model);
    const chunks = chunksFor(reply);
    for (let index = 0; index < chunks.length; index += 1) {
      const delta = chunks[index]!;
      active.chunks.push(delta);
      yield* emit({
        ...eventBase({
          threadId: state.session.threadId,
          turnId: active.turnId,
          ordinal: startOrdinal + index,
        }),
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta },
      });
      if (index < chunks.length - 1) {
        yield* Effect.sleep(interChunkDelay);
      }
    }

    const completedOrdinal = startOrdinal + chunks.length;
    yield* emit({
      ...eventBase({
        threadId: state.session.threadId,
        turnId: active.turnId,
        ordinal: completedOrdinal,
      }),
      type: "item.completed",
      itemId: RuntimeItemId.make(`mock:${state.session.threadId}:${active.turnId}:assistant`),
      payload: {
        itemType: "assistant_message",
        status: "completed",
        title: "Assistant message",
      },
    });
    yield* emit({
      ...eventBase({
        threadId: state.session.threadId,
        turnId: active.turnId,
        ordinal: completedOrdinal + 1,
      }),
      type: "turn.completed",
      payload: { state: "completed" },
    });
    completeSnapshot(state, active);
  });

  const forkReply = Effect.fn("MockAdapter.forkReply")(function* (
    state: SessionState,
    active: ActiveTurn,
    startOrdinal: number,
    replyOverride?: string,
  ) {
    const fiber = yield* streamReply(state, active, startOrdinal, replyOverride).pipe(
      Effect.forkIn(scope),
    );
    if (state.active?.turnId === active.turnId) {
      active.fiber = fiber;
    }
  });

  const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
    Effect.gen(function* () {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }

      const session: ProviderSession = {
        provider: PROVIDER,
        ...(input.providerInstanceId !== undefined
          ? { providerInstanceId: input.providerInstanceId }
          : options.providerInstanceId !== undefined
            ? { providerInstanceId: options.providerInstanceId }
            : {}),
        status: "ready",
        runtimeMode: input.runtimeMode,
        threadId: input.threadId,
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.modelSelection === undefined ? {} : { model: input.modelSelection.model }),
        resumeCursor: input.resumeCursor ?? { provider: "mock", threadId: String(input.threadId) },
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      };
      sessions.set(input.threadId, {
        session,
        snapshot: { threadId: input.threadId, turns: [] },
        turnCount: 0,
      });
      return session;
    });

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const state = sessions.get(input.threadId);
      if (state === undefined) return yield* missingSession(input.threadId);
      if (state.active !== undefined) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Thread '${input.threadId}' already has an active turn.`,
        });
      }

      state.turnCount += 1;
      const turnId = TurnId.make(`mock-turn-${state.turnCount}`);
      const active: ActiveTurn = {
        turnId,
        input: input.input ?? "",
        model: input.modelSelection?.model ?? state.session.model ?? "mock-default",
        chunks: [],
      };
      state.active = active;
      state.session = {
        ...state.session,
        status: "running",
        activeTurnId: turnId,
        model: active.model,
        updatedAt: CREATED_AT,
      };

      yield* emit({
        ...eventBase({ threadId: input.threadId, turnId, ordinal: 1 }),
        type: "turn.started",
        payload: { model: active.model },
      });

      let replyOrdinal = 2;
      if (active.input.includes("/ground")) {
        yield* emitGrounding(input.threadId, turnId);
        replyOrdinal = 4;
      }
      if (active.input.includes("/revise")) {
        yield* emitRevision(input.threadId, turnId);
        replyOrdinal = 5;
      }
      if (active.input.includes("/question")) {
        const requestId = ApprovalRequestId.make(`mock-question-${state.turnCount}`);
        active.pendingRequestId = requestId;
        yield* emit({
          ...eventBase({ threadId: input.threadId, turnId, ordinal: replyOrdinal }),
          type: "user-input.requested",
          requestId: RuntimeRequestId.make(String(requestId)),
          payload: { questions: [MOCK_QUESTION] },
        });
      } else {
        yield* forkReply(state, active, replyOrdinal);
      }

      return { threadId: input.threadId, turnId } satisfies ProviderTurnStartResult;
    });

  const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
    threadId,
    turnId,
  ) =>
    Effect.gen(function* () {
      const state = sessions.get(threadId);
      if (state === undefined) return yield* missingSession(threadId);
      const active = state.active;
      if (active === undefined || (turnId !== undefined && active.turnId !== turnId)) return;
      if (active.fiber !== undefined) {
        yield* Fiber.interrupt(active.fiber).pipe(Effect.ignore);
      }
      yield* emit({
        ...eventBase({ threadId, turnId: active.turnId, ordinal: 99 }),
        type: "turn.aborted",
        payload: { reason: "Mock turn interrupted." },
      });
      completeSnapshot(state, active);
    });

  const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
    threadId,
  ) => (sessions.has(threadId) ? Effect.void : missingSession(threadId));

  const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    Effect.gen(function* () {
      const state = sessions.get(threadId);
      if (state === undefined) return yield* missingSession(threadId);
      const active = state.active;
      if (active?.pendingRequestId === undefined || active.pendingRequestId !== requestId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "respondToUserInput",
          issue: `No pending mock question '${requestId}' for thread '${threadId}'.`,
        });
      }

      active.pendingRequestId = undefined;
      yield* emit({
        ...eventBase({ threadId, turnId: active.turnId, ordinal: 6 }),
        type: "user-input.resolved",
        requestId: RuntimeRequestId.make(String(requestId)),
        payload: { answers },
      });
      const answer = chosenAnswer(answers);
      active.input = `${active.input}\nSelected option: ${answer}`;
      const reply = `Mock question answered: ${answer}. Continuing with the deterministic plan.`;
      active.chunks.length = 0;
      yield* forkReply(state, active, 7, reply);
    });

  const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const state = sessions.get(threadId);
      if (state?.active?.fiber !== undefined) {
        yield* Fiber.interrupt(state.active.fiber).pipe(Effect.ignore);
      }
      sessions.delete(threadId);
    });

  const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values(), (state) => state.session));

  const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
    Effect.succeed(sessions.has(threadId));

  const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) => {
    const state = sessions.get(threadId);
    return state === undefined ? missingSession(threadId) : Effect.succeed(state.snapshot);
  };

  const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
    threadId,
    numTurns,
  ) => {
    const state = sessions.get(threadId);
    if (state === undefined) return missingSession(threadId);
    if (!Number.isInteger(numTurns) || numTurns < 0 || numTurns > state.snapshot.turns.length) {
      return Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer between 0 and current turn count.",
        }),
      );
    }
    return Effect.sync(() => {
      state.snapshot = {
        threadId,
        turns: state.snapshot.turns.slice(0, state.snapshot.turns.length - numTurns),
      };
      state.turnCount = state.snapshot.turns.length;
      return state.snapshot;
    });
  };

  const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
    Effect.forEach([...sessions.keys()], stopSession, { discard: true });

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session", groundingRoots: "multi" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromQueue(runtimeEvents),
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});
