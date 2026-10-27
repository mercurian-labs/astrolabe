/**
 * What the graph shows, decided purely from the reading, pick, filters, and lenses. It costs the
 * reading and its notes' links, never the size of the memory (unless the whole memory shows). A
 * renderer lays a view over slots of its own (see `expandView`). Emphasis runs from receded
 * (surroundings, frontier) to front (worked notes).
 */
import { localGraph, neighborsOf, pairKey, type MemoryIndex, type MemoryLens } from "./memory.ts";
import { kindShape } from "./kinds.ts";
import { lensPlacement } from "./lenses.ts";
import type { Reading } from "./reading.ts";
import { applyFilters, normalizeQuery, searchMatches, type GraphFilters } from "./search.ts";
import { EdgeMark, type Universe } from "./universe.ts";
import {
  DATA_KINDS,
  FAILURE_KINDS,
  shownLinks,
  uncaughtThrowers,
  violatesWith,
  type BoundaryIndex,
} from "./features.ts";
import type { DesignFeatures } from "./settings.ts";

export const NodeFlag = {
  frontier: 1,
  new: 2,
  amended: 4,
  picked: 8,
  match: 16,
  /** With failure flow on: it throws, and nothing it is called from (shown) catches. */
  uncaught: 32,
} as const;

export const EdgeKind = { plain: 0, new: 1, broken: 2 } as const;

/** The glyph each verb puts before a note's name, in the play-by-play and on the map. */
export const VERB_GLYPH = { write: "+", amend: "~", remove: "×" } as const;

/** Which ways a pair links: bit 1 is a → b, bit 2 is b → a. */
/**
 * Bits of an edge's direction: the ways its links run (forward is a → b),
 * and above them the edge's `EdgeMark`s, carried along so every renderer
 * sees them where it reads the direction: a heuristic edge draws dashed, a
 * directed one (inherits, implements, overrides) with arrowheads, when lit.
 */
export const EdgeDirection = {
  forward: 1,
  backward: 2,
  heuristic: 4,
  directed: 8,
  /** With data flow on: every link is accepts or returns. Thin, a hollow head at the type. */
  data: 16,
  /** With failure flow on: every link is throws or catches. Warning tint, a head at the error type. */
  failure: 32,
  /** With boundaries on: a link crosses two layers the declaration does not allow. Warning tint, doubled. */
  violation: 64,
} as const;

export const Emphasis = {
  front: 1,
  picked: 1,
  pickedNeighbor: 0.85,
  match: 0.9,
  earlier: 0.72,
  whole: 0.62,
  wholeWithReading: 0.5,
  around: 0.34,
  frontier: 0.45,
} as const;

export interface ViewInput {
  readonly universe: Universe;
  readonly lenses: ReadonlyArray<MemoryLens>;
  readonly shownLensSlots: ReadonlyArray<number>;
  /** The thread's reading at the current checkpoint, or null when there is no thread. */
  readonly reading: Reading | null;
  /** Show every note, not only those the reading reached. */
  readonly whole: boolean;
  readonly pickedId: string | null;
  readonly depth: number;
  readonly filters: GraphFilters;
  /**
   * The closed containers (universe indices), in a containment tree: each
   * draws as one node for the reading notes inside it. Absent, every
   * container above a shown note is open.
   */
  readonly closed?: ReadonlySet<number>;
  /** The notes the checkpoint's turn removed (see `removalsAt`), by id: their labels carry "×". */
  readonly removedNow?: ReadonlySet<string>;
  /**
   * Containers opened past the landing's level (by the tour, or by a drill),
   * by universe index: while one is open, the standing edges among what shows
   * inside it draw quietly as structure.
   */
  readonly opened?: ReadonlySet<number>;
  /** The design features turned on; absent, all off. */
  readonly features?: DesignFeatures;
  /** The declared layers over the universe, while boundaries are on and declared. */
  readonly boundaries?: BoundaryIndex;
  /** Draw the layers as regions around what shows in them (the survey level only). */
  readonly showLayers?: boolean;
  /**
   * Draw only the story's group and its parent as regions, the ancestors
   * above them bare (see `Region.bare`): a host's choice, for a narrow panel.
   */
  readonly quietAncestors?: boolean;
}

/**
 * The shown notes and edges, by universe index, each list ascending, with
 * their targets in parallel arrays.
 */
