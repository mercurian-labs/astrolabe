import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import { threadUniverse } from "../model/reading.ts";
import { NO_FILTERS } from "../model/search.ts";
import { DEFAULT_SETTINGS } from "../model/settings.ts";
import { buildUniverse } from "../model/universe.ts";
import { drawnRadius, layoutSpan, layoutUnit, layoutUniverse } from "./forceLayout.ts";
import { GatheringCache, type GatherContext } from "./gatheredReading.ts";
import { gatheringOffset, type Gathering } from "./gathering.ts";

const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
const layout = layoutUniverse(universe, DEFAULT_SETTINGS, 3);
const unit = layoutUnit(layout);
const context: GatherContext = {
  memory: almagest,
  thread: ATLAS_THREAD,
  universe,
  layout,
  settings: DEFAULT_SETTINGS,
  thisTurnOnly: false,
  filters: NO_FILTERS,
};
const checkpoints = ATLAS_THREAD.turns.map((_, index) => index);
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
const home = (index: number) => Array.from(layout.positions.subarray(index * 3, index * 3 + 3));
const linkLength = DEFAULT_SETTINGS.linkDistance * unit;

describe("the gathered reading", () => {
  const cache = new GatheringCache();
  const clusters = checkpoints.map((checkpoint) => cache.at(context, checkpoint));

  it("leaves no two gathered notes overlapping", () => {
    // Drawn at the most links a note ever has in the thread, so at its largest.
    const radius = (index: number) =>
      drawnRadius(
        universe.index.degree.get(universe.nodes[index]?.id ?? "") ?? 0,
        DEFAULT_SETTINGS.nodeSize,
        layoutSpan(layout, DEFAULT_SETTINGS.linkDistance),
        DEFAULT_SETTINGS.linkDistance,
      );
    for (const cluster of clusters) {
      const places = [...cluster.positions];
      places.forEach(([a, placeA], slot) => {
        for (const [b, placeB] of places.slice(slot + 1)) {
          expect(distance(placeA, placeB)).toBeGreaterThanOrEqual(radius(a) + radius(b));
        }
      });
    }
  });

  it("keeps notes already gathered nearly still while new arrivals travel from home", () => {
    let farthestArrival = 0;
    clusters.forEach((cluster, checkpoint) => {
      const previous: Gathering | undefined = clusters[checkpoint - 1];
      for (const [index, place] of cluster.positions) {
        const before = previous?.positions.get(index);
        if (before !== undefined) expect(distance(place, before)).toBeLessThan(0.6 * linkLength);
        else farthestArrival = Math.max(farthestArrival, distance(place, home(index)));
      }
    });
    expect(farthestArrival).toBeGreaterThan(0.6 * linkLength);
  });

  it("sends everyone home when the reading clears", () => {
    const cleared = new GatheringCache().at(
      { ...context, filters: { ...NO_FILTERS, search: "no note is called this" } },
      4,
    );
    expect(cleared.positions.size).toBe(0);
    universe.nodes.forEach((_, index) => {
      expect(gatheringOffset(cleared, layout.positions, index)).toEqual([0, 0, 0]);
      expect(gatheringOffset(null, layout.positions, index)).toEqual([0, 0, 0]);
    });
    // A note that left the reading has no place in the cluster: its offset is home.
    const outside = universe.nodes.findIndex((_, index) => !clusters[0]?.positions.has(index));
    expect(gatheringOffset(clusters[0] ?? null, layout.positions, outside)).toEqual([0, 0, 0]);
  });

  it("gathers the same cluster every time, in order or by jumping", () => {
    const jumped = new GatheringCache().at(context, 6);
    expect([...jumped.positions]).toEqual([...(clusters[6]?.positions ?? [])]);
    const again = new GatheringCache();
    expect([...again.at(context, 3).positions]).toEqual([...(clusters[3]?.positions ?? [])]);
  });
});
