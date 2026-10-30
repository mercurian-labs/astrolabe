/**
 * The notes and edges a view shows, each in a slot of the renderer's own; every renderer buffer is
 * sized to its slots, never to the memory. A note keeps its slot while it shows and while it fades
 * out, so it never re-glides. Capacity grows with headroom and compacts when well under, and the
 * renderer is told where each kept note moved from.
 */
import { nodeShape } from "../model/kinds.ts";
import type { PlayFocus } from "../model/plays.ts";
import type { Universe, UniverseEdge, UniverseNode } from "../model/universe.ts";
import {
  emptyView,
  regionShapes,
  viewDegree,
  type GraphView,
  type ReadingView,
} from "../model/view.ts";

/** What a renderer draws from: per slot, the note it holds (and its name), and each edge slot's ends as node slots. */
export interface DrawnGraph {
  readonly nodes: ReadonlyArray<UniverseNode>;
  readonly edges: ReadonlyArray<UniverseEdge>;
}

export const MIN_NODE_SLOTS = 32;
export const MIN_EDGE_SLOTS = 32;

/** The capacity for `needed` slots: half again as many for headroom, and never under `minimum`. */
export const slotCapacity = (needed: number, minimum: number) =>
  Math.max(minimum, needed + Math.max(minimum, Math.ceil(needed / 2)));

const FREE_NODE: UniverseNode = { id: "", name: "" };
const FREE_EDGE: UniverseEdge = { key: "", a: 0, b: 0, lensOnly: true, aggregate: false };

/** Slots of one kind (nodes or edges): which universe entry each holds, and which are leaving. */
class SlotTable {
  readonly #minimum: number;
  owner: Int32Array;
  readonly slotOf = new Map<number, number>();
  /** Slots whose entry left the view and is fading out. */
  readonly departing = new Set<number>();
  #free: Array<number> = [];

  constructor(minimum: number) {
    this.#minimum = minimum;
    this.owner = new Int32Array(minimum).fill(-1);
    this.#free = Array.from({ length: minimum }, (_, slot) => minimum - 1 - slot);
  }

  get capacity(): number {
    return this.owner.length;
  }

  get held(): number {
    return this.slotOf.size;
  }

  release(slot: number): void {
    const owner = this.owner[slot] ?? -1;
    if (owner < 0) return;
    this.slotOf.delete(owner);
    this.owner[slot] = -1;
    this.departing.delete(slot);
    this.#free.push(slot);
  }

  assign(owner: number): number {
    const slot = this.#free.pop();
    if (slot === undefined) throw new Error("no free slot: resize before assigning");
    this.owner[slot] = owner;
    this.slotOf.set(owner, slot);
    return slot;
  }