export interface ReadingView {
  /** The shown notes' universe indices. */
  readonly nodes: Int32Array;
  readonly nodeEmphasis: Float32Array;
  /** 1 for the notes the checkpoint's turn worked: they glow. */
  readonly nodeGlow: Float32Array;
  readonly nodeFlags: Uint8Array;
  /** The first shown lens slot placing the note, or -1. */
  readonly nodeSlot: Int8Array;
  /** Distinct linked notes at this checkpoint: size is connectedness. */
  readonly nodeDegree: Float32Array;
  /** For a closed container, how many reading notes it holds (its size); 0 for a note. */
  readonly nodeMembers: Float32Array;
  /**
   * For a closed container, what it holds in words, counting the leaves alone
   * ("190 files"), so a folded group reads as its scale; "" for a note.
   */
  readonly nodeCount?: ReadonlyArray<string>;
  /**
   * What the checkpoint's own turn did to each shown note, as the glyph its
   * label carries for the rest of the checkpoint: "+" written, "~" amended,
   * "×" removed; "" otherwise.
   */
  readonly nodeGlyph: ReadonlyArray<string>;
  /** Where each shown note sits in `nodes`, by universe index. */
  readonly nodeAt: ReadonlyMap<number, number>;
  /** Each reading note folded into a closed container, by universe index: the container that shows for it. */
  readonly holders: ReadonlyMap<number, number>;
  /** The shown edges' universe indices. */
  readonly edges: Int32Array;
  /** 1 for an edge the checkpoint's own turn marked new or broken: the story, lit in full. */
  readonly edgeCurrent: Uint8Array;
  readonly edgeKind: Uint8Array;
  readonly edgeSlot: Int8Array;
  readonly edgeDirection: Uint8Array;
  /**
   * For a link the checkpoint's own turn made new, which way (or ways) the
   * turn added it, as `EdgeDirection` bits; 0 for every other edge.
   */
  readonly edgeNewWays: Uint8Array;
  /**
   * 1 for an edge that stood before the turn, between two shown things inside
   * one container opened past the landing's level: drawn quietly as structure.
   */
  readonly edgeStructure: Uint8Array;
  /** How many links each shown edge stands for: 1 for a link, more for an aggregate. */
  readonly edgeLinkCount: Uint16Array;
  /** The kind most of each shown edge's links have, where they say. */
  readonly edgeLinkKind: ReadonlyArray<string | undefined>;
  /** The picked note and its shown neighbors, by universe index. */
  readonly focus: { readonly index: number; readonly neighbors: ReadonlyArray<number> } | null;
  /** The shown notes the checkpoint's turn worked (universe indices): what following brings forward. */
  readonly risen: ReadonlyArray<number>;
  /**
   * The turn's story (universe indices): the shown notes it wrote or amended,
   * and both ends of the links it added. A landing frames on these.
   */
  readonly story: ReadonlyArray<number>;
  /**
   * The open containers (universe indices, ascending): in a containment tree,
   * every container above a shown note. Each draws as a region around what it
   * holds, not as a node. Empty for a memory without containers.
   */
  readonly regions: Int32Array;
  /** The declared layers around what shows in them (universe indices), while `showLayers`. */
  readonly layers: ReadonlyArray<{ readonly name: string; readonly nodes: ReadonlyArray<number> }>;
  /** The regions above the story's group and its parent draw bare (`ViewInput.quietAncestors`). */
  readonly quietAncestors?: boolean;
  readonly shownNodes: number;
  readonly shownEdges: number;
  /** A search is narrowing the graph; matches carry `NodeFlag.match`. */
  readonly searching: boolean;
}

/**
 * An open container as a renderer draws it: a region around the nodes
 * directly in it and its inner regions. `nodes` are in the dense view's index
 * space (a renderer's slots); `inner` are positions in the regions list.
 */
export interface Region {
  /** The container's universe index; for a declared layer, −1 − its place among the layers (never picked). */
  readonly note: number;
  readonly name: string;
  /** How many regions hold this one: 0 for the outermost. */
  readonly depth: number;
  readonly nodes: ReadonlyArray<number>;
  readonly inner: ReadonlyArray<number>;
  /**
   * An ancestor above the story's group and its parent: it still holds what
   * it holds, but draws no disc and no name, since its rim would only ring
   * the frame. The parent carries its path instead ("apps/web/src/components").
   */
  readonly bare?: boolean;
}

/**
 * The regions of `view` in a dense index space, outermost first: each
 * container with the shown nodes directly in it (by `nodeTo`) and its inner
 * regions. Costs the shown notes and their containers.
 */
