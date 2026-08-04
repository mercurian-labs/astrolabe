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
}

export interface PlanGraph {
  /** Every commit, in the store's append order. */
  readonly nodes: ReadonlyArray<PlanGraphNode>;
  readonly byId: ReadonlyMap<string, PlanGraphNode>;
  /** Commits with no parent left to hang from. One in a well-formed history. */
  readonly roots: ReadonlyArray<MercurianCommitId>;
  /** Where the history stands now — the highest sequence, or nothing at all. */
  readonly latest: MercurianCommitId | null;
}

const EMPTY_GRAPH: PlanGraph = { nodes: [], byId: new Map(), roots: [], latest: null };

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

export interface NavigatorRow {
  /** Stable per occurrence: a reference row shares a commit, not a key. */
  readonly rowId: string;
  readonly commitId: MercurianCommitId;
  readonly item: PlanTimelineItem;
  /** Indent level. It grows at a fork and nowhere else. */
  readonly depth: number;
  /**
   * A merge shown under a parent that is not its first: a marked pointer at
   * the real node, which lives under the first parent.
   */
  readonly isReference: boolean;
  readonly isBranchPoint: boolean;
  readonly isMerge: boolean;
}

/**
 * The tree-style linearization: depth-first from the root, children in the
 * order they landed.
 *
 * A merge belongs under every parent, and only one of those places can be the
 * node itself — so it appears once as the real row (under its first parent)
 * and once per further parent as a reference that jumps there. Anything below
 * a merge hangs off the real row only, which is what keeps the walk finite.
 */
export function navigatorRows(graph: PlanGraph): ReadonlyArray<NavigatorRow> {
  const rows: Array<NavigatorRow> = [];
  // An explicit stack, not recursion: a long linear plan is a long chain, and
  // the call stack is not the place to find that out.
  const stack: Array<{ commitId: MercurianCommitId; depth: number; via: string | null }> =
    graph.roots.toReversed().map((commitId) => ({ commitId, depth: 0, via: null }));

  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) continue;
    const node = graph.byId.get(entry.commitId);
    if (node === undefined) continue;

    const isReference =
      entry.via !== null && node.parents.length > 1 && entry.via !== node.parents[0];
    rows.push({
      rowId: isReference ? `${node.commitId}@${entry.via}` : node.commitId,
      commitId: node.commitId,
      item: node.item,
      depth: entry.depth,
      isReference,
      isBranchPoint: node.isBranchPoint,
      isMerge: node.isMerge,
    });
    if (isReference) continue;

    const childDepth = entry.depth + (node.isBranchPoint ? 1 : 0);
    for (const childId of node.childrenIds.toReversed()) {
      stack.push({ commitId: childId, depth: childDepth, via: node.commitId });
    }
  }

  return rows;
}

export interface PlanGraphRow {
  readonly commitId: MercurianCommitId;
  readonly item: PlanTimelineItem;
  readonly row: number;
  readonly lane: number;
  readonly isBranchPoint: boolean;
  readonly isMerge: boolean;
}

export interface PlanGraphEdge {
  readonly fromCommitId: MercurianCommitId;
  readonly toCommitId: MercurianCommitId;
  readonly fromRow: number;
  readonly fromLane: number;
  readonly toRow: number;
  readonly toLane: number;
}

export interface PlanGraphLayout {
  readonly rows: ReadonlyArray<PlanGraphRow>;
  readonly edges: ReadonlyArray<PlanGraphEdge>;
  readonly laneCount: number;
}

const EMPTY_LAYOUT: PlanGraphLayout = { rows: [], edges: [], laneCount: 0 };

/**
 * The git-graph view: one row per commit in append order, each on a lane, with
 * the edges between them.
 *
 * Lanes are reservations. A commit takes the lane its parent left for it; a
 * fork's later children each open a new one; a merge takes the leftmost lane
 * reserved for it and closes the rest. Unlike the navigator, a merge is drawn
 * once — the lanes converging on its row are what say it reunified.
 */
export function graphLayout(graph: PlanGraph): PlanGraphLayout {
  if (graph.nodes.length === 0) return EMPTY_LAYOUT;

  const lanes: Array<MercurianCommitId | null> = [];
  const placed = new Map<string, { row: number; lane: number }>();
  const rows: Array<PlanGraphRow> = [];

  const takeFreeLane = () => {
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const [row, node] of graph.nodes.entries()) {
    const reserved = lanes.flatMap((holder, lane) => (holder === node.commitId ? [lane] : []));
    const lane = reserved[0] ?? takeFreeLane();
    // Everything a merge converged from stops here.
    for (const closing of reserved.slice(1)) lanes[closing] = null;
    lanes[lane] = null;

    placed.set(node.commitId, { row, lane });
    rows.push({
      commitId: node.commitId,
      item: node.item,
      row,
      lane,
      isBranchPoint: node.isBranchPoint,
      isMerge: node.isMerge,
    });

    const [firstChild, ...otherChildren] = node.childrenIds;
    if (firstChild !== undefined) {
      // The first child continues this line; siblings open lines of their own.
      lanes[lane] = firstChild;
      for (const childId of otherChildren) lanes[takeFreeLane()] = childId;
    }
  }

  const edges = graph.nodes.flatMap((node) =>
    node.parents.flatMap((parentId): ReadonlyArray<PlanGraphEdge> => {
      const from = placed.get(parentId);
      const to = placed.get(node.commitId);
      if (from === undefined || to === undefined) return [];
      return [
        {
          fromCommitId: parentId,
          toCommitId: node.commitId,
          fromRow: from.row,
          fromLane: from.lane,
          toRow: to.row,
          toLane: to.lane,
        },
      ];
    }),
  );

  return { rows, edges, laneCount: Math.max(...rows.map((entry) => entry.lane)) + 1 };
}

const SUMMARY_MAX_LENGTH = 60;

/**
 * How a commit reads in one line of the explorer. A message says what it said;
 * a revision has no body to show, so it says what it did.
 */
export function planCommitSummary(item: PlanTimelineItem): string {
  if (item._tag === "plan-revision") {
    return item.authorKind === "human" ? "You edited the plan" : "The assistant revised the plan";
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