  /**
   * Make room for `needed` held slots: grow with headroom when short, compact
   * when four times too large. Returns, per new slot, the old slot it carries
   * (-1 for none), or null when nothing moved.
   */
  fit(needed: number): Int32Array | null {
    const capacity = this.capacity;
    const shrink = capacity > this.#minimum && needed * 4 < capacity;
    if (needed <= capacity && !shrink) return null;
    const next = slotCapacity(needed, this.#minimum);
    const from = new Int32Array(next).fill(-1);
    const owner = new Int32Array(next).fill(-1);
    const departing = new Set(this.departing);
    this.departing.clear();
    let at = 0;
    for (let slot = 0; slot < capacity; slot += 1) {
      const held = this.owner[slot] ?? -1;
      if (held < 0) continue;
      from[at] = slot;
      owner[at] = held;
      this.slotOf.set(held, at);
      if (departing.has(slot)) this.departing.add(at);
      at += 1;
    }
    this.owner = owner;
    this.#free = [];
    for (let slot = next - 1; slot >= at; slot -= 1) this.#free.push(slot);
    return from;
  }
}

/** How a view changed the slots: what a renderer must carry, reset, or clear. */
export interface SlotChange {
  /**
   * The buffers change size: per new node slot and edge slot, the old slot
   * whose state it carries (-1 for none). Null when the capacity held.
   */
  readonly resized: { readonly nodes: Int32Array; readonly edges: Int32Array } | null;
  /** Node slots that took a note this view: their state starts afresh, at the note's home. */
  readonly arrived: ReadonlyArray<number>;
  /** Edge slots that took an edge this view. */
  readonly arrivedEdges: ReadonlyArray<number>;
  /**
   * Edge slots given up this view and not taken again, to clear. Numbered in
   * the slots before any resize, which drops them anyway.
   */
  readonly releasedEdges: ReadonlyArray<number>;
  /** Node slots showing now that did not show in the last view: they rise. */
  readonly rose: ReadonlyArray<number>;
  /** Node slots that showed in the last view and now fade out. */
  readonly left: ReadonlyArray<number>;
}

/** Whether a slot's fade-out has finished, as the renderer's state has it. */
export interface Faded {
  node(slot: number): boolean;
  edge(slot: number): boolean;
}

export class WorkingSet {
  universe: Universe;
  readonly #nodes = new SlotTable(MIN_NODE_SLOTS);
  readonly #edges = new SlotTable(MIN_EDGE_SLOTS);
  /** What the renderer draws from, per slot. */
  readonly graph: { nodes: Array<UniverseNode>; edges: Array<UniverseEdge> } = {
    nodes: Array.from({ length: MIN_NODE_SLOTS }, () => FREE_NODE),
    edges: Array.from({ length: MIN_EDGE_SLOTS }, () => FREE_EDGE),
  };
  /** Each node slot's name, for labels. */
  names: Array<string> = Array.from({ length: MIN_NODE_SLOTS }, () => "");
  /** Each node slot's edge slots, for hover. */
  edgesOf: Array<Array<number>> = [];
  /** The last view, laid out over the slots. */
  view: GraphView = emptyView(MIN_NODE_SLOTS, MIN_EDGE_SLOTS);
  #shown: ReadingView | null = null;
  /** The degree each node slot last showed with: a note fading out keeps its size. */
  #degree = new Float32Array(MIN_NODE_SLOTS);

  constructor(universe: Universe) {
    this.universe = universe;
  }

  get capacity(): number {
    return this.#nodes.capacity;
  }

  /**
   * Hold the same slots over `universe`, which grew from the one held (see
   * `grewFrom`): every index a slot holds names the same note there, so
   * nothing moves; the next `apply` seats what is new.
   */
  grow(universe: Universe): void {
    this.universe = universe;
  }

  get edgeCapacity(): number {
    return this.#edges.capacity;
  }

  /** Node slots holding a note, showing or fading. */
  get held(): number {
    return this.#nodes.held;
  }

  /** The note (universe index) node slot `slot` holds, or -1. */
  nodeOf(slot: number): number {
    return this.#nodes.owner[slot] ?? -1;
  }

  /** The node slot note `index` holds, or -1. */
  slotOf(index: number): number {
    return this.#nodes.slotOf.get(index) ?? -1;
  }

  edgeOf(slot: number): number {
    return this.#edges.owner[slot] ?? -1;
  }

  edgeSlotOf(index: number): number {
    return this.#edges.slotOf.get(index) ?? -1;
  }

  /** Universe indices to the slots of those that hold one. */
  slotsOf(indices: ReadonlyArray<number>): Array<number> {
    const slots: Array<number> = [];
    for (const index of indices) {
      const slot = this.slotOf(index);
      if (slot >= 0) slots.push(slot);
    }
    return slots;
  }

  /** The degree note `index` shows with in the current view (0 when it does not show). */
  degreeOf(index: number): number {
    const view = this.#shown;
    const at = view?.nodeAt.get(index);
    return at === undefined || view === null ? 0 : viewDegree(view, at);
  }

