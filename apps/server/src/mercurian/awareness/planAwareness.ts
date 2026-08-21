import type { EnvironmentId, PlanId } from "@t3tools/contracts";
import { ThreadId } from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import * as DateTime from "effect/DateTime";

import type { PlanTurnStatus } from "../assistant/PlanningAssistant.ts";
import type { MercurianProject, Plan } from "../planning/schema.ts";

export function planAwarenessThreadId(planId: PlanId): ThreadId {
  return ThreadId.make(`mercurian:plan:${planId}`);
}

export function projectPlanAwareness(input: {
  readonly environmentId: EnvironmentId;
  readonly plan: Plan;
  readonly project: MercurianProject;
  readonly turnStatus: PlanTurnStatus | null;
  readonly modelTitle: string;
}): RelayAgentActivityState {
  const phase = input.turnStatus?.hasPendingInput
    ? "waiting_for_input"
    : input.turnStatus?.isWorking
      ? "running"
      : "completed";
  const headline =
    phase === "waiting_for_input"
      ? "Waiting for input"
      : phase === "running"
        ? "Assistant is working"
        : "Reply finished";
  const threadId = planAwarenessThreadId(input.plan.planId);

  return {
    environmentId: input.environmentId,
    threadId,
    projectTitle: input.project.name,
    threadTitle: input.plan.title,
    phase,
    headline,
    modelTitle: input.modelTitle,
    updatedAt: DateTime.formatIso(input.plan.updatedAt),
    deepLink: `/plans/${input.environmentId}/${input.plan.planId}`,
  };
}