export function regionShapes(
  view: Pick<ReadingView, "nodes" | "regions"> &
    Partial<Pick<ReadingView, "layers" | "story" | "quietAncestors">>,
  universe: Pick<Universe, "nodes" | "parentOf">,
  nodeTo: (index: number) => number,
): Array<Region> {
  // Declared layers draw last, over the folders: a faint band each, named, never picked (a negative note).
  const layers = (view.layers ?? []).map((layer, position) => ({
    note: -1 - position,
    name: layer.name,
    depth: 0,
    nodes: layer.nodes.map(nodeTo),
    inner: [] as Array<number>,
  }));
  if (view.regions.length === 0) return layers;
  const open = new Set(view.regions);
  const depthOf = new Map<number, number>();
  const depth = (index: number): number => {
    const known = depthOf.get(index);
    if (known !== undefined) return known;
    const parent = universe.parentOf[index] ?? -1;
    const value = parent >= 0 && open.has(parent) ? depth(parent) + 1 : 0;
    depthOf.set(index, value);
    return value;
  };
  const order = [...view.regions].sort((left, right) => depth(left) - depth(right) || left - right);
  const at = new Map(order.map((index, position) => [index, position]));
  const shapes = order.map((note) => ({
    note,
    name: universe.nodes[note]?.name ?? "",
    depth: depth(note),
    nodes: [] as Array<number>,
    inner: [] as Array<number>,
    bare: false,
  }));
  for (const index of view.nodes) {
    const parent = at.get(universe.parentOf[index] ?? -1);
    if (parent !== undefined) shapes[parent]?.nodes.push(nodeTo(index));
  }
  order.forEach((index, position) => {
    const parent = at.get(universe.parentOf[index] ?? -1);
    if (parent !== undefined) shapes[parent]?.inner.push(position);
  });
  // A region holding only one inner region draws nearly the same disc: its
  // name goes on the inner one as a path ("playground/main.tsx"), not stacked.
  shapes.forEach((shape) => {
    const only = shape.inner.length === 1 && shape.nodes.length === 0 ? shape.inner[0] : undefined;
    const inner = only === undefined ? undefined : shapes[only];
    if (inner === undefined || shape.name === "") return;
    inner.name = `${shape.name}/${inner.name}`;
    shape.name = "";
  });
  // With quiet ancestors, the story's group (the deepest region holding all of it) and one
  // parent draw; every region above them is bare, and the outermost drawn region on
  // the group's line is named by its whole path, so the frame keeps the
  // ancestry as words rather than as rims.
  const group = view.quietAncestors === true ? storyGroup(view.story ?? [], open, universe) : -1;
  const parent = group < 0 ? -1 : (universe.parentOf[group] ?? -1);
  const top = parent >= 0 && open.has(parent) ? parent : group;
  if (top >= 0) {
    const line: Array<number> = [];
    for (let up = universe.parentOf[top] ?? -1; up >= 0; up = universe.parentOf[up] ?? -1) {
      if (open.has(up)) line.push(up);
    }
    for (const ancestor of line) {
      const shape = shapes[at.get(ancestor) ?? -1];
      if (shape === undefined) continue;
      shape.bare = true;
      shape.name = "";
    }
    if (line.length > 0) {
      // The first named region from the top of the drawn line down (a merge may have moved the name inward).
      let named = top;
      while (shapes[at.get(named) ?? -1]?.name === "") {
        const shape = shapes[at.get(named) ?? -1];
        const only = shape?.inner.length === 1 ? shape.inner[0] : undefined;
        const inner = only === undefined ? undefined : shapes[only];
        if (inner === undefined) break;
        named = inner.note;
      }
      const shape = shapes[at.get(named) ?? -1];
      if (shape !== undefined && shape.name !== "") {
        const path: Array<string> = [];
        for (let up = named; up >= 0; up = universe.parentOf[up] ?? -1) {
          path.push(universe.nodes[up]?.name ?? "");
        }
        shape.name = path.toReversed().join("/");
      }
    }
  }
  return [...shapes, ...layers];
}

/** "1 file", "190 files", "3 classes": a count in words, the kind as its noun. */
export function countWords(count: number, kind: string): string {
  if (count === 1) return `1 ${kind}`;
  const plural = /(s|x|ch|sh)$/.test(kind) ? `${kind}es` : `${kind}s`;
  return `${count} ${plural}`;
}

/** The deepest open container holding every note of `story` (universe indices), or -1. */
function storyGroup(
  story: ReadonlyArray<number>,
  open: ReadonlySet<number>,
  universe: Pick<Universe, "parentOf">,
): number {
  let common: Array<number> | null = null;
  for (const note of story) {
    const chain: Array<number> = [];
    for (let up = universe.parentOf[note] ?? -1; up >= 0; up = universe.parentOf[up] ?? -1) {
      if (open.has(up)) chain.push(up);
    }
    chain.reverse();
    if (common === null) {
      common = chain;
      continue;
    }
    let depth = 0;
    while (depth < common.length && depth < chain.length && common[depth] === chain[depth]) {
      depth += 1;
    }
    common = common.slice(0, depth);
  }
  return common?.at(-1) ?? -1;
}

/**
 * A view laid out densely: per-node and per-edge targets over some index
 * space (a renderer's slots, or the universe itself), a hidden entry 0.
 */
export interface GraphView {
  readonly nodeVisible: Uint8Array;
  readonly nodeEmphasis: Float32Array;
  readonly nodeGlow: Float32Array;
  readonly nodeFlags: Uint8Array;
  readonly nodeSlot: Int8Array;
  /** A note's degree; for a closed container, minus the notes it holds (what sizes it). */
  readonly nodeDegree: Float32Array;
  /** The shape a note draws as (`NodeShape`), by its kind; set for every entry that holds a note, shown or leaving. */
  readonly nodeShape: Uint8Array;
  readonly edgeVisible: Uint8Array;
  readonly edgeCurrent: Uint8Array;
  readonly edgeKind: Uint8Array;
  readonly edgeSlot: Int8Array;
  readonly edgeDirection: Uint8Array;
  readonly edgeNewWays: Uint8Array;
  readonly edgeStructure: Uint8Array;
  readonly focus: { readonly index: number; readonly neighbors: ReadonlyArray<number> } | null;
  readonly risen: ReadonlyArray<number>;
  readonly story: ReadonlyArray<number>;
  /** The open containers, outermost first. */
  readonly regions: ReadonlyArray<Region>;
  readonly shownNodes: number;
  readonly shownEdges: number;
  readonly searching: boolean;
}