  /** A play in slot terms: its notes' and links' slots (a link whose edge holds no slot is dropped). */
  playInSlots(play: PlayFocus | null): PlayFocus | null {
    if (play === null) return null;
    return {
      ...play,
      nodes: this.slotsOf(play.nodes),
      links: play.links
        .map((link) => ({ ...link, edge: this.edgeSlotOf(link.edge) }))
        .filter((link) => link.edge >= 0),
      ...(play.quiet === undefined
        ? {}
        : {
            quiet: play.quiet.map((edge) => this.edgeSlotOf(edge)).filter((edge) => edge >= 0),
          }),
    };
  }

  /**
   * Hold `view`'s notes and edges in slots: release what has faded, keep what
   * stays, make room, and seat what arrives. The view laid out over the slots
   * becomes `this.view`; the change says what the renderer's state must do.
   */
  apply(view: ReadingView, faded: Faded): SlotChange {
    const { universe } = this;
    const nodes = this.#nodes;
    const edges = this.#edges;
    const wasShowing = new Set<number>();
    const before = this.view;
    for (let slot = 0; slot < before.nodeVisible.length; slot += 1) {
      if (before.nodeVisible[slot] === 1) wasShowing.add(slot);
    }

    // Leaving: whatever held a slot and is not in this view fades, and gives
    // its slot up once faded. An edge goes with either of its ends.
    const releasedNodes = new Set<number>();
    for (const [index, slot] of nodes.slotOf) {
      if (view.nodeAt.has(index)) {
        nodes.departing.delete(slot);
        continue;
      }
      nodes.departing.add(slot);
      if (faded.node(slot)) releasedNodes.add(slot);
    }
    const shownEdges = new Set(view.edges);
    const releasedEdges: Array<number> = [];
    for (const [index, slot] of edges.slotOf) {
      const edge = universe.edges[index];
      const endGone =
        edge === undefined ||
        releasedNodes.has(this.slotOf(edge.a)) ||
        releasedNodes.has(this.slotOf(edge.b));
      if (shownEdges.has(index) && !endGone) {
        edges.departing.delete(slot);
        continue;
      }
      edges.departing.add(slot);
      if (endGone || faded.edge(slot)) releasedEdges.push(slot);
    }
    for (const slot of releasedEdges) edges.release(slot);
    for (const slot of releasedNodes) nodes.release(slot);

    // Arriving: room first, then a slot each.
    const newNodes: Array<number> = [];
    for (const index of view.nodes) if (!nodes.slotOf.has(index)) newNodes.push(index);
    const newEdges: Array<number> = [];
    for (const index of view.edges) if (!edges.slotOf.has(index)) newEdges.push(index);
    const nodeFrom = nodes.fit(nodes.held + newNodes.length);
    const edgeFrom = edges.fit(edges.held + newEdges.length);
    const arrived = newNodes.map((index) => nodes.assign(index));
    const arrivedEdges = newEdges.map((index) => edges.assign(index));
    const resized =
      nodeFrom === null && edgeFrom === null
        ? null
        : {
            nodes: nodeFrom ?? identity(nodes.capacity),
            edges: edgeFrom ?? identity(edges.capacity),
          };

    // The slot graph and the dense view.
    if (resized !== null) {
      this.graph.nodes = Array.from({ length: nodes.capacity }, () => FREE_NODE);
      this.graph.edges = Array.from({ length: edges.capacity }, () => FREE_EDGE);
      this.names = Array.from({ length: nodes.capacity }, () => "");
      const degree = new Float32Array(nodes.capacity);
      resized.nodes.forEach((old, slot) => {
        if (old >= 0) degree[slot] = this.#degree[old] ?? 0;
      });
      this.#degree = degree;
    }
    for (let slot = 0; slot < nodes.capacity; slot += 1) {
      const owner = nodes.owner[slot] ?? -1;
      const node = universe.nodes[owner] ?? FREE_NODE;
      this.graph.nodes[slot] = node;
      // The checkpoint's glyph ("+ name", "~ name") is part of the label's text in every label
      // path, and a closed container says what it holds ("web · 190 files").
      const at = view.nodeAt.get(owner) ?? -1;
      const glyph = view.nodeGlyph[at] ?? "";
      const count = view.nodeCount?.[at] ?? "";
      const name = count === "" ? node.name : `${node.name} · ${count}`;
      this.names[slot] = glyph === "" ? name : `${glyph} ${name}`;
    }
    const edgesOf: Array<Array<number>> = Array.from({ length: nodes.capacity }, () => []);
    for (let slot = 0; slot < edges.capacity; slot += 1) {
      const edge = universe.edges[edges.owner[slot] ?? -1];
      if (edge === undefined) {
        this.graph.edges[slot] = FREE_EDGE;
        continue;
      }
      const a = this.slotOf(edge.a);
      const b = this.slotOf(edge.b);
      this.graph.edges[slot] = {
        key: edge.key,
        a,
        b,
        lensOnly: edge.lensOnly,
        aggregate: edge.aggregate,
      };
      edgesOf[a]?.push(slot);
      edgesOf[b]?.push(slot);
    }
    this.edgesOf = edgesOf;
    const dense = emptyView(nodes.capacity, edges.capacity);
    view.nodes.forEach((index, at) => {
      const slot = this.slotOf(index);
      dense.nodeVisible[slot] = 1;
      dense.nodeEmphasis[slot] = view.nodeEmphasis[at] ?? 0;
      dense.nodeGlow[slot] = view.nodeGlow[at] ?? 0;
      dense.nodeFlags[slot] = view.nodeFlags[at] ?? 0;
      dense.nodeSlot[slot] = view.nodeSlot[at] ?? -1;
      this.#degree[slot] = viewDegree(view, at);
    });
    dense.nodeDegree.set(this.#degree);
    // A slot keeps its note's shape while the note leaves, so nothing changes shape as it fades.
    this.graph.nodes.forEach((node, slot) => {
      dense.nodeShape[slot] = nodeShape(node);
    });
    view.edges.forEach((index, at) => {
      const slot = this.edgeSlotOf(index);
      dense.edgeVisible[slot] = 1;
      dense.edgeCurrent[slot] = view.edgeCurrent[at] ?? 0;
      dense.edgeKind[slot] = view.edgeKind[at] ?? 0;
      dense.edgeSlot[slot] = view.edgeSlot[at] ?? -1;
      dense.edgeDirection[slot] = view.edgeDirection[at] ?? 0;
      dense.edgeNewWays[slot] = view.edgeNewWays[at] ?? 0;
      dense.edgeStructure[slot] = view.edgeStructure[at] ?? 0;
    });
    this.view = {
      ...dense,
      focus:
        view.focus === null
          ? null
          : { index: this.slotOf(view.focus.index), neighbors: this.slotsOf(view.focus.neighbors) },
      risen: this.slotsOf(view.risen),
      story: this.slotsOf(view.story),
      regions: regionShapes(view, this.universe, (index) => this.slotOf(index)),
      shownNodes: view.shownNodes,
      shownEdges: view.shownEdges,
      searching: view.searching,
    };
    this.#shown = view;

    // Which slots rise and which fade: by note, across any renumbering.
    const movedTo = new Map<number, number>();
    resized?.nodes.forEach((old, slot) => {
      if (old >= 0) movedTo.set(old, slot);
    });
    const showing = new Set<number>();
    for (const slot of wasShowing) {
      const moved = resized === null ? slot : (movedTo.get(slot) ?? -1);
      if (moved >= 0) showing.add(moved);
    }
    const rose: Array<number> = [];
    const left: Array<number> = [];
    for (let slot = 0; slot < nodes.capacity; slot += 1) {
      const now = this.view.nodeVisible[slot] === 1;
      if (now && !showing.has(slot)) rose.push(slot);
      if (!now && showing.has(slot)) left.push(slot);
    }
    return { resized, arrived, arrivedEdges, releasedEdges, rose, left };
  }
}

function identity(length: number): Int32Array {
  return Int32Array.from({ length }, (_, slot) => slot);
}
