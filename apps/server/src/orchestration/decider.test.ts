import { expect, it } from "@effect/vitest";
import { OrchestrationCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

it.effect("does not decode the removed checkpoint revert command", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      Schema.decodeUnknownEffect(OrchestrationCommand)({
        type: "thread.checkpoint.revert",
        commandId: "removed-revert-command",
        threadId: "thread-one",
        turnCount: 1,
        createdAt: "2026-08-31T12:00:00.000Z",
      }),
    );
    expect(exit._tag).toBe("Failure");
  }),
);
