import type { MercurianCommitId } from "@t3tools/contracts";

import { ancestorClosure, descendantClosure, type PlanGraph } from "./planGraph.ts";

export const PLAN_MAY_BE_STALE_LABEL = "Plan may be stale";
export const PLAN_MAY_BE_STALE_DESCRIPTION = "The spec changed after the plan was last revised";

/** Raw branch leaves whose path has not absorbed the newest spec revision. */
export function staleSpecLeafIds(graph: PlanGraph): ReadonlySet<string> {
  const newest = [...graph.nodes].reverse().find((node) => node.item._tag === "spec-revision");
  if (newest === undefined) return new Set();
  const currentClosure = descendantClosure(graph, newest.commitId);
  const stale = new Set<string>();
  for (const leaf of graph.nodes.filter((node) => node.childrenIds.length === 0)) {
    if (currentClosure.has(leaf.commitId)) continue;
    const ancestry = ancestorClosure(graph, leaf.commitId);
    const nearest = [...graph.nodes]
      .reverse()
      .find((node) => ancestry.has(node.commitId) && node.item._tag === "spec-revision");
    if (nearest?.commitId !== newest.commitId) stale.add(leaf.commitId);
  }
  return stale;
}

export function planMayBeStaleAt(graph: PlanGraph, commitId: MercurianCommitId): boolean {
  const ancestry = ancestorClosure(graph, commitId);
  // .reverse() on a copy, not .toReversed(): Hermes doesn't ship the ES2023
  // change-by-copy array methods, and this module runs on mobile.
  const newestSpec = [...graph.nodes]
    .reverse()
    .find((node) => ancestry.has(node.commitId) && node.item._tag === "spec-revision");
  if (newestSpec === undefined) return false;
  const afterSpec = descendantClosure(graph, newestSpec.commitId);
  return !graph.nodes.some(
    (node) =>
      ancestry.has(node.commitId) &&
      afterSpec.has(node.commitId) &&
      node.item._tag === "plan-revision",
  );
}

/** Raw branch leaves whose current spec has no later plan revision on their path. */
export function stalePlanLeafIds(graph: PlanGraph): ReadonlySet<string> {
  return new Set(
    graph.nodes
      .filter((node) => node.childrenIds.length === 0 && planMayBeStaleAt(graph, node.commitId))
      .map((node) => node.commitId),
  );
}
