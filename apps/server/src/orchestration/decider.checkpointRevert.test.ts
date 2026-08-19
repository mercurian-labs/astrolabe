import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { decideOrchestrationCommand } from "./decider.ts";

const now = "2026-08-19T12:00:00.000Z";
const threadId = ThreadId.make("thread-checkpoint-revert");

function readModelWithTurnState(
  state: "running" | "interrupted" | "completed" | null,
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project-checkpoint-revert"),
        title: "Checkpoint revert",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "feature/checkpoint-revert",
        worktreePath: "/tmp/checkpoint-revert",
        latestTurn:
          state === null
            ? null
            : {
                turnId: TurnId.make("turn-checkpoint-revert"),
                state,
                requestedAt: now,
                startedAt: now,
                completedAt: state === "running" ? null : now,
                assistantMessageId: null,
              },
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        titleRegeneration: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: now,
  };
}

const command = {
  type: "thread.checkpoint.revert",
  commandId: CommandId.make("command-checkpoint-revert"),
  threadId,
  turnCount: 1,
  createdAt: now,
} as const;

it.layer(NodeServices.layer)("checkpoint revert decider", (it) => {
  it.effect("refuses revert while the latest turn is running and emits no event", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        decideOrchestrationCommand({ command, readModel: readModelWithTurnState("running") }),
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const error = yield* Effect.flip(
          decideOrchestrationCommand({ command, readModel: readModelWithTurnState("running") }),
        );
        expect(error).toBeInstanceOf(OrchestrationCommandInvariantError);
        expect(error.message).toContain("Interrupt the running turn before reverting checkpoints.");
      }
    }),
  );

  it.effect("keeps the checkpoint request unchanged for idle and interrupted threads", () =>
    Effect.gen(function* () {
      for (const state of [null, "interrupted"] as const) {
        const result = yield* decideOrchestrationCommand({
          command,
          readModel: readModelWithTurnState(state),
        });
        const event = Array.isArray(result) ? result[0] : result;
        expect(event.type).toBe("thread.checkpoint-revert-requested");
        if (event.type === "thread.checkpoint-revert-requested") {
          expect(event.payload).toEqual({ threadId, turnCount: 1, createdAt: now });
        }
      }
    }),
  );
});
