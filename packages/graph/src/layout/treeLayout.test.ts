import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { syntheticMemory } from "../../fixtures/synthetic.ts";
import { syntheticThread } from "../../fixtures/syntheticThread.ts";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import { syntheticTree } from "../../fixtures/syntheticTree.ts";
import type { Memory } from "../model/memory.ts";
import { readingAt, threadIndex, threadUniverse } from "../model/reading.ts";
import { NO_FILTERS } from "../model/search.ts";
import { DEFAULT_SETTINGS } from "../model/settings.ts";
import type { ThreadRecord } from "../model/thread.ts";
import { buildUniverse, type Universe } from "../model/universe.ts";
import { deriveView, EdgeDirection, regionShapes } from "../model/view.ts";
import {
  collisionRadius,
  layoutSpan,
  layoutUniverse,
  medianNearestNeighbour,
  readingRadius,
  type GraphLayout,
} from "./forceLayout.ts";
import { GatheringCache, type GatherContext } from "./gatheredReading.ts";
import { GROUP_PAD } from "./gathering.ts";
import { homeLayout } from "./homeLayout.ts";
import { settleLevel } from "./treeLayout.ts";

const tree = syntheticTree({ folders: 4, filesPerFolder: 5, symbolsPerFile: 8 });
const treeThread = syntheticThread(tree, { checkpoints: 12 });
const treeUniverse = (memory: Memory, thread: ThreadRecord) =>
  buildUniverse("tree", threadUniverse(memory, thread), threadIndex(memory, thread));
const layoutOf = (universe: Universe, dimensions: 2 | 3) =>
  homeLayout(universe, DEFAULT_SETTINGS, dimensions, () =>
    layoutUniverse(universe, DEFAULT_SETTINGS, 3),
  );
const point = (positions: Float32Array | ReadonlyMap<number, readonly number[]>, index: number) =>
  positions instanceof Float32Array
    ? [positions[index * 3] ?? 0, positions[index * 3 + 1] ?? 0, positions[index * 3 + 2] ?? 0]
    : [...(positions.get(index) ?? [0, 0, 0])];
const distance = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

/** Every leaf under `note`, by universe index. */
function leavesUnder(universe: Universe, note: number): Array<number> {
  const children = universe.childrenOf[note] ?? [];
  return children.length === 0 ? [note] : children.flatMap((child) => leavesUnder(universe, child));
}

describe("a containment tree's notes", () => {
  it("sit in their parents, whatever group they also carry", () => {
    // Every note claims a group that cuts across the folders: the parent decides.
    const crossed: Memory = {
      ...tree,
      notes: tree.notes.map((note, index) => ({ ...note, group: `g${index % 3}` })),
    };
    const universe = treeUniverse(crossed, treeThread);
    expect(universe.tree).toBe(true);
    for (const note of crossed.notes) {
      const at = universe.indexOf.get(note.id) ?? -1;
      const parent = universe.parentOf[at] ?? -1;
      expect(parent < 0 ? undefined : universe.nodes[parent]?.id).toBe(note.parent);
    }
  });

  it("never loop: a parent cycle or an unknown parent is cut, so every walk up ends", () => {
    const looped: Memory = {
      id: "loops",
      notes: [
        { id: "a", name: "a", frontier: false, parent: "b" },
        { id: "b", name: "b", frontier: false, parent: "c" },
        { id: "c", name: "c", frontier: false, parent: "a" },
        { id: "d", name: "d", frontier: false, parent: "d" },
        { id: "e", name: "e", frontier: false, parent: "missing" },
        { id: "f", name: "f", frontier: false, parent: "a" },
      ],
      links: [{ from: "f", to: "e" }],
      lenses: [],
    };
    const universe = buildUniverse("loops", looped);
    universe.nodes.forEach((_, note) => {
      const seen = new Set<number>();
      for (let at = note; at >= 0; at = universe.parentOf[at] ?? -1) {
        expect(seen.has(at)).toBe(false);
        seen.add(at);
      }
    });
    expect(universe.parentOf[universe.indexOf.get("e") ?? -1]).toBe(-1);
    expect(universe.parentOf[universe.indexOf.get("d") ?? -1]).toBe(-1);
    // The layout and the gathering of a once-looping tree finish.
    expect(layoutOf(universe, 2).positions.length).toBe(universe.nodes.length * 3);
  });

  it("know no containers in a plain memory", () => {
    const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
    expect(universe.tree).toBe(false);
    expect(universe.parentOf.every((parent) => parent === -1)).toBe(true);
  });
});

