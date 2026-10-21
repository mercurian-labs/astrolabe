import { describe, expect, it } from "vite-plus/test";

import { NodeShape } from "../model/kinds.ts";
import type { Memory } from "../model/memory.ts";
import { buildUniverse, type Universe } from "../model/universe.ts";
import type { ReadingView } from "../model/view.ts";
import { MIN_NODE_SLOTS, slotCapacity, WorkingSet, type Faded } from "./workingSet.ts";

/** A memory of `count` notes in a chain, each linked to the next. */
function chain(count: number): Universe {
  const notes = Array.from({ length: count }, (_, index) => ({
    id: `n${String(index).padStart(6, "0")}`,
    name: `Note ${index}`,
    frontier: false,
  }));
  const links = notes
    .slice(1)
    .map((note, index) => ({ from: notes[index]?.id ?? "", to: note.id }));
  const memory: Memory = { id: `chain-${count}`, notes, links, lenses: [] };
  return buildUniverse(memory.id, memory);
}

/** A view showing `nodes` (universe indices) and every chain edge between them. */
function showing(universe: Universe, nodes: ReadonlyArray<number>): ReadingView {
  const sorted = Int32Array.from(nodes).sort();
  const nodeAt = new Map([...sorted].map((index, at) => [index, at]));
  const edges: Array<number> = [];
  for (const index of sorted) {
    for (const edge of universe.edgesOf[index] ?? []) {
      const { a, b } = universe.edges[edge] ?? { a: -1, b: -1 };
      if (a === index && nodeAt.has(b)) edges.push(edge);
    }
  }
  const n = sorted.length;
  const e = edges.length;
  return {
    nodes: sorted,
    nodeEmphasis: new Float32Array(n).fill(1),
    nodeGlow: new Float32Array(n),
    nodeFlags: new Uint8Array(n),
    nodeSlot: new Int8Array(n).fill(-1),
    nodeDegree: new Float32Array(n).fill(2),
    nodeMembers: new Float32Array(n),
    nodeGlyph: [],
    nodeAt,
    holders: new Map(),
    edges: Int32Array.from(edges).sort(),
    edgeCurrent: new Uint8Array(e),
    edgeKind: new Uint8Array(e),
    edgeSlot: new Int8Array(e).fill(-1),
    edgeDirection: new Uint8Array(e),
    edgeNewWays: new Uint8Array(e),
    edgeStructure: new Uint8Array(e),
    edgeLinkCount: new Uint16Array(e).fill(1),
    edgeLinkKind: [],
    focus: null,
    risen: [],
    story: [],
    regions: new Int32Array(0),
    layers: [],
    shownNodes: n,
    shownEdges: e,
    searching: false,
  };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, at) => from + at);
const fadedWhen = (done: boolean): Faded => ({ node: () => done, edge: () => done });

