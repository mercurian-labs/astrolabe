import { describe, expect, it } from "vite-plus/test";

import { syntheticMemory } from "../../fixtures/synthetic.ts";
import { readingAt, threadUniverse } from "../model/reading.ts";
import { DEFAULT_SETTINGS } from "../model/settings.ts";
import { SMALL_MEMORY, SMALL_THREAD } from "../model/testMemory.ts";
import { buildUniverse } from "../model/universe.ts";
import { LayoutCache } from "./homeLayout.ts";
import {
  collisionRadius,
  drawnRadius,
  layoutSpan,
  layoutUniverse,
  layoutUnit,
  medianNearestNeighbour,
  MAX_LAYOUT_UNIT,
  RADIUS_SHARE,
} from "./forceLayout.ts";

const universe = buildUniverse("small", threadUniverse(SMALL_MEMORY, SMALL_THREAD));

describe("layoutUniverse", () => {
  it("settles the same memory into the same shape", () => {
    const first = layoutUniverse(universe, DEFAULT_SETTINGS, 3);
    const second = layoutUniverse(universe, DEFAULT_SETTINGS, 3);
    expect([...first.positions]).toEqual([...second.positions]);
    expect(first.positions.every(Number.isFinite)).toBe(true);
  });

  it("does not depend on the order notes arrive in", () => {
    const shuffled = buildUniverse("shuffled", {
      ...SMALL_MEMORY,
      notes: SMALL_MEMORY.notes.toReversed(),
      links: SMALL_MEMORY.links.toReversed(),
    });
    const plain = buildUniverse("plain", SMALL_MEMORY);
    expect([...layoutUniverse(shuffled, DEFAULT_SETTINGS, 3).positions]).toEqual([
      ...layoutUniverse(plain, DEFAULT_SETTINGS, 3).positions,
    ]);
  });

  it("pins z to 0 for the flat reading", () => {
    const flat = layoutUniverse(universe, DEFAULT_SETTINGS, 2);
    for (let index = 0; index < universe.nodes.length; index += 1) {
      expect(flat.positions[index * 3 + 2]).toBe(0);
    }
    expect(flat.dimensions).toBe(2);
  });

  it("uses depth for the spatial reading", () => {
    const spatial = layoutUniverse(universe, DEFAULT_SETTINGS, 3);
    const depths = universe.nodes.map((_, index) => spatial.positions[index * 3 + 2] ?? 0);
    expect(depths.some((z) => Math.abs(z) > 1)).toBe(true);
  });

  // The solve runs a fixed number of ticks, so its time is not asserted: four package suites at
  // once, as CI runs them, made a ~1.6 s solve take up to 10 s. The test timeout is the ceiling.
  it("lays out a 600-note memory with no two drawn nodes overlapping at rest", () => {
    const large = buildUniverse("synthetic", syntheticMemory());
    const spatial = layoutUniverse(large, DEFAULT_SETTINGS, 3);
    const flat = layoutUniverse(large, DEFAULT_SETTINGS, 2, spatial);
    for (const layout of [spatial, flat]) {
      expect(layoutUnit(layout)).toBeLessThanOrEqual(MAX_LAYOUT_UNIT);
      const span = layoutSpan(layout, DEFAULT_SETTINGS.linkDistance);
      for (const nodeSize of [0.3, 1, 3]) {
        const radii = large.nodes.map((node) =>
          drawnRadius(
            large.index.degree.get(node.id) ?? 0,
            nodeSize,
            span,
            DEFAULT_SETTINGS.linkDistance,
          ),
        );
        const p = layout.positions;
        let overlaps = 0;
        for (let a = 0; a < radii.length; a += 1) {
          for (let b = a + 1; b < radii.length; b += 1) {
            const distance = Math.hypot(
              (p[a * 3] ?? 0) - (p[b * 3] ?? 0),
              (p[a * 3 + 1] ?? 0) - (p[b * 3 + 1] ?? 0),
              (p[a * 3 + 2] ?? 0) - (p[b * 3 + 2] ?? 0),
            );
            if (distance < (radii[a] ?? 0) + (radii[b] ?? 0)) overlaps += 1;
          }
        }
        expect({ dimensions: layout.dimensions, nodeSize, overlaps }).toEqual({
          dimensions: layout.dimensions,
          nodeSize,
          overlaps: 0,
        });
      }
    }
  });

  it("draws notes as small dots against the spacing, a hub at most 1.6 times a lone note", () => {
    const spacing = 40;
    const lone = drawnRadius(0, 1, spacing, 34);
    expect(lone).toBeCloseTo(RADIUS_SHARE * spacing);
    expect(lone).toBeLessThanOrEqual(0.14 * spacing);
    expect(drawnRadius(400, 1, spacing, 34)).toBeCloseTo(1.6 * lone);
    expect(drawnRadius(4, 1, spacing, 34)).toBeGreaterThan(lone);
  });

  it("caps a note before its degree scale at 0.14 of the spacing, whatever the node size", () => {
    expect(drawnRadius(0, 3, 40, 34)).toBeCloseTo(0.14 * 40);
    expect(drawnRadius(400, 3, 40, 34)).toBeCloseTo(0.14 * 40 * 1.6);
  });

  it("never draws a node past its collision radius, whatever the node size and spacing", () => {
    expect(drawnRadius(1, 3, 400, 34)).toBeCloseTo(collisionRadius(1, 34));
    expect(collisionRadius(1, 34)).toBeCloseTo(11.73, 2);
  });
});

