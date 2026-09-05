import type {
  MercurianCommitId,
  PlanSpecRevision,
  PlanTimelineItem,
} from "~/../../../packages/contracts/src/index";

import {
  ancestorClosure,
  descendantClosure,
  type PlanGraph,
} from "~/components/mercurian/PlanGraph.logic";

export function lastSpecRevision(
  timeline: ReadonlyArray<PlanTimelineItem>,
): PlanSpecRevision | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?._tag === "spec-revision") return item;
  }
  return null;
}

export function snapshotSpecIsForPath(
  timeline: ReadonlyArray<PlanTimelineItem>,
  pathTimeline: ReadonlyArray<PlanTimelineItem>,
): boolean {
  return lastSpecRevision(timeline)?.commitId === lastSpecRevision(pathTimeline)?.commitId;
}

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

/** Whether the newest spec on this path has not yet been followed by a plan revision. */
export function planMayBeStaleAt(graph: PlanGraph, commitId: MercurianCommitId): boolean {
  const ancestry = ancestorClosure(graph, commitId);
  const newestSpec = graph.nodes
    .toReversed()
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

export function specRevisionLabel(revision: PlanSpecRevision | null): string {
  if (revision === null) return "No spec revision yet";
  const who = revision.authorKind === "human" ? "You" : "Assistant";
  if (revision.cause === "import") return `Imported from ${revision.issueId ?? "issue"}`;
  if (revision.cause === "refresh") return `Refreshed from ${revision.issueId ?? "issue"}`;
  if (revision.cause === "reconciliation") {
    return `Reconciled with ${revision.issueId ?? "issue"}`;
  }
  return `${who} revised the spec`;
}

export function expectedSpecRevisionId(
  timeline: ReadonlyArray<PlanTimelineItem>,
): MercurianCommitId | null {
  return lastSpecRevision(timeline)?.commitId ?? null;
}
