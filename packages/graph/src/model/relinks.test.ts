import { describe, expect, it } from "vite-plus/test";

import { applyFeatures } from "./features.ts";
import { edgeBetween } from "./level.ts";
import type { Memory } from "./memory.ts";
import { firstStep, nextStep } from "./playback.ts";
import { describePlays, memoryBefore, playTree, turnMoves, turnVisits } from "./plays.ts";
import { readingAt, threadIndex, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import { NO_FEATURES } from "./settings.ts";
import { resolveRelinks, type ThreadRecord } from "./thread.ts";
import { buildUniverse } from "./universe.ts";
import { denseView, deriveView, EdgeDirection, EdgeKind } from "./view.ts";

// a.ts holds f, g, and h; f calls g (exactly) before the thread. The one turn
// links f to g again, now by name alone (a same-named g appeared), and links f
// to h for the first time.
const memory: Memory = {
  id: "relinks",
  notes: [
    { id: "a.ts", name: "a.ts", frontier: false, kind: "file" },
    { id: "a.ts#f", name: "f", frontier: false, kind: "function", parent: "a.ts" },
    { id: "a.ts#g", name: "g", frontier: false, kind: "function", parent: "a.ts" },
    { id: "a.ts#h", name: "h", frontier: false, kind: "function", parent: "a.ts" },
  ],
  links: [{ from: "a.ts#f", to: "a.ts#g", kind: "calls", resolution: "exact" }],
  lenses: [],
};
const raw: ThreadRecord = {
  id: "t",
  title: "t",
  memoryId: "relinks",
  turns: [
    {
      id: "t0",
      label: "t0",
      events: [
        { kind: "link", from: "a.ts#f", to: "a.ts#g", linkKind: "calls", resolution: "heuristic" },
        { kind: "link", from: "a.ts#f", to: "a.ts#h", linkKind: "calls", resolution: "exact" },
      ],
    },
  ],
};

describe("a link to a link that already stands", () => {
  const thread = applyFeatures(memory, raw, NO_FEATURES).thread ?? raw;
  const turn = thread.turns[0];
  if (turn === undefined) throw new Error("no turn");
  const universe = buildUniverse(
    "relinks",
    threadUniverse(memory, thread),
    threadIndex(memory, thread),
  );
  const index = (id: string) => universe.indexOf.get(id) ?? -1;
  const reading = readingAt(memory, thread, 0, { depth: 1, thisTurnOnly: false });
  const toG = { from: "a.ts#f", to: "a.ts#g", kind: "calls" as const };
  const toH = { from: "a.ts#f", to: "a.ts#h", kind: "calls" as const };

  it("reads as a re-resolution: the record says so, and a new link stays a link", () => {
    expect(turn.events.map((event) => event.kind)).toEqual(["resolve", "link"]);
    // A record without re-links comes back as itself.
    const plain: ThreadRecord = { ...raw, turns: [{ id: "t0", label: "t0", events: [] }] };
    expect(resolveRelinks(memory, plain)).toBe(plain);
  });

  it("keeps the link standing and changes only its resolution, with no mark for the story", () => {
    expect(reading.linkStands(toG)).toBe(true);
    expect(reading.linkResolution(toG)).toBe("heuristic");
    expect(reading.linkMarks.has(`a.ts#f\u0000a.ts#g`)).toBe(false);
    expect(reading.linkMarks.get(`a.ts#f\u0000a.ts#h`)?.mark).toBe("new");
    // The raw record replays the same way: a link to a standing link is a re-resolution.
    const rawReading = readingAt(memory, raw, 0, { depth: 1, thisTurnOnly: false });
    expect(rawReading.linkResolution(toG)).toBe("heuristic");
    expect(rawReading.linkMarks.has(`a.ts#f\u0000a.ts#g`)).toBe(false);
    expect(rawReading.linkResolution(toH)).toBe("exact");
  });

  it("is no play: no row, no visit, no playback step, and no new ink or beads", () => {
    const notes = memoryBefore(memory, thread, 0);
    expect(describePlays(turn, notes)[0]?.kind).toBe("resolve");
    const tree = playTree(turn, notes);
    expect(tree?.map((group) => group.counts)).toEqual(["linked 1"]);
    expect(tree?.[0]?.symbols.flatMap((symbol) => symbol.links.map((leaf) => leaf.play))).toEqual([
      1,
    ]);
    const view = deriveView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    const moves = turnMoves(turn, universe, view);
    expect(moves.map((move) => move.play)).toEqual([1]);
    expect(turnVisits(turn, universe, moves, notes).map((visit) => visit.play)).toEqual([1]);
    expect(firstStep(thread, 0)).toEqual({ checkpoint: 0, play: 1 });
    expect(nextStep(thread, { checkpoint: 0, play: 1 })).toEqual({ checkpoint: 0, play: null });
    // The re-resolved edge is not the story's: not new, not current; the new link is.
    const dense = denseView({
      universe,
      lenses: [],
      shownLensSlots: [],
      reading,
      whole: true,
      pickedId: null,
      depth: 1,
      filters: NO_FILTERS,
    });
    const g = edgeBetween(universe, index("a.ts#f"), index("a.ts#g"));
    const h = edgeBetween(universe, index("a.ts#f"), index("a.ts#h"));
    expect(dense.edgeKind[g]).toBe(EdgeKind.plain);
    expect(dense.edgeCurrent[g]).toBe(0);
    expect(dense.edgeKind[h]).toBe(EdgeKind.new);
    expect(view.story).not.toContain(index("a.ts#g"));
    // Its dashing follows the resolution now: a guess.
    expect((dense.edgeDirection[g] ?? 0) & EdgeDirection.heuristic).toBe(EdgeDirection.heuristic);
    expect((dense.edgeDirection[h] ?? 0) & EdgeDirection.heuristic).toBe(0);
  });
});
