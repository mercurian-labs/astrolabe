/**
 * The planning history as a graph, derived from the timeline the planning
 * space already holds. Everything here is pure so web and mobile render the
 * same path, branch, and commit semantics.
 */
import type { MercurianCommitId, PlanTimelineItem } from "@t3tools/contracts";

export type PlanCheckpointEffect = "plan-updated" | "spec-updated" | "interrupted" | "unanswered";

export interface PlanCheckpoint {
  readonly query: PlanTimelineItem;
  readonly revisions: ReadonlyArray<PlanTimelineItem>;
  readonly response?: PlanTimelineItem;
  readonly effects: ReadonlyArray<PlanCheckpointEffect>;
}

export interface PlanGraphNode {
  readonly commitId: MercurianCommitId;
  readonly item: PlanTimelineItem;
  readonly parents: ReadonlyArray<MercurianCommitId>;
  readonly childrenIds: ReadonlyArray<MercurianCommitId>;
  readonly isBranchPoint: boolean;
  readonly isMerge: boolean;
  readonly checkpoint?: PlanCheckpoint;
}

export interface PlanGraph {
  readonly nodes: ReadonlyArray<PlanGraphNode>;
  readonly byId: ReadonlyMap<string, PlanGraphNode>;
  readonly roots: ReadonlyArray<MercurianCommitId>;
  readonly latest: MercurianCommitId | null;
}

const EMPTY_GRAPH: PlanGraph = { nodes: [], byId: new Map(), roots: [], latest: null };

export function hasFork(graph: PlanGraph): boolean {
  return graph.nodes.some((node) => node.isBranchPoint);
}

export function buildPlanGraph(timeline: ReadonlyArray<PlanTimelineItem>): PlanGraph {
  if (timeline.length === 0) return EMPTY_GRAPH;

  const ordered = [...timeline].sort((left, right) => left.sequence - right.sequence);
  const present = new Set(ordered.map((item) => item.commitId as string));
  const childrenOf = new Map<string, Array<MercurianCommitId>>();
  for (const item of ordered) {
    for (const parentId of item.parents) {
      if (!present.has(parentId)) continue;
      const existing = childrenOf.get(parentId);
      if (existing === undefined) childrenOf.set(parentId, [item.commitId]);
      else existing.push(item.commitId);
    }
  }

  const nodes = ordered.map((item): PlanGraphNode => {
    const parents = item.parents.filter((parentId) => present.has(parentId));
    const childrenIds = childrenOf.get(item.commitId) ?? [];
    return {
      commitId: item.commitId,
      item,
      parents,
      childrenIds,
      isBranchPoint: childrenIds.length > 1,
      isMerge: parents.length > 1,
    };
  });

  return {
    nodes,
    byId: new Map(nodes.map((node) => [node.commitId as string, node])),
    roots: nodes.filter((node) => node.parents.length === 0).map((node) => node.commitId),
    latest: nodes.at(-1)?.commitId ?? null,
  };
}

export function ancestorClosure(
  graph: PlanGraph,
  commitId: MercurianCommitId,
): ReadonlySet<string> {
  const closure = new Set<string>();
  if (!graph.byId.has(commitId)) return closure;
  const pending: Array<string> = [commitId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || closure.has(current)) continue;
    closure.add(current);
    for (const parentId of graph.byId.get(current)?.parents ?? []) pending.push(parentId);
  }
  return closure;
}

export function descendantClosure(
  graph: PlanGraph,
  commitId: MercurianCommitId,
): ReadonlySet<string> {
  const closure = new Set<string>();
  if (!graph.byId.has(commitId)) return closure;
  const pending: Array<string> = [commitId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || closure.has(current)) continue;
    closure.add(current);
    for (const childId of graph.byId.get(current)?.childrenIds ?? []) pending.push(childId);
  }
  return closure;
}

const SUMMARY_MAX_LENGTH = 60;

export function planCommitSummary(item: PlanTimelineItem): string {
  if (item._tag === "coding-session") return `Coding session in ${item.repositoryName}`;
  if (item._tag === "plan-revision") {
    if (item.split !== undefined) return `Plan for ${item.split.repositoryName}`;
    return item.authorKind === "human" ? "You edited the plan" : "The assistant revised the plan";
  }
  if (item._tag === "spec-revision") {
    if (item.cause === "import")
      return `Spec imported${item.issueId === undefined ? "" : ` from ${item.issueId}`}`;
    if (item.cause === "refresh")
      return `Spec refreshed${item.issueId === undefined ? "" : ` from ${item.issueId}`}`;
    if (item.cause === "reconciliation") return "Spec reconciled with upstream";
    return item.authorKind === "human" ? "You revised the spec" : "The assistant revised the spec";
  }
  const firstLine = item.text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return "Empty message";
  return firstLine.length <= SUMMARY_MAX_LENGTH
    ? firstLine
    : `${firstLine.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

export function planCommitDetail(item: PlanTimelineItem): string {
  return item._tag === "message" ? item.text : planCommitSummary(item);
}