describe("the hierarchical home layout", () => {
  const universe = treeUniverse(tree, treeThread);
  for (const dimensions of [2, 3] as const) {
    const layout: GraphLayout = layoutOf(universe, dimensions);
    const leafRadius = (note: number) =>
      collisionRadius(
        universe.index.degree.get(universe.nodes[note]?.id ?? "") ?? 0,
        DEFAULT_SETTINGS.linkDistance,
      );
    // How far a container's notes reach from its place: the disc they fill.
    const reach = (note: number) =>
      Math.max(
        ...leavesUnder(universe, note).map(
          (leaf) =>
            distance(point(layout.positions, leaf), point(layout.positions, note)) +
            leafRadius(leaf),
        ),
      );

    it(`places each container at the middle of its children (${dimensions}D)`, () => {
      universe.childrenOf.forEach((children, note) => {
        if (children.length === 0) return;
        const middle = [0, 1, 2].map(
          (axis) =>
            children.reduce((sum, child) => sum + (point(layout.positions, child)[axis] ?? 0), 0) /
            children.length,
        );
        expect(distance(middle, point(layout.positions, note))).toBeLessThan(1e-3);
      });
    });

    it(`keeps sibling containers' discs apart at every level (${dimensions}D)`, () => {
      const levels = new Map<number, Array<number>>();
      universe.parentOf.forEach((parent, note) => {
        if ((universe.childrenOf[note] ?? []).length === 0) return;
        levels.set(parent, [...(levels.get(parent) ?? []), note]);
      });
      let pairs = 0;
      for (const siblings of levels.values()) {
        siblings.forEach((a, slot) => {
          for (const b of siblings.slice(slot + 1)) {
            pairs += 1;
            const apart = distance(point(layout.positions, a), point(layout.positions, b));
            expect(apart).toBeGreaterThanOrEqual(reach(a) + reach(b) - 1e-3);
          }
        });
      }
      expect(pairs).toBeGreaterThan(0);
    });
  }
});

describe("regions", () => {
  const universe = treeUniverse(tree, treeThread);
  const view = (memory: Memory, thread: ThreadRecord, of: Universe, checkpoint: number) =>
    deriveView({
      universe: of,
      lenses: [],
      shownLensSlots: [],
      reading: readingAt(memory, thread, checkpoint, { depth: 0, thisTurnOnly: false }),
      whole: false,
      pickedId: null,
      depth: 0,
      filters: NO_FILTERS,
    });

  it("open exactly the containers above shown notes, which are not themselves nodes", () => {
    for (const checkpoint of [0, 5, 11]) {
      const reading = view(tree, treeThread, universe, checkpoint);
      const shown = new Set(reading.nodes);
      const above = new Set<number>();
      for (const note of reading.nodes) {
        for (let at = universe.parentOf[note] ?? -1; at >= 0; at = universe.parentOf[at] ?? -1) {
          above.add(at);
        }
      }
      expect(new Set(reading.regions)).toEqual(above);
      for (const region of reading.regions) expect(shown.has(region)).toBe(false);
      // Every shape holds shown notes, directly or through its inner regions.
      for (const shape of regionShapes(reading, universe, (index) => index)) {
        expect(shape.nodes.length + shape.inner.length).toBeGreaterThan(0);
      }
    }
  });

  it("are none in a plain memory or a synthetic one", () => {
    const plain = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
    expect(view(almagest, ATLAS_THREAD, plain, 6).regions).toHaveLength(0);
    const memory = syntheticMemory({ notes: 600 });
    const thread = syntheticThread(memory, { checkpoints: 10 });
    const synthetic = buildUniverse("synthetic", threadUniverse(memory, thread));
    expect(view(memory, thread, synthetic, 9).regions).toHaveLength(0);
  });
});

