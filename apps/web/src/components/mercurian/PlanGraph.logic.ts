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

// ===============================
// The spatial map
// ===============================

/**
 * Beyond this many commits the simulation is skipped for the plain time-axis
 * arrangement. n² repulsion is fine at human scale and this is where it stops
 * being human scale — the map degrades to a legible column, not to a stall.
 */
export const SPATIAL_MAX_SIMULATED_NODES = 300;
/** How far apart the flow axis wants successive generations. */
const SPATIAL_FLOW_SPACING = 96;
/** The strict parent→child gap along the flow axis, enforced after the sim. */
const SPATIAL_MIN_FLOW_GAP = 48;
/** No two nodes end up closer than this. Enforced, not hoped for. */
export const SPATIAL_MIN_SEPARATION = 56;
const SPATIAL_SEED_SPREAD = 220;
const SPATIAL_COLD_TICKS = 260;
/** A warm re-solve is a nudge, not a re-layout: the map has to stay put. */
const SPATIAL_WARM_TICKS = 20;
const SPATIAL_SPRING_LENGTH = 96;
const SPATIAL_SPRING_K = 0.06;
const SPATIAL_REPULSION = 9000;
const SPATIAL_FLOW_K = 0.08;
const SPATIAL_DAMPING = 0.82;
const SPATIAL_MAX_STEP = 24;
const SPATIAL_SEPARATION_PASSES = 32;

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
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
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
  /** `false` when the history outgrew the cap and fell back to the time axis. */
  readonly simulated: boolean;
}

const EMPTY_SPATIAL_LAYOUT: SpatialLayout = {
  nodes: [],
  positions: new Map(),
  edges: [],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  simulated: false,
};

/**
 * A commit id's own arbitrary-but-fixed number. FNV-1a, because the seed has to
 * be a pure function of the id: the same history must draw the same picture in
 * every window, on every open, forever. `Math.random` would make this view a
 * different one each time you looked at it.
 */
