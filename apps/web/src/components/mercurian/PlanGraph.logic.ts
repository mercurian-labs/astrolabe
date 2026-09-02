/**
 * The planning history as a graph, derived from the timeline the planning
 * space already holds.
 *
 * There is no second read behind this: `parents` and `published` ride on every
 * timeline item, so the DAG explorer is a second *rendering* of the plan
 * subscription rather than a second stream. Everything here is pure — the
 * shapes it has to handle (forks, n-ary merges) are representable long before
 * anything can create them, and that is exactly what the tests pin.
 */
import type { MercurianCommitId, PlanTimelineItem } from "@t3tools/contracts";
import { graphStratify, grid, sugiyama, zherebko } from "d3-dag";

export type PlanCheckpointEffect =
  | "plan-updated"
  | "spec-updated"
  | "interrupted"
  | "unanswered"
  | "partial"
  | "departed";

export interface PlanCheckpoint {
  readonly query: PlanTimelineItem;
  readonly revisions: ReadonlyArray<PlanTimelineItem>;
  readonly response?: PlanTimelineItem;
  readonly effects: ReadonlyArray<PlanCheckpointEffect>;
}

export interface PlanGraphNode {
  readonly commitId: MercurianCommitId;
  readonly item: PlanTimelineItem;
  /**
   * Ordered, and narrowed to parents the timeline actually carries. The wire
   * skips commit kinds this surface has no rendering for, so an edge can point
   * at nothing; dropping it degrades the drawing instead of throwing.
   */
  readonly parents: ReadonlyArray<MercurianCommitId>;
  /** In sequence order. More than one is a branch point. */
  readonly childrenIds: ReadonlyArray<MercurianCommitId>;
  readonly isBranchPoint: boolean;
  readonly isMerge: boolean;
  /** A settled assistant turn projected onto its continuable terminal commit. */
  readonly checkpoint?: PlanCheckpoint;
}

export interface PlanGraph {
  /** Every rendered history node, in the represented commits' append order. */
  readonly nodes: ReadonlyArray<PlanGraphNode>;
  readonly byId: ReadonlyMap<string, PlanGraphNode>;
  /** Commits with no parent left to hang from. One in a well-formed history. */
  readonly roots: ReadonlyArray<MercurianCommitId>;
  /** Where the history stands now — the highest sequence, or nothing at all. */
  readonly latest: MercurianCommitId | null;
}

const EMPTY_GRAPH: PlanGraph = { nodes: [], byId: new Map(), roots: [], latest: null };

export type PlanExplorerView = "thread" | "columns" | "graph";

/** Columns explain branch choices, so a linear history has nothing for them to show. */
export function hasFork(graph: PlanGraph): boolean {
  return graph.nodes.some((node) => node.isBranchPoint);
}

/** A stored columns preference becomes active again if this plan later grows a fork. */
export function effectivePlanExplorerView(
  graph: PlanGraph,
  storedView: PlanExplorerView,
  walkViewsEnabled: boolean,
): PlanExplorerView {
  if (!walkViewsEnabled) return "graph";
  return storedView === "columns" && !hasFork(graph) ? "thread" : storedView;
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
      if (existing === undefined) {
        childrenOf.set(parentId, [item.commitId]);
      } else {
        existing.push(item.commitId);
      }
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

/**
 * The path *through* a commit: itself and everything it descends from.
 *
 * This is what the planning surface shows while someone is looking back, and
 * it is a pure function of the graph — commits landing at the tip cannot
 * change it, because history above a commit is immutable.
 */
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
    for (const parentId of graph.byId.get(current)?.parents ?? []) {
      pending.push(parentId);
    }
  }
  return closure;
}

/** The commit itself and everything descended from it. */
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
    for (const childId of graph.byId.get(current)?.childrenIds ?? []) {
      pending.push(childId);
    }
  }
  return closure;
}

// ===============================
// The DAG map
// ===============================

const DAG_NODE_SIZE = [32, 32] as const;
const DAG_GAP = [64, 64] as const;

export interface SpatialPoint {
  readonly x: number;
  readonly y: number;
}

export interface SpatialNode extends SpatialPoint {
  readonly commitId: MercurianCommitId;
  readonly item: PlanTimelineItem;
  readonly isBranchPoint: boolean;
  readonly isMerge: boolean;
}

export interface SpatialEdge {
  readonly fromCommitId: MercurianCommitId;
  readonly toCommitId: MercurianCommitId;
  readonly points: ReadonlyArray<SpatialPoint>;
}

export interface SpatialLayout {
  readonly nodes: ReadonlyArray<SpatialNode>;
  readonly positions: ReadonlyMap<string, SpatialPoint>;
  readonly edges: ReadonlyArray<SpatialEdge>;
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
}

const EMPTY_SPATIAL_LAYOUT: SpatialLayout = {
  nodes: [],
  positions: new Map(),
  edges: [],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
};