describe("the gathered reading of a containment tree", () => {
  const universe = treeUniverse(tree, treeThread);
  for (const dimensions of [2, 3] as const) {
    const layout = layoutOf(universe, dimensions);
    const context: GatherContext = {
      memory: tree,
      thread: treeThread,
      universe,
      layout,
      settings: { ...DEFAULT_SETTINGS, depth: 0 },
      thisTurnOnly: false,
      filters: NO_FILTERS,
    };
    const span = layoutSpan(layout, DEFAULT_SETTINGS.linkDistance);
    const cache = new GatheringCache();
    const clusters = treeThread.turns.map((_, checkpoint) => cache.at(context, checkpoint));

    it(`sits about as densely as the homes (${dimensions}D)`, () => {
      // A reading of a handful of notes has no meaningful median spacing.
      const measured = clusters.filter((cluster) => cluster.positions.size >= 15);
      expect(measured.length).toBeGreaterThan(5);
      for (const cluster of measured) {
        const places = new Float32Array([...cluster.positions.values()].flat());
        const ratio = medianNearestNeighbour(places) / span;
        expect(ratio).toBeGreaterThan(0.7);
        expect(ratio).toBeLessThanOrEqual(1.3);
      }
    });

    it(`keeps sibling regions from overlapping (${dimensions}D)`, () => {
      const radius = (note: number) =>
        readingRadius(
          universe.index.degree.get(universe.nodes[note]?.id ?? "") ?? 0,
          DEFAULT_SETTINGS.nodeSize,
          span,
        );
      for (const cluster of clusters) {
        const members = [...cluster.positions.keys()];
        // Each open container's disc, drawn as the renderer draws it: around its members and inner discs.
        const discs = new Map<number, { at: Array<number>; r: number }>();
        const disc = (note: number): { at: Array<number>; r: number } | null => {
          const known = discs.get(note);
          if (known !== undefined) return known;
          const items: Array<{ at: Array<number>; r: number }> = [];
          for (const child of universe.childrenOf[note] ?? []) {
            if (cluster.positions.has(child))
              items.push({ at: point(cluster.positions, child), r: radius(child) });
            else {
              const inner = disc(child);
              if (inner !== null) items.push(inner);
            }
          }
          if (items.length === 0) return null;
          const at = [0, 1, 2].map(
            (axis) => items.reduce((sum, item) => sum + (item.at[axis] ?? 0), 0) / items.length,
          );
          const r =
            Math.max(...items.map((item) => distance(item.at, at) + item.r)) + GROUP_PAD * span;
          const made = { at, r };
          discs.set(note, made);
          return made;
        };
        const open = new Set<number>();
        for (const member of members) {
          for (let at = universe.parentOf[member] ?? -1; at >= 0; at = universe.parentOf[at] ?? -1)
            open.add(at);
        }
        const byParent = new Map<number, Array<number>>();
        for (const note of open) {
          const parent = universe.parentOf[note] ?? -1;
          byParent.set(parent, [...(byParent.get(parent) ?? []), note]);
        }
        for (const siblings of byParent.values()) {
          siblings.forEach((a, slot) => {
            const left = disc(a);
            for (const b of siblings.slice(slot + 1)) {
              const right = disc(b);
              if (left === null || right === null) continue;
              expect(distance(left.at, right.at)).toBeGreaterThanOrEqual(left.r + right.r - 1e-3);
            }
          });
        }
      }
    });
  }
});

describe("a codebase's edges", () => {
  it("carry their marks in the direction bits: heuristic dashes, polymorphism arrowheads", () => {
    const memory: Memory = {
      ...tree,
      links: [
        ...tree.links,
        // Between two leaves: an open class is a region, and its links wait for the next level of detail.
        {
          from: "src/pkg0/mod1.ts#s5",
          to: "src/pkg0/mod0.ts#s1",
          kind: "inherits",
          resolution: "exact",
        },
      ],
    };
    const universe = buildUniverse("marks", memory);
    const reading = deriveView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: null,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    let heuristic = 0;
    reading.edges.forEach((edge, at) => {
      const links = universe.edgeLinks[edge] ?? [];
      const direction = reading.edgeDirection[at] ?? 0;
      const guessed = links.length > 0 && links.every((link) => link.resolution === "heuristic");
      expect((direction & EdgeDirection.heuristic) !== 0).toBe(guessed);
      if (guessed) heuristic += 1;
      const directed = links.some((link) => link.kind === "inherits");
      expect((direction & EdgeDirection.directed) !== 0).toBe(directed);
    });
    expect(heuristic).toBeGreaterThan(0);
    expect(
      reading.edgeDirection.some((direction) => (direction & EdgeDirection.directed) !== 0),
    ).toBe(true);
  });
});

describe("a level of the tree layout", () => {
  for (const dimensions of [2, 3] as const) {
    it(`holds two large linked containers their radii and the link gap apart (${dimensions}D)`, () => {
      const radius = 100;
      const settled = settleLevel(
        [0, 1],
        () => radius,
        (note) => `container-${note}`,
        [[0, 1]],
        DEFAULT_SETTINGS,
        dimensions,
        false,
      );
      const apart = distance(
        Array.from(settled.places.subarray(0, 3)),
        Array.from(settled.places.subarray(3, 6)),
      );
      expect(apart).toBeGreaterThanOrEqual(2 * radius + 0.35 * DEFAULT_SETTINGS.linkDistance - 1);
    });
  }
});
