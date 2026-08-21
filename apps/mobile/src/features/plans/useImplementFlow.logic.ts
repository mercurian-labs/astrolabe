import { PLAN_MAY_BE_STALE_DESCRIPTION } from "@t3tools/client-runtime/state/plan-freshness";
import type { PlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { resolveImplementFrom } from "@t3tools/client-runtime/state/plan-node-popover";
import {
  implementFlowAction,
  type ImplementFlowEvent,
} from "@t3tools/client-runtime/state/plan-splits";
import type { MercurianCommitId } from "@t3tools/contracts";

export const STALE_PLAN_WARNING_MESSAGE = `${PLAN_MAY_BE_STALE_DESCRIPTION} — the plan may be stale.`;

export function deriveImplementTransition(
  graph: PlanGraph,
  fromCommitId: MercurianCommitId | null,
  event: ImplementFlowEvent,
) {
  return {
    parentCommitId: resolveImplementFrom(graph, fromCommitId),
    action: implementFlowAction(event),
  } as const;
}

export function implementErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "The plan could not be checked for implementation.";
}