describe("WorkingSet", () => {
  it("keeps a note's slot for as long as it shows, and seats a new note in a free slot", () => {
    const universe = chain(100);
    const slots = new WorkingSet(universe);
    slots.apply(showing(universe, [1, 2, 3]), fadedWhen(false));
    const before = [1, 2, 3].map((note) => slots.slotOf(note));
    const change = slots.apply(showing(universe, [2, 3, 4]), fadedWhen(false));
    expect(slots.slotOf(2)).toBe(before[1]);
    expect(slots.slotOf(3)).toBe(before[2]);
    expect(change.arrived).toEqual([slots.slotOf(4)]);
    expect(change.resized).toBeNull();
    // The slot graph names each slot's note, and draws each edge between the notes' slots.
    expect(slots.graph.nodes[slots.slotOf(4)]?.id).toBe(universe.nodes[4]?.id);
    const edge =
      slots.graph.edges[
        slots.edgeSlotOf(
          universe.edgeIndexOf.get(`${universe.nodes[3]?.id}\u0000${universe.nodes[4]?.id}`) ?? -1,
        )
      ];
    expect([edge?.a, edge?.b]).toEqual([slots.slotOf(3), slots.slotOf(4)]);
  });

  it("holds a leaving note's slot while it fades, gives it up after, and seats the next note there", () => {
    const universe = chain(100);
    const slots = new WorkingSet(universe);
    slots.apply(showing(universe, [1, 2]), fadedWhen(false));
    const slot = slots.slotOf(1);
    // Note 1 leaves; its fade has not finished.
    const leaving = slots.apply(showing(universe, [2]), fadedWhen(false));
    expect(leaving.left).toEqual([slot]);
    expect(slots.slotOf(1)).toBe(slot);
    expect(slots.view.nodeVisible[slot]).toBe(0);
    // A note that returns before its fade finished takes up its own slot again: it rises in place.
    const back = slots.apply(showing(universe, [1, 2]), fadedWhen(false));
    expect(slots.slotOf(1)).toBe(slot);
    expect(back.arrived).toEqual([]);
    expect(back.rose).toEqual([slot]);
    // It leaves again and fades out: the slot is free, and the next arrival takes it.
    slots.apply(showing(universe, [2]), fadedWhen(false));
    const faded = slots.apply(showing(universe, [2, 50]), fadedWhen(true));
    expect(slots.slotOf(1)).toBe(-1);
    expect(slots.slotOf(50)).toBe(slot);
    expect(faded.arrived).toEqual([slot]);
  });

  it("gives each slot its note's shape, and keeps it while the note fades out", () => {
    const memory: Memory = {
      id: "shapes",
      notes: [
        { id: "a.ts", name: "a.ts", frontier: false, kind: "file" },
        { id: "a.ts#I", name: "I", frontier: false, kind: "interface", parent: "a.ts" },
        { id: "a.ts#T", name: "T", frontier: false, kind: "type", parent: "a.ts" },
      ],
      links: [{ from: "a.ts#I", to: "a.ts#T" }],
      lenses: [],
    };
    const universe = buildUniverse(memory.id, memory);
    const index = (id: string) => universe.indexOf.get(id) ?? -1;
    const slots = new WorkingSet(universe);
    slots.apply(showing(universe, [index("a.ts#I"), index("a.ts#T")]), fadedWhen(false));
    const shape = (id: string) => slots.view.nodeShape[slots.slotOf(index(id))];
    expect([shape("a.ts#I"), shape("a.ts#T")]).toEqual([NodeShape.diamond, NodeShape.triangle]);
    // T leaves: its slot still draws a triangle while it fades.
    slots.apply(showing(universe, [index("a.ts#I")]), fadedWhen(false));
    expect(slots.view.nodeVisible[slots.slotOf(index("a.ts#T"))]).toBe(0);
    expect(shape("a.ts#T")).toBe(NodeShape.triangle);
    // A vault's notes are circles.
    const plain = chain(4);
    const vault = new WorkingSet(plain);
    vault.apply(showing(plain, [0, 1, 2, 3]), fadedWhen(false));
    expect([...vault.view.nodeShape].every((each) => each === NodeShape.circle)).toBe(true);
  });

  it("sizes its slots to the view, never to the memory", () => {
    const universe = chain(100_000);
    const slots = new WorkingSet(universe);
    const change = slots.apply(showing(universe, range(40_000, 40_050)), fadedWhen(false));
    expect(slots.capacity).toBeLessThanOrEqual(slotCapacity(50, MIN_NODE_SLOTS));
    expect(slots.capacity).toBeLessThan(200);
    expect(change.resized?.nodes.length).toBe(slots.capacity);
    expect(slots.view.nodeVisible.length).toBe(slots.capacity);
    expect(slots.graph.nodes.length).toBe(slots.capacity);
    // A step within the headroom reallocates nothing.
    const step = slots.apply(showing(universe, range(40_010, 40_070)), fadedWhen(false));
    expect(step.resized).toBeNull();
  });

  it("compacts when what shows shrinks far below its slots, each kept note carried to its new slot", () => {
    const universe = chain(2000);
    const slots = new WorkingSet(universe);
    slots.apply(showing(universe, range(0, 600)), fadedWhen(false));
    const grown = slots.capacity;
    const kept = [5, 17, 300];
    const before = kept.map((note) => slots.slotOf(note));
    const change = slots.apply(showing(universe, kept), fadedWhen(true));
    expect(slots.capacity).toBeLessThan(grown / 4);
    expect(change.resized).not.toBeNull();
    kept.forEach((note, at) => {
      const now = slots.slotOf(note);
      expect(change.resized?.nodes[now]).toBe(before[at]);
      expect(slots.nodeOf(now)).toBe(note);
    });
    // Nothing kept rises or leaves for the renumbering alone.
    expect(change.rose).toEqual([]);
  });
});