describe("LayoutCache", () => {
  it("keeps positions between checkpoints: one layout serves the whole thread", () => {
    const cache = new LayoutCache();
    const before = cache.get(universe, DEFAULT_SETTINGS, 3);
    // Stepping checkpoints changes the reading, never the universe or the forces.
    readingAt(SMALL_MEMORY, SMALL_THREAD, 2, { depth: 1, thisTurnOnly: false });
    expect(cache.get(universe, DEFAULT_SETTINGS, 3)).toBe(before);
    expect(cache.get(universe, { ...DEFAULT_SETTINGS, repelForce: 50 }, 3)).not.toBe(before);
  });

  it("solves anew for different content under the same key, and reuses the same universe", () => {
    const cache = new LayoutCache();
    const first = buildUniverse("same-id", SMALL_MEMORY);
    const second = buildUniverse("same-id", {
      ...SMALL_MEMORY,
      notes: [...SMALL_MEMORY.notes, { id: "Extra", name: "Extra", frontier: false }],
    });
    const firstLayout = cache.get(first, DEFAULT_SETTINGS, 3);
    const secondLayout = cache.get(second, DEFAULT_SETTINGS, 3);
    expect(secondLayout).not.toBe(firstLayout);
    expect(firstLayout.positions).toHaveLength(first.nodes.length * 3);
    expect(secondLayout.positions).toHaveLength(second.nodes.length * 3);
    expect(cache.get(first, { ...DEFAULT_SETTINGS }, 3)).toBe(firstLayout);
  });

  it("seeds the flat layout from the spatial one", () => {
    const cache = new LayoutCache();
    const flat = cache.get(universe, DEFAULT_SETTINGS, 2);
    expect(flat).toBe(cache.get(universe, DEFAULT_SETTINGS, 2));
    expect(flat.positions.filter((_, index) => index % 3 === 2).every((z) => z === 0)).toBe(true);
  });
});

describe("medianNearestNeighbour", () => {
  it("measures how far apart points actually sit", () => {
    // Four points on a line, 1, 2, and 4 apart: nearest distances 1, 1, 2, 4.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 3, 0, 0, 7, 0, 0]);
    expect(medianNearestNeighbour(positions)).toBe(1.5);
    expect(medianNearestNeighbour(new Float32Array([5, 5, 5]))).toBe(0);
  });

  it("finds the exact median through its grid, as a full pairwise search would", () => {
    let state = 12345;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    for (const [count, flat] of [
      [400, false],
      [301, true],
    ] as const) {
      const positions = new Float32Array(count * 3).map((_, at) =>
        flat && at % 3 === 2 ? 0 : (random() - 0.5) * 1000 * (at % 3 === 0 ? 3 : 1),
      );
      const nearest: Array<number> = [];
      for (let a = 0; a < count; a += 1) {
        let best = Infinity;
        for (let b = 0; b < count; b += 1) {
          if (a === b) continue;
          best = Math.min(
            best,
            Math.hypot(
              (positions[a * 3] ?? 0) - (positions[b * 3] ?? 0),
              (positions[a * 3 + 1] ?? 0) - (positions[b * 3 + 1] ?? 0),
              (positions[a * 3 + 2] ?? 0) - (positions[b * 3 + 2] ?? 0),
            ),
          );
        }
        nearest.push(best);
      }
      nearest.sort((left, right) => left - right);
      const middle = Math.floor(count / 2);
      const median =
        count % 2 === 1
          ? (nearest[middle] ?? 0)
          : ((nearest[middle - 1] ?? 0) + (nearest[middle] ?? 0)) / 2;
      expect(medianNearestNeighbour(positions)).toBeCloseTo(median, 6);
    }
  });

  it("is carried by every layout", () => {
    const spatial = layoutUniverse(universe, DEFAULT_SETTINGS, 3);
    expect(spatial.spacing).toBeGreaterThan(0);
    expect(spatial.spacing).toBeCloseTo(medianNearestNeighbour(spatial.positions));
  });
});