/** Node `at` of `view`'s degree as a dense view holds it: minus its members for a closed container. */
export const viewDegree = (view: Pick<ReadingView, "nodeDegree" | "nodeMembers">, at: number) => {
  const members = view.nodeMembers[at] ?? 0;
  return members > 0 ? -members : (view.nodeDegree[at] ?? 0);
};

/** A dense view with nothing shown, `nodes` × `edges` wide. */
export function emptyView(nodes: number, edges: number): GraphView {
  return {
    nodeVisible: new Uint8Array(nodes),
    nodeEmphasis: new Float32Array(nodes),
    nodeGlow: new Float32Array(nodes),
    nodeFlags: new Uint8Array(nodes),
    nodeSlot: new Int8Array(nodes).fill(-1),
    nodeDegree: new Float32Array(nodes),
    nodeShape: new Uint8Array(nodes),
    edgeVisible: new Uint8Array(edges),
    edgeCurrent: new Uint8Array(edges),
    edgeKind: new Uint8Array(edges),
    edgeSlot: new Int8Array(edges).fill(-1),
    edgeDirection: new Uint8Array(edges),
    edgeNewWays: new Uint8Array(edges),
    edgeStructure: new Uint8Array(edges),
    focus: null,
    risen: [],
    story: [],
    regions: [],
    shownNodes: 0,
    shownEdges: 0,
    searching: false,
  };
}

/**
 * Lay `view` out densely over `nodes` × `edges` entries, each shown note and
 * edge at the place `nodeTo` and `edgeTo` give it (the universe's own, by
 * default). A renderer passes its slots.
 */
export function expandView(
  view: ReadingView,
  nodes: number,
  edges: number,
  nodeTo: (index: number) => number = (index) => index,
  edgeTo: (index: number) => number = (index) => index,
): GraphView {
  const dense = emptyView(nodes, edges);
  const {
    nodeVisible,
    nodeEmphasis,
    nodeGlow,
    nodeFlags,
    nodeSlot,
    nodeDegree,
    edgeVisible,
    edgeCurrent,
    edgeKind,
    edgeSlot,
    edgeDirection,
    edgeNewWays,
    edgeStructure,
  } = dense;
  view.nodes.forEach((index, at) => {
    const to = nodeTo(index);
    nodeVisible[to] = 1;
    nodeEmphasis[to] = view.nodeEmphasis[at] ?? 0;
    nodeGlow[to] = view.nodeGlow[at] ?? 0;
    nodeFlags[to] = view.nodeFlags[at] ?? 0;
    nodeSlot[to] = view.nodeSlot[at] ?? -1;
    nodeDegree[to] = viewDegree(view, at);
  });
  view.edges.forEach((index, at) => {
    const to = edgeTo(index);
    edgeVisible[to] = 1;
    edgeCurrent[to] = view.edgeCurrent[at] ?? 0;
    edgeKind[to] = view.edgeKind[at] ?? 0;
    edgeSlot[to] = view.edgeSlot[at] ?? -1;
    edgeDirection[to] = view.edgeDirection[at] ?? 0;
    edgeNewWays[to] = view.edgeNewWays[at] ?? 0;
    edgeStructure[to] = view.edgeStructure[at] ?? 0;
  });
  return {
    ...dense,
    focus:
      view.focus === null
        ? null
        : { index: nodeTo(view.focus.index), neighbors: view.focus.neighbors.map(nodeTo) },
    risen: view.risen.map(nodeTo),
    story: view.story.map(nodeTo),
    shownNodes: view.shownNodes,
    shownEdges: view.shownEdges,
    searching: view.searching,
  };
}

const NO_CLOSED: ReadonlySet<number> = new Set();
const NO_LAYERS: ReadingView["layers"] = [];

/** One drawn edge's targets, summed over the links it stands for. */
interface EdgeTally {
  visible: boolean;
  current: number;
  kind: number;
  slot: number;
  ways: number;
  direction: number;
  /** Every link is a guess (resolved by name alone). */
  guessed: boolean;
  /** Some link is inheritance or overriding. */
  directed: boolean;
  /** Some link crosses layers the boundaries do not allow. */
  violation: boolean;
  count: number;
  kinds: Map<string, number>;
}