function seedOf(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The seed as a signed unit offset, for spreading nodes without randomness. */
const seededOffset = (value: string, salt: number) =>
  (seedOf(`${salt}:${value}`) % 20001) / 10000 - 1;

/**
 * The spatial map: every commit a node, every parent edge drawn, the whole
 * shape at once. For seeing structure — the navigator is for walking it.
 *
 * Deterministic by construction. Positions are seeded from commit ids and the
 * simulation runs synchronously to a fixed tick budget, so this is a pure
 * function of `(graph, prior)` that tests like any other: same timeline, same
 * picture, every window.
 *
 * Three forces shape it — springs along parent edges, pairwise repulsion, and
 * a weak directional field pulling each commit down its generation. That third
 * one is what a DAG needs and a plain note-graph lacks: it keeps root→tips
 * reading as flow rather than as a hairball, while springs and repulsion still
 * let branches splay sideways.
 *
 * Pass `prior` when the timeline has grown: new nodes start at their first
 * parent and the solve re-runs warm on a small budget, so the map drifts
 * locally instead of rearranging itself under someone who was reading it.
 */
export function spatialLayout(
  graph: PlanGraph,
  prior?: ReadonlyMap<string, SpatialPoint>,
): SpatialLayout {
  if (graph.nodes.length === 0) return EMPTY_SPATIAL_LAYOUT;

  const count = graph.nodes.length;
  const indexOf = new Map<string, number>(graph.nodes.map((node, index) => [node.commitId, index]));

  // Generation along the flow axis: one past the deepest parent. Parents always
  // precede their children in append order, so one pass suffices.
  const generation = new Float64Array(count);
  for (const [index, node] of graph.nodes.entries()) {
    let deepest = -1;
    for (const parentId of node.parents) {
      const parentIndex = indexOf.get(parentId);
      if (parentIndex !== undefined) deepest = Math.max(deepest, generation[parentIndex]!);
    }
    generation[index] = deepest + 1;
  }

  // Typed arrays throughout the solve: the arithmetic reads as arithmetic.
  const x = new Float64Array(count);
  const y = new Float64Array(count);

  for (const [index, node] of graph.nodes.entries()) {
    const held = prior?.get(node.commitId);
    if (held !== undefined) {
      x[index] = held.x;
      y[index] = held.y;
      continue;
    }
    const firstParent = prior === undefined ? undefined : node.parents[0];
    const anchor = firstParent === undefined ? undefined : prior?.get(firstParent);
    if (anchor !== undefined) {
      // A commit that just landed belongs beside the one it came from, not
      // wherever a fresh solve would have put it.
      x[index] = anchor.x + seededOffset(node.commitId, 1) * SPATIAL_MIN_SEPARATION;
      y[index] = anchor.y + SPATIAL_FLOW_SPACING;
      continue;
    }
    x[index] = seededOffset(node.commitId, 0) * SPATIAL_SEED_SPREAD;
    y[index] = generation[index]! * SPATIAL_FLOW_SPACING;
  }

  const simulated = count <= SPATIAL_MAX_SIMULATED_NODES;
  if (simulated) {
    const velocityX = new Float64Array(count);
    const velocityY = new Float64Array(count);
    const forceX = new Float64Array(count);
    const forceY = new Float64Array(count);
    const ticks = prior === undefined ? SPATIAL_COLD_TICKS : SPATIAL_WARM_TICKS;

    for (let tick = 0; tick < ticks; tick += 1) {
      forceX.fill(0);
      forceY.fill(0);

      for (let a = 0; a < count; a += 1) {
        for (let b = a + 1; b < count; b += 1) {
          const dx = x[a]! - x[b]!;
          const dy = y[a]! - y[b]!;
          const distanceSquared = Math.max(dx * dx + dy * dy, 1);
          const distance = Math.sqrt(distanceSquared);
          const push = SPATIAL_REPULSION / distanceSquared;
          forceX[a] = forceX[a]! + (dx / distance) * push;
          forceY[a] = forceY[a]! + (dy / distance) * push;
          forceX[b] = forceX[b]! - (dx / distance) * push;
          forceY[b] = forceY[b]! - (dy / distance) * push;
        }
      }

      for (const [index, node] of graph.nodes.entries()) {
        for (const parentId of node.parents) {
          const parentIndex = indexOf.get(parentId);
          if (parentIndex === undefined) continue;
          const dx = x[index]! - x[parentIndex]!;
          const dy = y[index]! - y[parentIndex]!;
          const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
          const pull = SPATIAL_SPRING_K * (distance - SPATIAL_SPRING_LENGTH);
          forceX[index] = forceX[index]! - (dx / distance) * pull;
          forceY[index] = forceY[index]! - (dy / distance) * pull;
          forceX[parentIndex] = forceX[parentIndex]! + (dx / distance) * pull;
          forceY[parentIndex] = forceY[parentIndex]! + (dy / distance) * pull;
        }
        forceY[index] =
          forceY[index]! + SPATIAL_FLOW_K * (generation[index]! * SPATIAL_FLOW_SPACING - y[index]!);
      }

      for (let index = 0; index < count; index += 1) {
        velocityX[index] = (velocityX[index]! + forceX[index]!) * SPATIAL_DAMPING;
        velocityY[index] = (velocityY[index]! + forceY[index]!) * SPATIAL_DAMPING;
        x[index] = x[index]! + clampStep(velocityX[index]!);
        y[index] = y[index]! + clampStep(velocityY[index]!);
      }
    }
  }

  // Flow, made true rather than merely encouraged: a child always sits beyond
  // every parent. A soft force gets this right most of the time, and "most of
  // the time" is how a graph view starts lying about which way time runs.
  for (const [index, node] of graph.nodes.entries()) {
    for (const parentId of node.parents) {
      const parentIndex = indexOf.get(parentId);
      if (parentIndex === undefined) continue;
      y[index] = Math.max(y[index]!, y[parentIndex]! + SPATIAL_MIN_FLOW_GAP);
    }
  }

  // Separation, likewise. Pushing only along the cross axis keeps the flow
  // ordering above intact — the two passes cannot fight.
  for (let pass = 0; pass < SPATIAL_SEPARATION_PASSES; pass += 1) {
    let settled = true;
    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        const dx = x[a]! - x[b]!;
        const dy = y[a]! - y[b]!;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance >= SPATIAL_MIN_SEPARATION) continue;
        settled = false;
        const overlap = (SPATIAL_MIN_SEPARATION - distance) / 2 + 0.5;
        const direction =
          dx !== 0 ? Math.sign(dx) : Math.sign(seededOffset(graph.nodes[a]!.commitId, 2)) || 1;
        x[a] = x[a]! + direction * overlap;
        x[b] = x[b]! - direction * overlap;
      }
    }
    if (settled) break;
  }

  const positions = new Map<string, SpatialPoint>();
  const nodes = graph.nodes.map((node, index): SpatialNode => {
    const point = { x: round(x[index]!), y: round(y[index]!) };
    positions.set(node.commitId, point);
    return {
      commitId: node.commitId,
      item: node.item,
      isBranchPoint: node.isBranchPoint,
      isMerge: node.isMerge,
      ...point,
    };
  });

  const edges = graph.nodes.flatMap((node) =>
    node.parents.flatMap((parentId): ReadonlyArray<SpatialEdge> => {
      const from = positions.get(parentId);
      const to = positions.get(node.commitId);
      if (from === undefined || to === undefined) return [];
      return [
        {
          fromCommitId: parentId,
          toCommitId: node.commitId,
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
        },
      ];
    }),
  );

  return {
    nodes,
    positions,
    edges,
    bounds: {
      minX: Math.min(...nodes.map((node) => node.x)),
      minY: Math.min(...nodes.map((node) => node.y)),
      maxX: Math.max(...nodes.map((node) => node.x)),
      maxY: Math.max(...nodes.map((node) => node.y)),
    },
    simulated,
  };
}

const clampStep = (value: number) => Math.max(-SPATIAL_MAX_STEP, Math.min(SPATIAL_MAX_STEP, value));

/** Positions are rendered, compared, and carried between solves; keep them exact. */
const round = (value: number) => Math.round(value * 100) / 100;

const SUMMARY_MAX_LENGTH = 60;

/**
 * How a commit reads in one line of the explorer. A message says what it said;
 * a plan revision has no body to show, so it says what it did; an imported
 * issue reads as its title, which is what a person would call it.
 */
export function planCommitSummary(item: PlanTimelineItem): string {
  if (item._tag === "plan-revision") {
    return item.authorKind === "human" ? "You edited the plan" : "The assistant revised the plan";
  }
  if (item._tag === "technical-plan") {
    return `Technical plan for ${item.repositoryName}`;
  }
  const isIssue = item._tag === "issue-revision";
  const firstLine = (isIssue ? item.title : item.text)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return isIssue ? "Imported issue" : "Empty message";
  return firstLine.length <= SUMMARY_MAX_LENGTH
    ? firstLine
    : `${firstLine.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}
