import { assert, it } from "@effect/vitest";
import { ApprovalRequestId, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  ApprovalAutoResponder,
  ApprovalAutoResponderDefault,
  type ApprovalOpenedEvent,
} from "../../orchestration/Services/ApprovalAutoResponder.ts";
import * as LineRuntimeStore from "../lineRuntimes/LineRuntimeStore.ts";
import { MercurianApprovalAutoResponderLive } from "./MercurianApprovalAutoResponder.ts";

const lineThreadId = ThreadId.make("line-thread");
const upstreamThreadId = ThreadId.make("upstream-thread");
const request = (threadId: ThreadId, requestType: string, args?: unknown): ApprovalOpenedEvent =>
  ({
    type: "request.opened",
    eventId: "event",
    provider: ProviderDriverKind.make("codex"),
    createdAt: "2026-09-03T12:00:00.000Z",
    threadId,
    requestId: ApprovalRequestId.make("request"),
    payload: { requestType, detail: "request", ...(args === undefined ? {} : { args }) },
  }) as unknown as ApprovalOpenedEvent;

it.effect("defaults to leaving every approval untouched", () =>
  Effect.gen(function* () {
    const responder = yield* ApprovalAutoResponder;
    assert.ok(
      Option.isNone(
        yield* responder.decide({
          threadId: lineThreadId,
          request: request(lineThreadId, "file_read_approval"),
        }),
      ),
    );
  }).pipe(Effect.provide(ApprovalAutoResponderDefault)),
);

it.effect(
  "auto-accepts line reads and planning tools but surfaces commands and upstream requests",
  () => {
    const lineRuntimeStore = Layer.mock(LineRuntimeStore.LineRuntimeStore)({
      getByThreadId: (threadId) =>
        Effect.succeed(threadId === lineThreadId ? Option.some({} as never) : Option.none()),
    });
    return Effect.gen(function* () {
      const responder = yield* ApprovalAutoResponder;
      const decide = (threadId: ThreadId, opened: ApprovalOpenedEvent) =>
        responder.decide({ threadId, request: opened });
      assert.deepStrictEqual(
        yield* decide(lineThreadId, request(lineThreadId, "file_read_approval")),
        Option.some("acceptForSession"),
      );
      assert.deepStrictEqual(
        yield* decide(
          lineThreadId,
          request(lineThreadId, "dynamic_tool_call", {
            toolName: "mcp__t3-code__propose_memory_amendment",
          }),
        ),
        Option.some("acceptForSession"),
      );
      assert.ok(
        Option.isNone(
          yield* decide(lineThreadId, request(lineThreadId, "command_execution_approval")),
        ),
      );
      assert.ok(
        Option.isNone(
          yield* decide(upstreamThreadId, request(upstreamThreadId, "file_read_approval")),
        ),
      );
    }).pipe(Effect.provide(Layer.provide(MercurianApprovalAutoResponderLive, lineRuntimeStore)));
  },
);
