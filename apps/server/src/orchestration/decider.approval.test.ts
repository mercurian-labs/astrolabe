import {
  ApprovalRequestId,
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type ProviderApprovalDecision,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-08-19T12:00:00.000Z";

function makeReadModel(turnRunning: boolean): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: turnRunning
          ? {
              turnId: TurnId.make("turn-1"),
              state: "running",
              requestedAt: NOW,
              startedAt: NOW,
              completedAt: null,
              assistantMessageId: null,
            }
          : null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

const decideApproval = (decision: ProviderApprovalDecision, turnRunning: boolean) =>
  decideOrchestrationCommand({
    command: {
      type: "thread.approval.respond",
      commandId: CommandId.make(`cmd-${decision}-${turnRunning ? "running" : "idle"}`),
      threadId: ThreadId.make("thread-1"),
      requestId: ApprovalRequestId.make("request-1"),
      decision,
      createdAt: NOW,
    },
    readModel: makeReadModel(turnRunning),
  }).pipe(Effect.map((result) => (Array.isArray(result) ? result : [result])));

it.layer(NodeServices.layer)("approval response decider", (it) => {
  it.effect("denies before interrupting when cancel responds to a running turn", () =>
    Effect.gen(function* () {
      const events = yield* decideApproval("cancel", true);
      expect(events.map((event) => event.type)).toEqual([
        "thread.approval-response-requested",
        "thread.turn-interrupt-requested",
      ]);
      const interrupt = events[1];
      if (interrupt?.type === "thread.turn-interrupt-requested") {
        expect(interrupt.payload.turnId).toBe(TurnId.make("turn-1"));
      }
    }),
  );

  it.effect("does not interrupt when cancel responds without a running turn", () =>
    Effect.gen(function* () {
      const events = yield* decideApproval("cancel", false);
      expect(events.map((event) => event.type)).toEqual(["thread.approval-response-requested"]);
    }),
  );

  it.effect("never interrupts for continuing approval decisions", () =>
    Effect.gen(function* () {
      for (const decision of ["accept", "acceptForSession", "decline"] as const) {
        for (const turnRunning of [false, true]) {
          const events = yield* decideApproval(decision, turnRunning);
          expect(events.map((event) => event.type)).toEqual(["thread.approval-response-requested"]);
        }
      }
    }),
  );
});
