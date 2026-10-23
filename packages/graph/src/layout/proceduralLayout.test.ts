import { describe, expect, it } from "vite-plus/test";

import { syntheticMemory } from "../../fixtures/synthetic.ts";
import { DEFAULT_SETTINGS } from "../model/settings.ts";
import { buildUniverse } from "../model/universe.ts";
import { drawnRadius, layoutSpan } from "./forceLayout.ts";
import { homeLayout } from "./homeLayout.ts";
import { FORCE_LAYOUT_LIMIT, proceduralLayout } from "./proceduralLayout.ts";

/** The closest pair of points, through a grid of cells `cell` wide: fine for 10k points. */
function closestPair(positions: Float32Array, cell: number): number {
  const cells = new Map<string, Array<number>>();
  const count = positions.length / 3;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let index = 0; index < count; index += 1) {
    const at = key(
      Math.floor((positions[index * 3] ?? 0) / cell),
      Math.floor((positions[index * 3 + 1] ?? 0) / cell),
      Math.floor((positions[index * 3 + 2] ?? 0) / cell),
    );
    cells.set(at, [...(cells.get(at) ?? []), index]);
  }
  let best = Infinity;
  for (let index = 0; index < count; index += 1) {
    const cx = Math.floor((positions[index * 3] ?? 0) / cell);
    const cy = Math.floor((positions[index * 3 + 1] ?? 0) / cell);
    const cz = Math.floor((positions[index * 3 + 2] ?? 0) / cell);
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dz = -1; dz <= 1; dz += 1)
          for (const other of cells.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
            if (other <= index) continue;
            best = Math.min(
              best,
              Math.hypot(
                (positions[index * 3] ?? 0) - (positions[other * 3] ?? 0),
                (positions[index * 3 + 1] ?? 0) - (positions[other * 3 + 1] ?? 0),
                (positions[index * 3 + 2] ?? 0) - (positions[other * 3 + 2] ?? 0),
              ),
            );
          }
  }
  return best;
}

describe("the procedural home layout", () => {
  const universe = buildUniverse("synthetic-10k", syntheticMemory({ notes: 10_000 }));

  it("takes over from the force layout past its limit, deterministically", () => {
    const layout = homeLayout(universe, DEFAULT_SETTINGS, 3, () => {
      throw new Error("a placed layout needs no seed");
    });
    expect(universe.nodes.length).toBeGreaterThan(FORCE_LAYOUT_LIMIT);
    expect([...layout.positions]).toEqual([
      ...proceduralLayout(universe, DEFAULT_SETTINGS, 3).positions,
    ]);
    expect(layout.positions.every(Number.isFinite)).toBe(true);
    const flat = proceduralLayout(universe, DEFAULT_SETTINGS, 2);
    expect(flat.positions.filter((_, at) => at % 3 === 2).every((z) => z === 0)).toBe(true);
  });

  it("keeps drawn notes apart, spaced about a link distance, in space and flat", () => {
    for (const dimensions of [3, 2] as const) {
      const layout = proceduralLayout(universe, DEFAULT_SETTINGS, dimensions);
      const span = layoutSpan(layout, DEFAULT_SETTINGS.linkDistance);
      const largest = drawnRadius(1000, 1, span, DEFAULT_SETTINGS.linkDistance);
      expect(closestPair(layout.positions, 2 * largest)).toBeGreaterThan(2 * largest);
      expect(layout.spacing).toBeGreaterThan(0.4 * DEFAULT_SETTINGS.linkDistance);
      expect(layout.spacing).toBeLessThan(2 * DEFAULT_SETTINGS.linkDistance);
    }
  });

  it("sets a group's hub nearer its centre than the group's least-linked note", () => {
    const layout = proceduralLayout(universe, DEFAULT_SETTINGS, 3);
    const group = universe.nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.group === "Orbit");
    const degree = (index: number) =>
      universe.index.degree.get(universe.nodes[index]?.id ?? "") ?? 0;
    const centre = [0, 1, 2].map(
      (axis) =>
        group.reduce((sum, { index }) => sum + (layout.positions[index * 3 + axis] ?? 0), 0) /
        group.length,
    );
    const away = (index: number) =>
      Math.hypot(
        ...[0, 1, 2].map((axis) => (layout.positions[index * 3 + axis] ?? 0) - (centre[axis] ?? 0)),
      );
    const sorted = group.map(({ index }) => index).toSorted((a, b) => degree(b) - degree(a));
    expect(away(sorted[0] ?? 0)).toBeLessThan(away(sorted.at(-1) ?? 0));
  });

  it("lays out 100,000 notes in well under a generous ceiling", () => {
    const large = buildUniverse("synthetic-100k", syntheticMemory({ notes: 100_000 }));
    const layout = proceduralLayout(large, DEFAULT_SETTINGS, 3);
    expect(layout.positions.length).toBe(300_000);
    // A guard against quadratic work, not a benchmark: forces would take ~30 s here.
    expect(layout.ms).toBeLessThan(20_000);
  });
});
