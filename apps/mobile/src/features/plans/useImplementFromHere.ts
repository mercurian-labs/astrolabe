import { resolveImplementFrom } from "@t3tools/client-runtime/state/plan-node-popover";
import type { PlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import type { MercurianCommitId, PlanId } from "@t3tools/contracts";
import { useCallback } from "react";

const IMPLEMENT_UNAVAILABLE_REASON =
  "Implementing from a checkpoint arrives with the implement flow.";

/** Stable seam for M-150; this issue deliberately exposes no implement mutation. */
export function useImplementFromHere(_planId: PlanId) {
  return useCallback(
    (graph: PlanGraph, fromCommitId: MercurianCommitId) =>
      implementFromHereUnavailable(graph, fromCommitId),
    [],
  );
}

export function implementFromHereUnavailable(graph: PlanGraph, fromCommitId: MercurianCommitId) {
  return {
    status: "unavailable" as const,
    reason: IMPLEMENT_UNAVAILABLE_REASON,
    parentCommitId: resolveImplementFrom(graph, fromCommitId),
  };
}