/** A link edge as the checkpoint has it, or null when it does not show. */
function edgeTally(
  universe: Universe,
  state: MemoryIndex,
  reading: Reading | null,
  placement: { readonly edgeSlot: ReadonlyMap<string, number> },
  index: number,
  layered: BoundaryIndex | undefined,
): EdgeTally | null {
  const edge = universe.edges[index];
  if (edge === undefined) return null;
  const pair = state.pairByKey.get(edge.key);
  const mark = reading?.linkMarks.get(edge.key);
  const broken = pair === undefined && mark?.mark === "broken";
  if (pair === undefined && !broken) return null;
  const current = mark !== undefined && mark.turn === reading?.checkpoint ? 1 : 0;
  let ways = 0;
  if (current === 1 && mark?.mark === "new" && !broken) {
    const way =
      mark.from === universe.nodes[edge.a]?.id ? EdgeDirection.forward : EdgeDirection.backward;
    ways = mark.both ? EdgeDirection.forward | EdgeDirection.backward : way;
  }
  let direction = 0;
  if (pair !== undefined) {
    direction =
      (pair.forward ? EdgeDirection.forward : 0) | (pair.backward ? EdgeDirection.backward : 0);
  } else if (mark !== undefined) {
    direction = mark.from < mark.to ? EdgeDirection.forward : EdgeDirection.backward;
  }
  const marks = universe.edgeMarks[index] ?? 0;
  const kinds = new Map<string, number>();
  // Resolution as the checkpoint has it: a re-resolution replayed up to it.
  let typed = 0;
  let guesses = 0;
  let violation = false;
  for (const link of universe.edgeLinks[index] ?? []) {
    if (link.kind !== undefined && reading?.linkStands(link) !== false) {
      kinds.set(link.kind, (kinds.get(link.kind) ?? 0) + 1);
      const resolution = reading === null ? link.resolution : reading.linkResolution(link);
      typed += 1;
      if (resolution === "heuristic") guesses += 1;
      if (layered?.crossing[index] === 1 && violatesWith(layered, link, resolution)) {
        violation = true;
      }
    }
  }
  return {
    visible: true,
    current,
    kind: broken ? EdgeKind.broken : mark?.mark === "new" ? EdgeKind.new : EdgeKind.plain,
    slot: placement.edgeSlot.get(edge.key) ?? -1,
    ways,
    direction,
    guessed: typed > 0 ? guesses === typed : (marks & EdgeMark.heuristic) !== 0,
    directed: (marks & EdgeMark.directed) !== 0,
    violation,
    count: 1,
    kinds,
  };
}

/** A lens edge with no link under it, while its lens is shown. */
const lensTally = (slot: number): EdgeTally => ({
  visible: true,
  current: 0,
  kind: EdgeKind.plain,
  slot,
  ways: 0,
  direction: 0,
  guessed: false,
  directed: false,
  violation: false,
  count: 1,
  kinds: new Map(),
});

/** Swap a tally's forward and backward ways: its link runs the other way over the aggregate. */
const flipWays = (bits: number) =>
  ((bits & EdgeDirection.forward) !== 0 ? EdgeDirection.backward : 0) |
  ((bits & EdgeDirection.backward) !== 0 ? EdgeDirection.forward : 0);
const flipTally = (tally: EdgeTally): EdgeTally => ({
  ...tally,
  ways: flipWays(tally.ways),
  direction: flipWays(tally.direction),
});

/**
 * Add a link's tally to the edge drawn for it. An aggregate is new when any of
 * its links is, broken only when all are, a guess only when all are.
 */
function mergeTally(
  drawn: Map<number, EdgeTally>,
  index: number,
  tally: EdgeTally,
  aggregate: boolean,
): void {
  const into = drawn.get(index);
  if (into === undefined) {
    drawn.set(index, { ...tally, slot: aggregate ? -1 : tally.slot, kinds: new Map(tally.kinds) });
    return;
  }
  into.current = Math.max(into.current, tally.current);
  if (tally.kind === EdgeKind.new || into.kind === EdgeKind.new) into.kind = EdgeKind.new;
  else if (tally.kind !== into.kind) into.kind = EdgeKind.plain;
  into.ways |= tally.ways;
  into.direction |= tally.direction;
  into.guessed = into.guessed && tally.guessed;
  into.directed = into.directed || tally.directed;
  into.violation = into.violation || tally.violation;
  into.count += tally.count;
  for (const [kind, n] of tally.kinds) into.kinds.set(kind, (into.kinds.get(kind) ?? 0) + n);
}

/** The design features' bits on a drawn edge's direction: data or failure flow, and a boundary crossing. */
function flowBits(tally: EdgeTally, features: DesignFeatures | undefined): number {
  if (features === undefined) return 0;
  let bits = tally.violation ? EdgeDirection.violation : 0;
  if (tally.kinds.size === 0) return bits;
  const kinds = [...tally.kinds.keys()];
  if (features.dataEdges && kinds.every((kind) => DATA_KINDS.has(kind))) bits |= EdgeDirection.data;
  if (features.failureEdges && kinds.every((kind) => FAILURE_KINDS.has(kind))) {
    bits |= EdgeDirection.failure;
  }
  return bits;
}

