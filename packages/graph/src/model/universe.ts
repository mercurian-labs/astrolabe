/**
 * Everything the graph may ever draw for one memory and thread, in a fixed
 * order: the layout places it once, and a view names what of it shows. It is
 * data: nothing per frame or per checkpoint walks all of it. A renderer draws
 * the view's notes from slots of its own, sized to what shows.
 */
import {
  indexMemory,
  pairKey,
  type Memory,
  type MemoryIndex,
  type MemoryLink,
  type NoteKind,
} from "./memory.ts";

export interface UniverseNode {
  readonly id: string;
  readonly name: string;
  /** The note's layout group, when the memory gives one (a `parent` supersedes it). */
  readonly group?: string;
  /** What the note is, in a codebase. */
  readonly kind?: NoteKind;
}

/** Bits of `Universe.edgeMarks`: how a codebase's edge draws when lit. */
export const EdgeMark = {
  /** Every link on the pair was resolved by heuristic: it draws dashed. */
  heuristic: 1,
  /** A link on the pair is inheritance or overriding: its direction means something, so it draws an arrowhead. */
  directed: 2,
} as const;

const POLYMORPHISM = new Set(["inherits", "implements", "overrides"]);

const NO_CHILDREN: ReadonlyArray<number> = [];

export interface UniverseEdge {
  readonly key: string;
  /** Node indices, `a` holding the lesser id. */
  readonly a: number;
  readonly b: number;
  /** A skill-map edge with no wikilink under it: drawn only while its lens is on. */
  readonly lensOnly: boolean;
  /**
   * No link of its own: the pair a coarser level draws links between when one
   * end (or both) is a closed container holding a link's end.
   */
  readonly aggregate: boolean;
}

export interface Universe {
  /** Identifies the universe for layout caching. */
  readonly key: string;
  readonly nodes: ReadonlyArray<UniverseNode>;
  readonly indexOf: ReadonlyMap<string, number>;
  readonly edges: ReadonlyArray<UniverseEdge>;
  readonly edgeIndexOf: ReadonlyMap<string, number>;
  /** The edges touching each node, by node index: what a view walks to find the edges among its notes. */
  readonly edgesOf: ReadonlyArray<ReadonlyArray<number>>;
  /** Each node's container (its `parent`, by node index), or -1. */
  readonly parentOf: Int32Array;
  /** Each node's contained notes, by node index. */
  readonly childrenOf: ReadonlyArray<ReadonlyArray<number>>;
  /** Some note has a parent: the memory is a containment tree (a codebase), not a flat web. */
  readonly tree: boolean;
  /** Each edge's links that say what they mean (`kind`), for the popover and lenses; empty in a vault. */
  readonly edgeLinks: ReadonlyArray<ReadonlyArray<MemoryLink>>;
  /** Each edge's `EdgeMark` bits. */
  readonly edgeMarks: Uint8Array;
  /** The wikilink structure over every note, for layout. */
  readonly index: MemoryIndex;
}

/**
 * Nodes and edges sorted by id so the same memory always lays out and draws
 * the same. `index`, when the caller already holds the memory's index (a
 * thread's), saves building it again.
 */
