/**
 * A file graph: one file in the middle and the files it imports and that import it, as the
 * Repositories' local graph draws it (`FileGraph`). Its host caps and folds it, so it lays out in
 * one pass on rings around the centre, never by forces: the files it uses to the right, the files
 * that use it to the left, each ring one link further out.
 */
import { medianNearestNeighbour, type GraphLayout } from "../layout/forceLayout.ts";
import { NodeShape } from "./kinds.ts";
import type { Memory, MemoryNote } from "./memory.ts";
import { NO_FILTERS } from "./search.ts";
import { buildUniverse, type Universe } from "./universe.ts";
import { countWords, deriveView, Emphasis, type ReadingView } from "./view.ts";

export type FileGraphNodeKind = "file" | "package" | "dependency" | "folder";

export interface FileGraphNode {
  readonly id: string;
  readonly name: string;
  /** A file is a dot, another package a square, a dependency a faint dot, a folded folder a ring. */
  readonly kind: FileGraphNodeKind;
  /** Changed on its branch or not yet committed: it carries a ring. */
  readonly changed: boolean;
  /** A folded folder's file count, said in its label. */
  readonly files: number | null;
}

/** `from` imports `to`. */
export interface FileGraphLink {
  readonly from: string;
  readonly to: string;
  /** Resolved by name alone: drawn dashed. */
  readonly guessed: boolean;
}

export interface FileGraphData {
  readonly center: string;
  readonly nodes: ReadonlyArray<FileGraphNode>;
  readonly links: ReadonlyArray<FileGraphLink>;
}

/** World units between rings, and the least arc between neighbours on one. */
const RING_GAP = 66;
const MIN_ARC = 27;
/** The half-width of each side's fan, short of a half circle so the two sides stay apart. */
const HALF_FAN = Math.PI * 0.42;
/** A dependency's emphasis: a faint leaf. */
const FAINT = 0.3;

const universeKeys = new WeakMap<FileGraphData, string>();
let nextKey = 0;

/** A key per graph handed over: a new graph is a new picture, never one grown from the last. */
function keyOf(graph: FileGraphData): string {
  let key = universeKeys.get(graph);
  if (key === undefined) {
    nextKey += 1;
    key = `file-graph/${nextKey}`;
    universeKeys.set(graph, key);
  }
  return key;
}

/** What a graph draws, as one string: two graphs with the same draw the same picture. */
export const fileGraphSignature = (graph: FileGraphData): string =>
  JSON.stringify([
    graph.center,
    graph.nodes.map((node) => [node.id, node.name, node.kind, node.changed, node.files]),
    graph.links.map((link) => [link.from, link.to, link.guessed]),
  ]);

export function fileGraphMemory(graph: FileGraphData): Memory {
  return {
    id: keyOf(graph),
    notes: graph.nodes.map((node): MemoryNote => ({
      id: node.id,
      name: node.name,
      frontier: false,
      ...(node.kind === "folder" ? { kind: "folder" } : {}),
      ...(node.kind === "package" ? { shape: NodeShape.square } : {}),
    })),
    links: graph.links.map((link) => ({
      from: link.from,
      to: link.to,
      kind: "imports",
      resolution: link.guessed ? "heuristic" : "exact",
    })),
    lenses: [],
  };
}

export const fileGraphUniverse = (graph: FileGraphData): Universe =>
  buildUniverse(keyOf(graph), fileGraphMemory(graph));

/** How many links each node is from the centre one way: along imports (`uses`) or against them. */
function reach(graph: FileGraphData, direction: "uses" | "usedBy"): Map<string, number> {
  const next = new Map<string, Array<string>>();
  for (const link of graph.links) {
    const [from, to] = direction === "uses" ? [link.from, link.to] : [link.to, link.from];
    const list = next.get(from) ?? [];
    list.push(to);
    next.set(from, list);
  }
  const depth = new Map([[graph.center, 0]]);
  let ring = [graph.center];
  while (ring.length > 0) {
    const out: Array<string> = [];
    for (const id of ring) {
      for (const to of next.get(id) ?? []) {
        if (depth.has(to)) continue;
        depth.set(to, (depth.get(id) ?? 0) + 1);
        out.push(to);
      }
    }
    ring = out;
  }
  return depth;
}

interface Placed {
  readonly side: "uses" | "usedBy";
  readonly depth: number;
  /** The node one ring in that leads here, for ordering a ring by where its parents sit. */
  readonly parent: string | null;
}

/**
 * Each node's side and ring: the nearer way from the centre, along imports when tied. A node
 * neither way reaches (the host's fold may cut a path) sits on the outer ring of the uses side.
 */
