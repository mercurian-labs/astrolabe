import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import { playFocus } from "../model/plays.ts";
import { readingAt, threadUniverse } from "../model/reading.ts";
import { SMALL_MEMORY, SMALL_THREAD } from "../model/testMemory.ts";
import type { ThreadEvent } from "../model/thread.ts";
import { NO_FILTERS } from "../model/search.ts";
import { buildUniverse } from "../model/universe.ts";
import { denseView, EdgeDirection } from "../model/view.ts";
import {
  advanceBeads,
  assignBeads,
  BEAD_POOL,
  beadAlong,
  beadBrightness,
  beadLanes,
  BeadSet,
} from "./beads.ts";

const half = () => 0.5;
const { forward, backward } = EdgeDirection;

describe("assignBeads", () => {
  it("deals eight beads per lane, bead i on lane i mod n", () => {
    const beads = new BeadSet();
    assignBeads(
      beads,
      [
        { edge: 4, ways: forward },
        { edge: 9, ways: forward },
      ],
      half,
    );
    expect(beads.count).toBe(16);
    expect([...beads.edge.subarray(0, 4)]).toEqual([4, 9, 4, 9]);
    expect(beads.t[0]).toBe(0.5);
    expect(beads.speed[0]).toBeCloseTo(0.15);
    expect(beads.size[0]).toBeCloseTo(3.1);
  });

  it("caps the pool at 320", () => {
    const beads = new BeadSet();
    const lanes = Array.from({ length: 100 }, (_, edge) => ({ edge, ways: forward }));
    assignBeads(beads, lanes, half);
    expect(beads.count).toBe(BEAD_POOL);
  });

  it("runs beads the link's way: a → b, b → a, or half each way", () => {
    const beads = new BeadSet();
    const reversedOf = (edge: number) =>
      [...beads.reversed.subarray(0, beads.count)].filter((_, i) => beads.edge[i] === edge);
    assignBeads(
      beads,
      [
        { edge: 1, ways: forward },
        { edge: 2, ways: backward },
        { edge: 3, ways: forward | backward },
      ],
      half,
    );
    expect(reversedOf(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(reversedOf(2)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(reversedOf(3).filter((reversed) => reversed === 1)).toHaveLength(4);
    expect(reversedOf(3).filter((reversed) => reversed === 0)).toHaveLength(4);
  });

  it("empties the pool when there are no lanes", () => {
    const beads = new BeadSet();
    assignBeads(beads, [{ edge: 1, ways: forward }], half);
    assignBeads(beads, [], half);
    expect(beads.count).toBe(0);
  });
});

describe("advanceBeads", () => {
  it("moves each bead by its speed, clamps long frames, and wraps at the end of its run", () => {
    const beads = new BeadSet();
    assignBeads(beads, [{ edge: 0, ways: forward }], half);
    beads.t[0] = 0.5;
    beads.speed[0] = 0.2;
    advanceBeads(beads, 0.01);
    expect(beads.t[0]).toBeCloseTo(0.502);
    advanceBeads(beads, 5);
    expect(beads.t[0]).toBeCloseTo(0.512);
    beads.t[0] = 0.995;
    advanceBeads(beads, 0.05);
    expect(beads.t[0]).toBeCloseTo(0.005);
  });

  it("brightens through the middle of a run and runs b → a when reversed", () => {
    expect(beadBrightness(0)).toBe(0);
    expect(beadBrightness(0.5)).toBe(1);
    expect(beadBrightness(1)).toBeCloseTo(0);
    expect(beadAlong(0.2, false)).toBe(0.2);
    expect(beadAlong(0.2, true)).toBe(0.8);
  });
});

describe("beadLanes", () => {
  const universe = buildUniverse("almagest/thread", threadUniverse(almagest, ATLAS_THREAD));
  const viewAt = (checkpoint: number) =>
    denseView({
      universe,
      lenses: almagest.lenses,
      shownLensSlots: [],
      reading: readingAt(almagest, ATLAS_THREAD, checkpoint, { depth: 1, thisTurnOnly: false }),
      whole: false,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });

  it("runs beads on the turn's new links, the way the turn added them", () => {
    // Turn 3 links Atlas Graph → Design Lab.
    const lanes = beadLanes(viewAt(2), true);
    expect(lanes).toHaveLength(1);
    const edge = universe.edges[lanes[0]?.edge ?? -1];
    const from = universe.indexOf.get("Atlas Graph");
    expect(lanes[0]?.ways).toBe(edge?.a === from ? forward : backward);
  });

  it("runs beads on a selected link play's link alone, the way it was written, lit or not", () => {
    // Turn 9 links Atlas Graph and Visual Language to Render Budget.
    const turn = ATLAS_THREAD.turns[8];
    if (turn === undefined) throw new Error("the thread has no turn 9");
    const view = viewAt(8);
    expect(beadLanes(view, true)).toHaveLength(2);
    const play = playFocus(universe, turn, 2);
    const lanes = beadLanes(view, false, play);
    expect(lanes).toHaveLength(1);
    const edge = universe.edges[lanes[0]?.edge ?? -1];
    expect(lanes[0]?.edge).toBe(play?.links[0]?.edge);
    const from = universe.indexOf.get("Visual Language");
    expect(lanes[0]?.ways).toBe(edge?.a === from ? forward : backward);
    // A read, amend, or write play runs none.
    expect(beadLanes(view, true, playFocus(universe, turn, 0))).toEqual([]);
  });

  it("puts no beads on a broken link, and none at all when the story is dark", () => {
    // Turn 7 only breaks a link.
    expect(beadLanes(viewAt(6), true)).toEqual([]);
    expect(beadLanes(viewAt(2), false)).toEqual([]);
  });
});

describe("beadLanes through the replay", () => {
  const lanesAfter = (events: ReadonlyArray<ThreadEvent>) => {
    const thread = { ...SMALL_THREAD, turns: [{ id: "t0", label: "Links", events: [...events] }] };
    const universe = buildUniverse("small/thread", threadUniverse(SMALL_MEMORY, thread));
    const view = denseView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading: readingAt(SMALL_MEMORY, thread, 0, { depth: 1, thisTurnOnly: false }),
      whole: false,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    return { universe, lanes: beadLanes(view, true) };
  };

  it("runs a link added both ways and then taken back one way only the way that stands", () => {
    const { universe, lanes } = lanesAfter([
      { kind: "link", from: "C", to: "F" },
      { kind: "link", from: "F", to: "C" },
      { kind: "unlink", from: "F", to: "C" },
    ]);
    expect(lanes).toHaveLength(1);
    const edge = universe.edges[lanes[0]?.edge ?? -1];
    // C is the lesser id, so C → F is the edge's forward way.
    expect(universe.nodes[edge?.a ?? -1]?.id).toBe("C");
    expect(lanes[0]?.ways).toBe(forward);
    const beads = new BeadSet();
    assignBeads(beads, lanes, half);
    expect([...beads.reversed.subarray(0, beads.count)].every((reversed) => reversed === 0)).toBe(
      true,
    );
  });

  it("runs no beads on a link the turn added and took back", () => {
    const { lanes } = lanesAfter([
      { kind: "link", from: "C", to: "F" },
      { kind: "unlink", from: "C", to: "F" },
    ]);
    expect(lanes).toEqual([]);
  });
});