/** The kind most links have (ties to the first named), or undefined when none says. */
function dominantKind(kinds: ReadonlyMap<string, number>): string | undefined {
  let best: string | undefined;
  let most = 0;
  for (const [kind, n] of kinds) {
    if (n > most) {
      best = kind;
      most = n;
    }
  }
  return best;
}

export function deriveView(input: ViewInput): ReadingView {
  const { universe, reading, features } = input;
  const layered = features?.boundaries === true ? input.boundaries : undefined;
  const state = reading?.state ?? universe.index;
  const emphasis = new Map<string, number>();
  const raise = (id: string, value: number) => {
    if (!state.byId.has(id)) return;
    emphasis.set(id, Math.max(emphasis.get(id) ?? 0, value));
  };

  if (reading !== null) {
    if (input.whole) for (const id of state.byId.keys()) raise(id, Emphasis.wholeWithReading);
    for (const id of reading.around) raise(id, Emphasis.around);
    for (const id of reading.earlier) raise(id, Emphasis.earlier);
    for (const id of reading.now) raise(id, Emphasis.front);
  } else {
    for (const id of state.byId.keys()) raise(id, Emphasis.whole);
  }

  const picked = input.pickedId !== null && state.byId.has(input.pickedId) ? input.pickedId : null;
  if (picked !== null) {
    for (const id of localGraph((id) => neighborsOf(state, id), [picked], input.depth)) {
      raise(id, Emphasis.pickedNeighbor);
    }
    raise(picked, Emphasis.picked);
  }

  const shown = applyFilters(state, new Set(emphasis.keys()), input.filters);
  const matches = searchMatches(state, shown, input.filters.search);
  for (const id of matches) raise(id, Emphasis.match);

  const placement = lensPlacement(input.lenses, input.shownLensSlots);
  const shownIndices: Array<number> = [];
  for (const id of shown) {
    const index = universe.indexOf.get(id);
    if (index !== undefined && state.byId.has(id)) shownIndices.push(index);
  }
  // In a containment tree a closed container draws as one node for every
  // reading note inside it (the outermost closed one wins), and every open
  // container above a shown thing is a region, not a node: it draws around
  // what it holds. A container holding nothing shown stays an ordinary note.
  const closed = universe.tree ? (input.closed ?? NO_CLOSED) : NO_CLOSED;
  const exists = (index: number) => state.byId.has(universe.nodes[index]?.id ?? "");
  const holders = new Map<number, number>();
  const holderOf = (index: number) => {
    if (closed.size === 0) return index;
    let holder = index;
    for (let up = universe.parentOf[index] ?? -1; up >= 0; up = universe.parentOf[up] ?? -1) {
      if (closed.has(up) && exists(up)) holder = up;
    }
    return holder;
  };
  const nodeSet = new Set<number>();
  for (const index of shownIndices) {
    const holder = holderOf(index);
    if (holder !== index) holders.set(index, holder);
    nodeSet.add(holder);
  }
  const regionSet = new Set<number>();
  if (universe.tree) {
    for (const index of nodeSet) {
      for (let up = universe.parentOf[index] ?? -1; up >= 0; up = universe.parentOf[up] ?? -1) {
        if (regionSet.has(up)) break;
        if (exists(up)) regionSet.add(up);
      }
    }
  }
  const nodes = Int32Array.from([...nodeSet].filter((index) => !regionSet.has(index))).sort();
  const regions = Int32Array.from(regionSet).sort();
  const count = nodes.length;
  const nodeAt = new Map<number, number>();
  nodes.forEach((index, at) => nodeAt.set(index, at));
  const nodeEmphasis = new Float32Array(count);
  const nodeGlow = new Float32Array(count);
  const nodeFlags = new Uint8Array(count);
  const nodeSlot = new Int8Array(count).fill(-1);
  const nodeDegree = new Float32Array(count);
  const nodeMembers = new Float32Array(count);
  const nodeGlyph: Array<string> = Array.from({ length: count }, () => "");
  /** Each closed container's leaves: how many, and their kind while they share one (null once mixed). */
  const leaves = new Map<number, { count: number; kind: string | null }>();
  const risen = new Set<number>();
  // Each shown reading note, drawn as itself or folded into its closed container.
  for (const index of shownIndices) {
    const holder = holders.get(index) ?? index;
    const at = nodeAt.get(holder);
    if (at === undefined) continue;
    const id = universe.nodes[index]?.id ?? "";
    const note = state.byId.get(id);
    const own = holder === index;
    const worked = reading?.now.has(id) === true;
    let value = emphasis.get(id) ?? 0;
    let flags = 0;
    if (note?.frontier === true) {
      if (own) flags |= NodeFlag.frontier;
      if (!worked && id !== picked) value = Math.min(value, Emphasis.frontier);
    }
    const mark = reading?.noteMarks.get(id)?.mark;
    if (mark === "new") flags |= own ? NodeFlag.new : NodeFlag.amended;
    if (mark === "amended") flags |= NodeFlag.amended;
    if (id === picked) flags |= NodeFlag.picked;
    if (matches.has(id)) flags |= NodeFlag.match;
    nodeEmphasis[at] = Math.max(nodeEmphasis[at] ?? 0, value);
    nodeFlags[at] = (nodeFlags[at] ?? 0) | flags;
    if (own) {
      const now = reading?.noteMarks.get(id);
      const glyph =
        input.removedNow?.has(id) === true
          ? VERB_GLYPH.remove
          : now === undefined || now.turn !== reading?.checkpoint
            ? ""
            : now.mark === "new"
              ? VERB_GLYPH.write
              : VERB_GLYPH.amend;
      // A closed container's own mark does not hide what its members say.
      if (glyph !== "" || (nodeGlyph[at] ?? "") === "") nodeGlyph[at] = glyph;
      nodeDegree[at] = state.degree.get(id) ?? 0;
      nodeSlot[at] = placement.noteSlot.get(id) ?? -1;
    } else {
      nodeMembers[at] = (nodeMembers[at] ?? 0) + 1;
      if ((universe.childrenOf[index]?.length ?? 0) === 0) {
        const kind = universe.nodes[index]?.kind ?? "note";
        const tally = leaves.get(at);
        if (tally === undefined) leaves.set(at, { count: 1, kind });
        else {
          tally.count += 1;
          if (tally.kind !== kind) tally.kind = null;
        }
      }
      // A closed container carries what its turn did inside: written beats amended.
      const inside = reading?.noteMarks.get(id);
      if (
        inside !== undefined &&
        inside.turn === reading?.checkpoint &&
        nodeGlyph[at] !== VERB_GLYPH.write
      ) {
        nodeGlyph[at] = inside.mark === "new" ? VERB_GLYPH.write : VERB_GLYPH.amend;
      }
    }
    if (worked) {
      nodeGlow[at] = 1;
      risen.add(holder);
    }
  }
  // A closed container is new only when it is itself new; its members' marks make it amended.
  nodes.forEach((index, at) => {
    if ((nodeMembers[at] ?? 0) > 0 && ((nodeFlags[at] ?? 0) & NodeFlag.new) !== 0) {
      nodeFlags[at] = (nodeFlags[at] ?? 0) & ~NodeFlag.amended;
    }
    if (picked !== null && universe.nodes[index]?.id === picked) {
      nodeFlags[at] = (nodeFlags[at] ?? 0) | NodeFlag.picked;
    }
  });

  // The edges among the shown things. Each link between reading notes draws
  // between the things that show for its ends: itself when both ends show,
  // else the pair's aggregate edge (one per pair of shown things, carrying how
  // many links it stands for); a link inside one closed container draws none.
  const shownSet = new Set(shownIndices);
  const drawn = new Map<number, EdgeTally>();
  for (const index of shownIndices) {
    for (const edgeIndex of universe.edgesOf[index] ?? []) {
      const edge = universe.edges[edgeIndex];
      if (edge === undefined || edge.aggregate || edge.a !== index || !shownSet.has(edge.b))
        continue;
      const a = holders.get(edge.a) ?? edge.a;
      const b = holders.get(edge.b) ?? edge.b;
      if (a === b || !nodeAt.has(a) || !nodeAt.has(b)) continue;
      const own = a === edge.a && b === edge.b;
      if (edge.lensOnly) {
        if (!own) continue;
        const slot = placement.edgeSlot.get(edge.key) ?? -1;
        if (slot >= 0) drawn.set(edgeIndex, lensTally(slot));
        continue;
      }
      const tally = edgeTally(universe, state, reading, placement, edgeIndex, layered);
      if (tally === null) continue;
      if (own) {
        mergeTally(drawn, edgeIndex, tally, false);
        continue;
      }
      const at = universe.edgeIndexOf.get(
        pairKey(universe.nodes[a]?.id ?? "", universe.nodes[b]?.id ?? ""),
      );
      const target = at === undefined ? undefined : universe.edges[at];
      if (at === undefined || target === undefined) continue;
      mergeTally(drawn, at, target.a === a ? tally : flipTally(tally), true);
    }
  }
  const kept = [...drawn.keys()].sort((left, right) => left - right);
  const current: Array<number> = [];
  const kinds: Array<number> = [];
  const slots: Array<number> = [];
  const directions: Array<number> = [];
  const newWays: Array<number> = [];
  const edgeLinkCount: Array<number> = [];
  const edgeLinkKind: Array<string | undefined> = [];
  for (const index of kept) {
    const tally = drawn.get(index);
    if (tally === undefined) continue;
    current.push(tally.current);
    kinds.push(tally.kind);
    slots.push(tally.slot);
    newWays.push(tally.ways);
    // EdgeMark's heuristic (1) and directed (2) sit just above the ways.
    const marks =
      (tally.guessed ? EdgeMark.heuristic : 0) | (tally.directed ? EdgeMark.directed : 0);
    directions.push(tally.direction | (marks << 2) | flowBits(tally, features));
    edgeLinkCount.push(tally.count);
    edgeLinkKind.push(dominantKind(tally.kinds));
  }

  // Structure: inside a container opened past the landing's level, the edges that stood among what shows.
  const opened = universe.tree ? (input.opened ?? NO_CLOSED) : NO_CLOSED;
  const insideOpened = (index: number) => {
    for (let up = universe.parentOf[index] ?? -1; up >= 0; up = universe.parentOf[up] ?? -1) {
      if (opened.has(up)) return up;
    }
    return -1;
  };
  const structure = kept.map((index, at) => {
    const edge = universe.edges[index];
    if (opened.size === 0 || edge === undefined || current[at] === 1) return 0;
    if (kinds[at] === EdgeKind.broken) return 0;
    const holder = insideOpened(edge.a);
    return holder >= 0 && holder === insideOpened(edge.b) ? 1 : 0;
  });

  // The turn's story: what it wrote or amended, and the ends of the links it added.
  const story = new Set<number>();
  if (reading !== null) {
    for (const [id, mark] of reading.noteMarks) {
      const index = universe.indexOf.get(id);
      if (mark.turn !== reading.checkpoint || index === undefined) continue;
      // A story note inside a closed container makes the container the story's.
      const holder = holders.get(index) ?? index;
      if (nodeAt.has(holder)) story.add(holder);
    }
    kept.forEach((index, at) => {
      const edge = universe.edges[index];
      if (edge === undefined || current[at] !== 1 || kinds[at] !== EdgeKind.new) return;
      story.add(edge.a);
      story.add(edge.b);
    });
  }

  let focus: ReadingView["focus"] = null;
  const pickedIndex = picked === null ? undefined : universe.indexOf.get(picked);
  if (picked !== null && pickedIndex !== undefined && nodeAt.has(pickedIndex)) {
    // A closed container's neighbours are what its drawn edges reach.
    const neighbors =
      (nodeMembers[nodeAt.get(pickedIndex) ?? -1] ?? 0) > 0
        ? kept.flatMap((index) => {
            const edge = universe.edges[index];
            if (edge === undefined || (edge.a !== pickedIndex && edge.b !== pickedIndex)) return [];
            return [edge.a === pickedIndex ? edge.b : edge.a];
          })
        : [...neighborsOf(state, picked)]
            .map((id) => universe.indexOf.get(id))
            .filter((index): index is number => index !== undefined && nodeAt.has(index));
    focus = { index: pickedIndex, neighbors };
  }

  // Failure flow: a shown function that throws with nothing shown above it catching.
  if (features?.failureEdges === true) {
    const shown = shownLinks(
      universe,
      { nodes, edges: kept, nodeAt },
      (link) => reading === null || reading.linkStands(link),
      (link) => (reading === null ? link.resolution : reading.linkResolution(link)),
    );
    for (const index of uncaughtThrowers(shown)) {
      const at = nodeAt.get(index);
      if (at !== undefined) nodeFlags[at] = (nodeFlags[at] ?? 0) | NodeFlag.uncaught;
    }
  }

  // The declared layers, around what shows in each (the survey level only).
  const layerIndex = input.showLayers === true ? layered : undefined;
  const layers =
    layerIndex === undefined
      ? NO_LAYERS
      : layerIndex.names.flatMap((name, layer) => {
          const members = [...nodes].filter((index) => layerIndex.layerOf[index] === layer);
          return members.length === 0 ? [] : [{ name, nodes: members }];
        });

  return {
    nodes,
    nodeEmphasis,
    nodeGlow,
    nodeFlags,
    nodeSlot,
    nodeDegree,
    nodeMembers,
    nodeCount: Array.from({ length: count }, (_, at) => {
      const tally = leaves.get(at);
      return tally === undefined ? "" : countWords(tally.count, tally.kind ?? "note");
    }),
    nodeGlyph,
    nodeAt,
    holders,
    edges: Int32Array.from(kept),
    edgeCurrent: Uint8Array.from(current),
    edgeKind: Uint8Array.from(kinds),
    edgeSlot: Int8Array.from(slots),
    edgeDirection: Uint8Array.from(directions),
    edgeNewWays: Uint8Array.from(newWays),
    edgeStructure: Uint8Array.from(structure),
    edgeLinkCount: Uint16Array.from(edgeLinkCount),
    edgeLinkKind,
    focus,
    risen: [...risen].filter((index) => nodeAt.has(index)).sort((left, right) => left - right),
    story: [...story].filter((index) => nodeAt.has(index)).sort((left, right) => left - right),
    regions,
    layers,
    ...(input.quietAncestors === true ? { quietAncestors: true } : {}),
    shownNodes: nodes.length,
    shownEdges: kept.length,
    searching: normalizeQuery(input.filters.search).length > 0,
  };
}

/** A view laid out over the universe itself, index for index: the dense form tests read. */
export const denseView = (input: ViewInput): GraphView => {
  const view = deriveView(input);
  return {
    ...expandView(view, input.universe.nodes.length, input.universe.edges.length),
    nodeShape: Uint8Array.from(input.universe.nodes, (node) => kindShape(node.kind)),
    regions: regionShapes(view, input.universe, (index) => index),
  };
};