export function buildUniverse(
  key: string,
  memory: Memory,
  index: MemoryIndex = indexMemory(memory.notes, memory.links),
): Universe {
  const nodes = index.notes
    .map((note): UniverseNode => ({
      id: note.id,
      name: note.name,
      ...(note.group === undefined ? {} : { group: note.group }),
      ...(note.kind === undefined ? {} : { kind: note.kind }),
    }))
    .toSorted((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const indexOf = new Map(nodes.map((node, position) => [node.id, position]));
  const edges: Array<UniverseEdge> = [];
  const edgeIndexOf = new Map<string, number>();
  const add = (from: string, to: string, lensOnly: boolean, aggregate = false) => {
    const key = pairKey(from, to);
    const a = indexOf.get(from < to ? from : to);
    const b = indexOf.get(from < to ? to : from);
    if (edgeIndexOf.has(key) || a === undefined || b === undefined || a === b) return;
    edgeIndexOf.set(key, edges.length);
    edges.push({ key, a, b, lensOnly, aggregate });
  };
  const byKey = (left: { key: string }, right: { key: string }) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  for (const pair of index.pairs.toSorted(byKey)) add(pair.a, pair.b, false);
  for (const lens of memory.lenses) for (const edge of lens.edges) add(edge.from, edge.to, true);
  // Containment: each note's parent, when the universe holds it.
  const parentOf = new Int32Array(nodes.length).fill(-1);
  let unknown = 0;
  nodes.forEach((node, at) => {
    const parent = index.byId.get(node.id)?.parent;
    if (parent === undefined) return;
    const container = indexOf.get(parent);
    if (container === undefined) unknown += 1;
    else if (container !== at) parentOf[at] = container;
  });
  // A parent chain that loops is cut where it closes, so every walk up the tree ends.
  let cut = 0;
  const walked = new Uint8Array(nodes.length);
  for (let start = 0; start < nodes.length; start += 1) {
    const walk: Array<number> = [];
    let at = start;
    while (at >= 0 && walked[at] === 0) {
      walked[at] = 1;
      walk.push(at);
      at = parentOf[at] ?? -1;
    }
    const last = walk.at(-1);
    if (at >= 0 && walked[at] === 1 && last !== undefined) {
      parentOf[last] = -1;
      cut += 1;
    }
    for (const done of walk) walked[done] = 2;
  }
  if (unknown > 0 || cut > 0) {
    console.warn(
      `${key}: ${unknown} note(s) name a parent the memory lacks, ${cut} parent loop(s) cut; those notes sit at the top.`,
    );
  }
  const tree = parentOf.some((parent) => parent >= 0);
  const children = new Map<number, Array<number>>();
  parentOf.forEach((parent, at) => {
    if (parent < 0) return;
    const list = children.get(parent) ?? [];
    list.push(at);
    children.set(parent, list);
  });
  // Where a link's ends sit inside containers, a coarser level draws it between
  // whatever shows on each side: the end itself or a closed container above it,
  // below the containers the two ends share. Each such pair gets an edge once.
  if (tree) {
    const chain = (at: number) => {
      const up: Array<number> = [];
      for (let node = at; node >= 0; node = parentOf[node] ?? -1) up.push(node);
      return up.toReversed();
    };
    const linked = edges.length;
    for (let at = 0; at < linked; at += 1) {
      const edge = edges[at];
      if (edge === undefined || edge.lensOnly) continue;
      const left = chain(edge.a);
      const right = chain(edge.b);
      let depth = 0;
      while (depth < left.length && depth < right.length && left[depth] === right[depth])
        depth += 1;
      for (const x of left.slice(depth)) {
        for (const y of right.slice(depth)) {
          const from = nodes[x]?.id;
          const to = nodes[y]?.id;
          if (from !== undefined && to !== undefined) add(from, to, false, true);
        }
      }
    }
  }
  const edgesOf: Array<Array<number>> = nodes.map(() => []);
  edges.forEach((edge, at) => {
    edgesOf[edge.a]?.push(at);
    edgesOf[edge.b]?.push(at);
  });
  const childrenOf = nodes.map((_, at) => children.get(at) ?? NO_CHILDREN);
  // What each edge's links mean, where the memory says.
  const edgeLinks: Array<Array<MemoryLink>> = edges.map(() => []);
  for (const link of memory.links) {
    if (link.kind === undefined) continue;
    const at = edgeIndexOf.get(pairKey(link.from, link.to));
    if (at !== undefined) edgeLinks[at]?.push(link);
  }
  const edgeMarks = new Uint8Array(edges.length);
  edgeLinks.forEach((links, at) => {
    if (links.length === 0) return;
    let marks = 0;
    if (links.every((link) => link.resolution === "heuristic")) marks |= EdgeMark.heuristic;
    if (links.some((link) => link.kind !== undefined && POLYMORPHISM.has(link.kind))) {
      marks |= EdgeMark.directed;
    }
    edgeMarks[at] = marks;
  });
  return {
    key,
    nodes,
    indexOf,
    edges,
    edgeIndexOf,
    edgesOf,
    parentOf,
    childrenOf,
    tree,
    edgeLinks,
    edgeMarks,
    index,
  };
}

/**
 * Whether `next` grew from `previous`: the same key, and every note and edge
 * of `previous` at the same index in `next`. A renderer keeps what it holds
 * across such a step (see `growUniverse`); anything else is a new universe.
 */
export function grewFrom(previous: Universe, next: Universe): boolean {
  if (previous === next) return true;
  if (previous.key !== next.key) return false;
  if (previous.nodes.length > next.nodes.length || previous.edges.length > next.edges.length) {
    return false;
  }
  return (
    previous.nodes.every((node, at) => next.nodes[at]?.id === node.id) &&
    previous.edges.every((edge, at) => next.edges[at]?.key === edge.key)
  );
}

/**
 * `next` reindexed so that it grew from `previous` (see `grewFrom`): the notes
 * and edges `previous` held keep their indices and what is new follows, in
 * `next`'s order. A thread whose working turn writes a file grows its
 * universe; keeping the indices lets the renderer, the cursor's tour, and the
 * gestures it left carry on rather than start again. `next` as it is when it
 * is not a superset of `previous` (another key, a rolled-back turn).
 */
export function growUniverse(previous: Universe | null, next: Universe): Universe {
  if (previous === null || previous.key !== next.key || grewFrom(previous, next)) return next;
  if (
    !previous.nodes.every((node) => next.indexOf.has(node.id)) ||
    !previous.edges.every((edge) => next.edgeIndexOf.has(edge.key))
  ) {
    return next;
  }
  const nodeOrder = [
    ...previous.nodes.map((node) => next.indexOf.get(node.id) ?? -1),
    ...next.nodes.flatMap((node, at) => (previous.indexOf.has(node.id) ? [] : [at])),
  ];
  const nodeTo = new Int32Array(next.nodes.length);
  nodeOrder.forEach((from, to) => (nodeTo[from] = to));
  const edgeOrder = [
    ...previous.edges.map((edge) => next.edgeIndexOf.get(edge.key) ?? -1),
    ...next.edges.flatMap((edge, at) => (previous.edgeIndexOf.has(edge.key) ? [] : [at])),
  ];
  const edgeTo = new Int32Array(next.edges.length);
  edgeOrder.forEach((from, to) => (edgeTo[from] = to));
  const node = (at: number) => (at < 0 ? at : (nodeTo[at] ?? -1));
  const edge = (at: number) => edgeTo[at] ?? -1;
  const nodes = nodeOrder.map((from) => next.nodes[from] ?? { id: "", name: "" });
  const edges = edgeOrder.map((from): UniverseEdge => {
    const was = next.edges[from] ?? { key: "", a: 0, b: 0, lensOnly: true, aggregate: false };
    return { ...was, a: node(was.a), b: node(was.b) };
  });
  const parentOf = new Int32Array(nodes.length);
  nodeOrder.forEach((from, to) => (parentOf[to] = node(next.parentOf[from] ?? -1)));
  return {
    ...next,
    nodes,
    indexOf: new Map(nodes.map((each, at) => [each.id, at])),
    edges,
    edgeIndexOf: new Map(edges.map((each, at) => [each.key, at])),
    edgesOf: nodeOrder.map((from) => (next.edgesOf[from] ?? []).map(edge)),
    parentOf,
    childrenOf: nodeOrder.map((from) => (next.childrenOf[from] ?? NO_CHILDREN).map(node)),
    edgeLinks: edgeOrder.map((from) => next.edgeLinks[from] ?? []),
    edgeMarks: Uint8Array.from(edgeOrder, (from) => next.edgeMarks[from] ?? 0),
  };
}
