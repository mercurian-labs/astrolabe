import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  TurnId,
  ThreadId,
  type ProviderRuntimeEvent,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ReconstructionSummary, layer, SUMMARY_MAX_CHARS } from "./ReconstructionSummary.ts";

const modelSelection = { instanceId: ProviderInstanceId.make("test"), model: "model" };
const harness = Effect.fn("summaryTest.harness")(function* (
  output: string,
  state: "completed" | "interrupted" = "completed",
  block: boolean | "action" = false,
  itemType?: Extract<ProviderRuntimeEvent, { type: "item.started" }>["payload"]["itemType"],
) {
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const started = yield* Deferred.make<void>();
  const starts: ProviderSessionStartInput[] = [];
  const prompts: string[] = [];
  let stopped = 0;
  const dependencies = Layer.mock(ProviderService)({
    streamEvents: Stream.fromPubSub(events),
    subscribeEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
    startEphemeralSession: (input) =>
      Effect.gen(function* () {
        const threadId = ThreadId.make(`helper-${starts.length}`);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            stopped++;
          }),
        );
        return yield* Effect.sync(() => {
          starts.push({ ...input, threadId });
          return {
            provider: ProviderDriverKind.make("codex"),
            threadId,
            status: "ready" as const,
            runtimeMode: "approval-required" as const,
            createdAt: "2026-09-05T00:00:00.000Z",
            updatedAt: "2026-09-05T00:00:00.000Z",
          };
        });
      }),
    sendTurn: (input) =>
      Effect.gen(function* () {
        prompts.push(input.input ?? "");
        yield* Deferred.succeed(started, undefined);
        const base = {
          threadId: input.threadId,
          turnId: TurnId.make("turn"),
          provider: ProviderDriverKind.make("codex"),
          eventId: EventId.make("event"),
          createdAt: "2026-09-05T00:00:00.000Z",
        };
        if (itemType !== undefined)
          yield* PubSub.publish(events, { ...base, type: "item.started", payload: { itemType } });
        if (block) {
          if (block === "action")
            yield* PubSub.publish(events, {
              ...base,
              type: "item.started",
              payload: { itemType: "command_execution" },
            });
          return yield* Effect.never;
        }
        yield* PubSub.publish(events, {
          ...base,
          turnId: TurnId.make("unrelated"),
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Not this turn" },
        });
        yield* PubSub.publish(events, {
          ...base,
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: output },
        });
        yield* PubSub.publish(events, { ...base, type: "turn.completed", payload: { state } });
        return { threadId: input.threadId, turnId: base.turnId };
      }),
    stopSession: () =>
      Effect.sync(() => {
        stopped++;
      }),
  });
  return {
    starts,
    prompts,
    started,
    stopped: () => stopped,
    layer: layer.pipe(Layer.provide(dependencies), Layer.provide(NodeServices.layer)),
  };
});

it.effect("captures the exact completed rendition and closes the isolated helper", () =>
  Effect.gen(function* () {
    const h = yield* harness("\n Faithful rendition. \n");
    const summary = yield* Effect.gen(function* () {
      return yield* (yield* ReconstructionSummary).summarize("old conversation", modelSelection);
    }).pipe(Effect.provide(h.layer));
    assert.strictEqual(summary, "\n Faithful rendition. \n");
    assert.strictEqual(h.stopped(), 1);
    assert.strictEqual(h.starts[0]?.sandboxMode, "read-only");
    assert.strictEqual(h.starts[0]?.approvalPolicy, "never");
    assert.strictEqual(h.starts[0]?.isolateProviderSettings, true);
    assert.ok(h.starts[0]?.cwd?.includes("t3-reconstruction-"));
    assert.strictEqual(h.starts[0]?.additionalDirectories, undefined);
  }),
);

it.effect("reduces bounded chunks without silently dropping the prefix", () =>
  Effect.gen(function* () {
    const h = yield* harness("chunk rendition");
    yield* Effect.gen(function* () {
      yield* (yield* ReconstructionSummary).summarize("x".repeat(100_000), modelSelection);
    }).pipe(Effect.provide(h.layer));
    assert.strictEqual(h.prompts.length, 4);
    assert.ok(h.prompts[3]?.includes("chunk rendition\n\nchunk rendition\n\nchunk rendition"));
    assert.strictEqual(h.stopped(), 4);
  }),
);

for (const [label, output, state] of [
  ["empty", "  ", "completed"],
  ["oversized", "x".repeat(SUMMARY_MAX_CHARS + 1), "completed"],
  ["interrupted", "partial", "interrupted"],
] as const) {
  it.effect(`refuses ${label} summaries`, () =>
    Effect.gen(function* () {
      const h = yield* harness(output, state);
      const result = yield* Effect.gen(function* () {
        return yield* Effect.result(
          (yield* ReconstructionSummary).summarize("history", modelSelection),
        );
      }).pipe(Effect.provide(h.layer));
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(h.stopped(), 1);
    }),
  );
}

it.effect("cancellation closes a helper even while its send is pending", () =>
  Effect.gen(function* () {
    const h = yield* harness("", "completed", true);
    const fiber = yield* Effect.gen(function* () {
      yield* (yield* ReconstructionSummary).summarize("history", modelSelection);
    }).pipe(Effect.provide(h.layer), Effect.forkScoped);
    yield* Deferred.await(h.started);
    yield* Fiber.interrupt(fiber);
    assert.strictEqual(h.stopped(), 1);
  }).pipe(Effect.scoped),
);

it.effect("refuses actions while a helper's send is still pending", () =>
  Effect.gen(function* () {
    const h = yield* harness("", "completed", "action");
    const result = yield* Effect.gen(function* () {
      return yield* Effect.result(
        (yield* ReconstructionSummary).summarize("history", modelSelection),
      );
    }).pipe(Effect.provide(h.layer));
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure")
      assert.strictEqual(
        result.failure.message,
        "Reconstruction summary requested an action instead of summarizing.",
      );
    assert.strictEqual(h.stopped(), 1);
  }),
);

for (const itemType of [
  "plan",
  "context_compaction",
  "reasoning",
  "review_entered",
  "review_exited",
] as const) {
  it.effect(`accepts benign ${itemType} items`, () =>
    Effect.gen(function* () {
      const h = yield* harness("Faithful summary", "completed", false, itemType);
      const summary = yield* Effect.flatMap(ReconstructionSummary, (service) =>
        service.summarize("history", modelSelection),
      ).pipe(Effect.provide(h.layer));
      assert.strictEqual(summary, "Faithful summary");
      assert.strictEqual(h.stopped(), 1);
    }),
  );
}
for (const itemType of [
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "dynamic_tool_call",
  "collab_agent_tool_call",
  "web_search",
  "image_view",
] as const) {
  it.effect(`fails on ${itemType} even if the helper subsequently completes`, () =>
    Effect.gen(function* () {
      const h = yield* harness("Untrusted summary", "completed", false, itemType);
      const result = yield* Effect.flatMap(ReconstructionSummary, (service) =>
        service.summarize("history", modelSelection),
      ).pipe(Effect.result, Effect.provide(h.layer));
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure")
        assert.strictEqual(
          result.failure.message,
          "Reconstruction summary requested an action instead of summarizing.",
        );
      assert.strictEqual(h.stopped(), 1);
    }),
  );
}