export type DagLayoutName = "sugiyama" | "grid" | "zherebko";

export interface DagLayoutOptions {
  readonly layout: DagLayoutName;
}

/**
 * The DAG map: every commit a node, every parent edge drawn, the whole shape
 * at once. For seeing structure — the navigator is for walking it.
 *
 * Each engine is a finite, deterministic layout. Its native edge points come
 * through unchanged apart from the same axis orientation and rounding as the
 * nodes, so every polyline begins and ends exactly where its commits sit.
 */
export function dagLayout(graph: PlanGraph, options: DagLayoutOptions): SpatialLayout {
  if (graph.nodes.length === 0) return EMPTY_SPATIAL_LAYOUT;

  const dag = graphStratify()
    .id((node: PlanGraphNode) => node.commitId)
    .parentIds((node: PlanGraphNode) => node.parents)(graph.nodes);
  switch (options.layout) {
    case "sugiyama":
      sugiyama().nodeSize(DAG_NODE_SIZE).gap(DAG_GAP)(dag);
      break;
    case "grid":
      grid().nodeSize(DAG_NODE_SIZE).gap(DAG_GAP)(dag);
      break;
    case "zherebko":
      zherebko().nodeSize(DAG_NODE_SIZE).gap(DAG_GAP)(dag);
      break;
  }

  const dagNodes = [...dag.nodes()];
  const dagLinks = [...dag.links()];
  const orientation = orientations.find((orient) =>
    dagLinks.every((link) => orient(link.source).y < orient(link.target).y),
  );
  if (orientation === undefined) {
    throw new Error(`The ${options.layout} layout has no strictly downward flow axis.`);
  }

  const laidOutById = new Map(dagNodes.map((node) => [node.data.commitId as string, node]));

  const positions = new Map<string, SpatialPoint>();
  const nodes = graph.nodes.map((node): SpatialNode => {
    const laidOut = laidOutById.get(node.commitId);
    if (laidOut === undefined) throw new Error(`The layout dropped commit ${node.commitId}.`);
    const oriented = orientation(laidOut);
    const point = { x: round(oriented.x), y: round(oriented.y) };
    positions.set(node.commitId, point);
    return {
      commitId: node.commitId,
      item: node.item,
      isBranchPoint: node.isBranchPoint,
      isMerge: node.isMerge,
      ...point,
    };
  });

  const linksById = new Map(
    dagLinks.map((link) => [edgeKey(link.source.data.commitId, link.target.data.commitId), link]),
  );
  const edges = graph.nodes.flatMap((node) =>
    node.parents.flatMap((parentId): ReadonlyArray<SpatialEdge> => {
      const link = linksById.get(edgeKey(parentId, node.commitId));
      if (link === undefined) return [];
      return [
        {
          fromCommitId: parentId,
          toCommitId: node.commitId,
          points: link.points.map(([x, y]) => {
            const point = orientation({ x, y });
            return { x: round(point.x), y: round(point.y) };
          }),
        },
      ];
    }),
  );
  const extentPoints: ReadonlyArray<SpatialPoint> = [
    ...nodes,
    ...edges.flatMap((edge) => edge.points),
  ];

  return {
    nodes,
    positions,
    edges,
    bounds: {
      minX: Math.min(...extentPoints.map((point) => point.x)),
      minY: Math.min(...extentPoints.map((point) => point.y)),
      maxX: Math.max(...extentPoints.map((point) => point.x)),
      maxY: Math.max(...extentPoints.map((point) => point.y)),
    },
  };
}

type LayoutCoordinate = { readonly x: number; readonly y: number };
type Orientation = (point: LayoutCoordinate) => SpatialPoint;

const orientations: ReadonlyArray<Orientation> = [
  ({ x, y }) => ({ x, y }),
  ({ x, y }) => ({ x: y, y: x }),
  ({ x, y }) => ({ x, y: -y }),
  ({ x, y }) => ({ x: y, y: -x }),
];

const edgeKey = (from: MercurianCommitId, to: MercurianCommitId) => `${from}\0${to}`;

/** Positions are rendered and compared between finite layouts; keep them exact. */
const round = (value: number) => Math.round(value * 100) / 100;

const SUMMARY_MAX_LENGTH = 60;

/**
 * How a commit reads in one line of the explorer. A message says what it said;
 * a plan revision has no body to show, so it says what it did; an imported
 * issue reads as its title, which is what a person would call it.
 */
export function planCommitSummary(item: PlanTimelineItem): string {
  if (item._tag === "message" && item.memoryAmendment !== undefined) {
    return `You amended the memory: "${item.memoryAmendment.title}"`;
  }
  if (item._tag === "coding-session") {
    return `Coding session in ${item.repositoryName}`;
  }
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

/** The complete commit content shown when a map node is emphasized. */
export function planCommitDetail(item: PlanTimelineItem): string {
  if (item._tag === "message" && item.memoryAmendment === undefined) return item.text;
  return planCommitSummary(item);
}
