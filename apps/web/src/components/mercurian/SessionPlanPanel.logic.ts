import type { MercurianCommitId } from "@t3tools/contracts";

import type { PlanGraph } from "./PlanGraph.logic";
import { planMovedPastSplit } from "./PlanNodePopover.logic";

export interface SessionPlanReading {
  readonly planRevisionCommitId: MercurianCommitId;
  readonly baseCommitId: MercurianCommitId | null;
  readonly movedPast: boolean;
  readonly movedPastRepositoryName: string | null;
}

export function sessionPlanReading(
  graph: PlanGraph,
  leafCommitId: MercurianCommitId,
): SessionPlanReading | null {
  const leaf = graph.byId.get(leafCommitId);
  if (leaf?.item._tag !== "coding-session") return null;

  const planRevisionCommitId = leaf.item.planRevisionCommitId;
  const baseCommitId = leaf.item.parents[0] ?? null;
  const baseMovedPast =
    baseCommitId !== null &&
    (graph.byId.get(baseCommitId)?.childrenIds.some((childId) => {
      if (childId === leafCommitId) return false;
      const child = graph.byId.get(childId)?.item;
      if (child?._tag === "coding-session") return false;
      return child?._tag !== "plan-revision" || child.split === undefined;
    }) ??
      false);
  const implementedRevision = graph.byId.get(planRevisionCommitId)?.item;
  const movedPastRepositoryName =
    implementedRevision?._tag === "plan-revision"
      ? (implementedRevision.split?.repositoryName ?? null)
      : null;
  const splitMovedPast =
    movedPastRepositoryName !== null && planMovedPastSplit(graph, planRevisionCommitId);

  return {
    planRevisionCommitId,
    baseCommitId,
    movedPast: baseMovedPast || splitMovedPast,
    movedPastRepositoryName,
  };
}
