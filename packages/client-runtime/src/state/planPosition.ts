import type { MercurianCommitId } from "@t3tools/contracts";

import type { PlanGraph } from "./planGraph.ts";

export type PlanPosition =
  | { readonly _tag: "latest" }
  | { readonly _tag: "at"; readonly commitId: MercurianCommitId; readonly live: boolean };

export const LATEST: PlanPosition = { _tag: "latest" };

export function resolveHead(graph: PlanGraph, position: PlanPosition): MercurianCommitId | null {
  if (position._tag === "latest") return graph.latest;
  return graph.byId.has(position.commitId) ? position.commitId : graph.latest;
}

export function resolveActingHead(
  graph: PlanGraph,
  viewedHead: MercurianCommitId | null,
): MercurianCommitId | null {
  if (viewedHead === null) return null;
  const node = graph.byId.get(viewedHead);
  if (node?.item._tag !== "coding-session") return viewedHead;
  return node.parents[0] ?? viewedHead;
}

export function positionAfterPick(graph: PlanGraph, commitId: MercurianCommitId): PlanPosition {
  const node = graph.byId.get(commitId);
  if (node === undefined) return LATEST;
  return { _tag: "at", commitId, live: node.childrenIds.length === 0 };
}

export function advance(graph: PlanGraph, position: PlanPosition): PlanPosition {
  if (position._tag === "latest" || !position.live) return position;
  let head = position.commitId;
  for (let step = 0; step < graph.nodes.length; step += 1) {
    const child = graph.byId.get(head)?.childrenIds[0];
    if (child === undefined) break;
    head = child;
  }
  return head === position.commitId ? position : { _tag: "at", commitId: head, live: true };
}

export function isViewingPast(graph: PlanGraph, position: PlanPosition): boolean {
  if (position._tag === "latest") return false;
  return !position.live && graph.byId.has(position.commitId);
}
