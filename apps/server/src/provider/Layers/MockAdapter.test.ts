import { assert, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../Errors.ts";
import { MOCK_QUESTION, makeMockAdapter } from "./MockAdapter.ts";

const MOCK = ProviderDriverKind.make("mock");
const MOCK_INSTANCE = ProviderInstanceId.make("mock");
const encodeEvents = Schema.encodeSync(Schema.fromJsonString(Schema.Array(ProviderRuntimeEvent)));

const startSession = (
  adapter: ProviderAdapterShape<ProviderAdapterError>,
  threadId: ThreadId,
  model = "mock-default",
) =>
  adapter.startSession({
    threadId,
    provider: MOCK,
    providerInstanceId: MOCK_INSTANCE,
    cwd: "/tmp/mock-workspace",
    modelSelection: { instanceId: MOCK_INSTANCE, model },
    runtimeMode: "full-access",
  });

const collectUntil = (
  adapter: ProviderAdapterShape<ProviderAdapterError>,
  predicate: (event: ProviderRuntimeEvent) => boolean,
) =>
  Stream.runCollect(adapter.streamEvents.pipe(Stream.takeUntil(predicate))).pipe(
    Effect.map((events) => Array.from(events)),
  );

const runTurn = Effect.fn("MockAdapterTest.runTurn")(function* (
  input: string,
  options?: { readonly model?: string | undefined },
) {
  const adapter = yield* makeMockAdapter({ interChunkDelay: Duration.zero });
  const threadId = ThreadId.make("mock-thread");
  yield* startSession(adapter, threadId, options?.model);
  const eventsFiber = yield* collectUntil(
    adapter,
    (event) => event.type === "turn.completed" || event.type === "turn.aborted",
  ).pipe(Effect.forkChild);
  yield* adapter.sendTurn({ threadId, input });
  return yield* Fiber.join(eventsFiber);
});

it.effect("streams multiple assistant deltas and then completes", () =>
  Effect.gen(function* () {
    const events = yield* runTurn("Draft a plan");
    const deltas = events.filter((event) => event.type === "content.delta");

    assert.ok(deltas.length > 1);
    assert.strictEqual(events.at(-1)?.type, "turn.completed");
    assert.ok(
      deltas.every(
        (event) => event.type === "content.delta" && event.payload.streamKind === "assistant_text",
      ),
    );
  }).pipe(Effect.scoped),
);

it.effect("uses a longer body for mock-verbose", () =>
  Effect.gen(function* () {
    const normal = yield* runTurn("Draft a plan");
    const verbose = yield* runTurn("Draft a plan", { model: "mock-verbose" });
    const text = (events: ReadonlyArray<ProviderRuntimeEvent>) =>
      events
        .filter((event) => event.type === "content.delta")
        .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
        .join("");

    assert.ok(text(verbose).length > text(normal).length);
  }).pipe(Effect.scoped),
);

it.effect("requests fixed structured input and resumes with the chosen option", () =>
  Effect.gen(function* () {
    const adapter = yield* makeMockAdapter({ interChunkDelay: Duration.zero });
    const threadId = ThreadId.make("mock-question-thread");
    yield* startSession(adapter, threadId);

    const requestedFiber = yield* collectUntil(
      adapter,
      (event) => event.type === "user-input.requested",
    ).pipe(Effect.forkChild);
    yield* adapter.sendTurn({ threadId, input: "Please /question before continuing" });
    const requestedEvents = yield* Fiber.join(requestedFiber);
    const requested = requestedEvents.at(-1);
    assert.strictEqual(requested?.type, "user-input.requested");
    if (requested?.type !== "user-input.requested") assert.fail("expected structured question");
    assert.deepStrictEqual(requested.payload.questions, [MOCK_QUESTION]);

    const completedFiber = yield* collectUntil(
      adapter,
      (event) => event.type === "turn.completed",
    ).pipe(Effect.forkChild);
    yield* adapter.respondToUserInput(
      threadId,
      ApprovalRequestId.make(String(requested.requestId)),
      { mock_direction: "Focused" },
    );
    const completedEvents = yield* Fiber.join(completedFiber);
    const reply = completedEvents
      .filter((event) => event.type === "content.delta")
      .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
      .join("");

    assert.match(reply, /Focused/);
    assert.strictEqual(completedEvents[0]?.type, "user-input.resolved");
    assert.strictEqual(completedEvents.at(-1)?.type, "turn.completed");
  }).pipe(Effect.scoped),
);

it.effect("emits grounding items before assistant text", () =>
  Effect.gen(function* () {
    const events = yield* runTurn("Use /ground for context");
    const firstDelta = events.findIndex((event) => event.type === "content.delta");
    const grounding = events.filter(
      (event) => event.type === "item.completed" && event.payload.itemType === "dynamic_tool_call",
    );

    assert.strictEqual(grounding.length, 2);
    assert.ok(events.indexOf(grounding[0]!) < firstDelta);
    assert.ok(events.indexOf(grounding[1]!) < firstDelta);
    assert.deepStrictEqual(
      grounding.map((event) => (event.type === "item.completed" ? event.payload.title : undefined)),
      ["Read", "Grep"],
    );
  }).pipe(Effect.scoped),
);

it.effect("emits a tool-shaped revision preview without an MCP call", () =>
  Effect.gen(function* () {
    const events = yield* runTurn("Please /revise the plan");
    const revision = events.find(
      (event) => event.type === "item.completed" && event.payload.itemType === "mcp_tool_call",
    );
    const reply = events
      .filter((event) => event.type === "content.delta")
      .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
      .join("");

    assert.strictEqual(revision?.type, "item.completed");
    if (revision?.type === "item.completed") {
      assert.strictEqual(revision.payload.status, "declined");
      assert.strictEqual(revision.payload.title, "propose_memory_amendment");
    }
    assert.match(reply, /Mock revision/);
  }).pipe(Effect.scoped),
);

it.effect("ignores trigger tokens in a rebuilt session's transcript preamble", () =>
  Effect.gen(function* () {
    const adapter = yield* makeMockAdapter({ interChunkDelay: Duration.zero });
    const threadId = ThreadId.make("mock-rebuilt-session-thread");
    yield* startSession(adapter, threadId);
    const eventsFiber = yield* collectUntil(
      adapter,
      (event) => event.type === "turn.completed" || event.type === "user-input.requested",
    ).pipe(Effect.forkChild);

    yield* adapter.sendTurn({
      threadId,
      input: [
        "Earlier transcript requested /question, /ground, and /revise.",
        "Reply to this message:\nVerbose streaming and stop probe",
      ].join("\n\n---\n\n"),
    });
    const events = yield* Fiber.join(eventsFiber);

    assert.strictEqual(events.at(-1)?.type, "turn.completed");
    assert.ok(!events.some((event) => event.type === "user-input.requested"));
    assert.ok(
      !events.some(
        (event) =>
          event.type === "item.completed" &&
          (event.payload.itemType === "dynamic_tool_call" ||
            event.payload.itemType === "mcp_tool_call"),
      ),
    );
  }).pipe(Effect.scoped),
);

it.effect("honors trigger tokens in a rebuilt session's final message", () =>
  Effect.gen(function* () {
    const events = yield* runTurn(
      "Earlier transcript without triggers.\n\n---\n\nReply to this message:\nUse /ground now",
    );
    const grounding = events.filter(
      (event) => event.type === "item.completed" && event.payload.itemType === "dynamic_tool_call",
    );

    assert.strictEqual(grounding.length, 2);
    assert.strictEqual(events.at(-1)?.type, "turn.completed");
  }).pipe(Effect.scoped),
);

it.effect("interrupts an active turn with turn.aborted", () =>
  Effect.gen(function* () {
    const adapter = yield* makeMockAdapter({ interChunkDelay: Duration.hours(1) });
    const threadId = ThreadId.make("mock-interrupt-thread");
    yield* startSession(adapter, threadId);
    const eventsFiber = yield* collectUntil(adapter, (event) => event.type === "turn.aborted").pipe(
      Effect.forkChild,
    );
    const started = yield* adapter.sendTurn({ threadId, input: "Draft a plan" });

    yield* adapter.interruptTurn(threadId, started.turnId);
    const events = yield* Fiber.join(eventsFiber);

    assert.strictEqual(events.at(-1)?.type, "turn.aborted");
    assert.ok(!events.some((event) => event.type === "turn.completed"));
  }).pipe(Effect.scoped),
);

it.effect("keeps concurrent session state independent", () =>
  Effect.gen(function* () {
    const adapter = yield* makeMockAdapter({ interChunkDelay: Duration.zero });
    const firstThread = ThreadId.make("mock-first-thread");
    const secondThread = ThreadId.make("mock-second-thread");
    yield* startSession(adapter, firstThread);
    yield* startSession(adapter, secondThread, "mock-verbose");
    const completedFiber = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.type === "turn.completed"),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild,
    );

    yield* Effect.all(
      [
        adapter.sendTurn({ threadId: firstThread, input: "First" }),
        adapter.sendTurn({ threadId: secondThread, input: "Second" }),
      ],
      { concurrency: "unbounded" },
    );
    yield* Fiber.join(completedFiber);

    const first = yield* adapter.readThread(firstThread);
    const second = yield* adapter.readThread(secondThread);
    assert.strictEqual(first.turns.length, 1);
    assert.strictEqual(second.turns.length, 1);
    assert.notStrictEqual(
      (first.turns[0]?.items[1] as { readonly text?: string } | undefined)?.text,
      (second.turns[0]?.items[1] as { readonly text?: string } | undefined)?.text,
    );
  }).pipe(Effect.scoped),
);

it.effect("emits byte-identical sequences for the same input", () =>
  Effect.gen(function* () {
    const first = yield* runTurn("Use /ground and /revise deterministically");
    const second = yield* runTurn("Use /ground and /revise deterministically");

    assert.strictEqual(encodeEvents(first), encodeEvents(second));
  }).pipe(Effect.scoped),
);