export function fileGraphRings(graph: FileGraphData): Map<string, Placed> {
  const uses = reach(graph, "uses");
  const usedBy = reach(graph, "usedBy");
  const placed = new Map<string, Placed>();
  const outer = Math.max(1, ...uses.values(), ...usedBy.values());
  for (const node of graph.nodes) {
    if (node.id === graph.center) continue;
    const forward = uses.get(node.id);
    const backward = usedBy.get(node.id);
    if (forward === undefined && backward === undefined) {
      placed.set(node.id, { side: "uses", depth: outer, parent: null });
      continue;
    }
    const side = backward === undefined || (forward !== undefined && forward <= backward);
    const depth = (side ? forward : backward) ?? outer;
    placed.set(node.id, { side: side ? "uses" : "usedBy", depth, parent: null });
  }
  // A parent: a linked node one ring in on the same side (the centre for the first ring).
  for (const link of graph.links) {
    for (const [id, other] of [
      [link.to, link.from],
      [link.from, link.to],
    ] as const) {
      const here = placed.get(id);
      if (here === undefined || here.parent !== null) continue;
      const there = other === graph.center ? { side: here.side, depth: 0 } : placed.get(other);
      if (there?.side === here.side && there.depth === here.depth - 1) {
        placed.set(id, { ...here, parent: other });
      }
    }
  }
  return placed;
}

/**
 * The rings, laid out: the centre at the origin, each side's ring fanned around its own direction
 * (both fans share the circle when only one side has nodes), and each ring ordered by where its
 * nodes' parents sit, so links fan outward rather than cross. A crowded ring moves out until its
 * nodes stand `MIN_ARC` apart.
 */
export function fileGraphLayout(universe: Universe, graph: FileGraphData): GraphLayout {
  const started = performance.now();
  const rings = fileGraphRings(graph);
  // Where each node sits across its side's fan, 0 at the top to 1 at the bottom.
  const share = new Map<string, number>([[graph.center, 0.5]]);
  const radiusOf = new Map<string, number>([[graph.center, 0]]);
  const angle = new Map<string, number>([[graph.center, 0]]);
  const sides = new Set([...rings.values()].map((place) => place.side));
  const fan = sides.size === 2 ? HALF_FAN : Math.PI * (1 - 1 / 24);
  const depths = [...new Set([...rings.values()].map((place) => place.depth))].sort(
    (left, right) => left - right,
  );
  let previousRadius = 0;
  for (const depth of depths) {
    const ring = [...rings].filter(([, place]) => place.depth === depth);
    const crowd = Math.max(
      ...(["uses", "usedBy"] as const).map(
        (side) => ring.filter(([, place]) => place.side === side).length,
      ),
    );
    const radius = Math.max(previousRadius + RING_GAP, (crowd * MIN_ARC) / (2 * fan));
    previousRadius = radius;
    for (const side of ["uses", "usedBy"] as const) {
      const members = ring
        .filter(([, place]) => place.side === side)
        .map(([id, place]) => ({
          id,
          parentShare: place.parent === null ? 1 : (share.get(place.parent) ?? 1),
        }))
        .sort((left, right) =>
          left.parentShare !== right.parentShare
            ? left.parentShare - right.parentShare
            : left.id < right.id
              ? -1
              : 1,
        );
      members.forEach((member, at) => {
        const across = (at + 0.5) / members.length;
        const offset = fan - across * 2 * fan;
        share.set(member.id, across);
        radiusOf.set(member.id, radius);
        angle.set(member.id, side === "uses" || sides.size === 1 ? offset : Math.PI - offset);
      });
    }
  }
  const positions = new Float32Array(universe.nodes.length * 3);
  let extent = 0;
  universe.nodes.forEach((node, at) => {
    const r = radiusOf.get(node.id) ?? 0;
    const theta = angle.get(node.id) ?? 0;
    positions[at * 3] = r * Math.cos(theta);
    positions[at * 3 + 1] = r * Math.sin(theta);
    extent = Math.max(extent, r);
  });
  return {
    dimensions: 2,
    positions,
    center: [0, 0, 0],
    radius: extent,
    spacing: Math.max(medianNearestNeighbour(positions, universe.nodes.length), MIN_ARC),
    ms: performance.now() - started,
  };
}

/**
 * Every node and link shown: the centre in front (held as the pick, so it grows and keeps its
 * label outlined), its neighbours just behind, a dependency faint, a changed file ringed (the
 * shaders' worked-note mark), and a folded folder saying how many files it holds.
 */
export function fileGraphView(universe: Universe, graph: FileGraphData): ReadingView {
  const view = deriveView({
    universe,
    lenses: [],
    shownLensSlots: [],
    reading: null,
    whole: true,
    pickedId: universe.indexOf.has(graph.center) ? graph.center : null,
    depth: 0,
    filters: NO_FILTERS,
  });
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeOf = (at: number) => byId.get(universe.nodes[view.nodes[at] ?? -1]?.id ?? "");
  const nodeEmphasis = view.nodeEmphasis.map((emphasis, at) =>
    nodeOf(at)?.kind === "dependency" ? FAINT : Math.max(emphasis, Emphasis.whole),
  );
  const nodeGlow = view.nodeGlow.map((_, at) => (nodeOf(at)?.changed === true ? 1 : 0));
  const nodeCount = Array.from(view.nodes, (_, at) => {
    const files = nodeOf(at)?.files ?? null;
    return files === null ? "" : countWords(files, "file");
  });
  return { ...view, nodeEmphasis, nodeGlow, nodeCount };
}
