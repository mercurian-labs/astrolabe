import { describe, expect, it } from "vite-plus/test";

import { CursorRun, type CursorScene } from "../render/cursor.ts";
import type { Memory } from "./memory.ts";
import { fileOpen, memoryBefore } from "./plays.ts";
import { readingAt, threadIndex, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import type { ThreadRecord } from "./thread.ts";
import { cursorRows, turnTour, type TourVisit } from "./tour.ts";
import { buildUniverse } from "./universe.ts";
import { deriveView } from "./view.ts";

// Two files: the turn writes f and g in a.ts, links f to h in b.ts, and amends h.
const memory: Memory = {
  id: "tour",
  notes: [
    { id: "a.ts", name: "a.ts", frontier: false, kind: "file" },
    { id: "b.ts", name: "b.ts", frontier: false, kind: "file" },
    { id: "b.ts#h", name: "h", frontier: false, kind: "function", parent: "b.ts" },
  ],
  links: [],
  lenses: [],
};
const thread: ThreadRecord = {
  id: "t",
  title: "t",
  memoryId: "tour",
  turns: [
    {
      id: "t0",
      label: "t0",
      events: [
        { kind: "write", note: "a.ts#f", name: "f", parent: "a.ts", noteKind: "function" },
        { kind: "link", from: "a.ts#f", to: "b.ts#h", linkKind: "calls" },
        { kind: "write", note: "a.ts#g", name: "g", parent: "a.ts", noteKind: "function" },
        { kind: "amend", note: "b.ts#h" },
      ],
    },
  ],
};
const universe = buildUniverse("tour", threadUniverse(memory, thread), threadIndex(memory, thread));
const index = (id: string) => universe.indexOf.get(id) ?? -1;
const reading = readingAt(memory, thread, 0, { depth: 0, thisTurnOnly: false });
const viewAt = (closed: ReadonlySet<number>) =>
  deriveView({
    universe,
    lenses: [],
    shownLensSlots: [],
    reading,
    whole: false,
    pickedId: null,
    depth: 0,
    filters: NO_FILTERS,
    closed,
  });
const held = ["a.ts#f", "a.ts#g", "b.ts#h", "a.ts", "b.ts"].map(index);
const turn = thread.turns[0];
if (turn === undefined) throw new Error("no turn");
const tour = turnTour(
  turn,
  universe,
  new Set([index("a.ts"), index("b.ts")]),
  viewAt,
  held,
  memoryBefore(memory, thread, 0),
  new Map(),
);

describe("a tour told one container at a time", () => {
  it("opens a container the turn worked inside, telling its members and their links in play order", () => {
    expect(tour.map((visit) => visit.label)).toEqual(["◎ wrote 2 in a.ts", "◎ amended 1 in b.ts"]);
    const [file] = tour;
    expect(file?.inner?.container).toBe(index("a.ts"));
    expect(file?.inner?.closed.has(index("a.ts"))).toBe(false);
    expect(file?.inner?.visits.map((visit) => visit.label)).toEqual([
      "+ ● wrote f",
      "linked f to h",
      "+ ● wrote g",
    ]);
    // The link from inside is told inside, once: not again as a ride between the closed files.
    expect(tour.some((visit) => visit.verb === "link")).toBe(false);
  });

  it("opens, visits the members in order, and closes before going on", () => {
    const opened = new Set<number>();
    const where: Record<number, { x: number; y: number; r: number }> = {
      [index("a.ts")]: { x: 100, y: 100, r: 10 },
      [index("b.ts")]: { x: 600, y: 300, r: 10 },
      [index("a.ts#f")]: { x: 80, y: 140, r: 5 },
      [index("a.ts#g")]: { x: 140, y: 120, r: 5 },
      [index("b.ts#h")]: { x: 600, y: 300, r: 5 },
    };
    const scene: CursorScene = {
      // Members show only once their container is open; an open container shows as a region.
      noteAt: (note) => {
        const at = where[note];
        if (at === undefined) return null;
        if (note === index("a.ts")) return opened.has(note) ? null : at;
        if (note === index("a.ts#f") || note === index("a.ts#g"))
          return opened.has(index("a.ts")) ? at : null;
        return at;
      },
      park: () => ({ x: 900, y: 600 }),
    };
    const run = new CursorRun(tour, scene.park(), 0);
    run.start(scene);
    const story: Array<string> = [];
    for (let t = 0; t < 30 && !run.parked; t += 1 / 120) {
      run.at(t, scene);
      for (const event of run.takeEvents()) {
        if (event.kind === "arrive") story.push(event.visit.label);
        else {
          story.push(`${event.kind} ${universe.nodes[event.inner.container]?.name ?? ""}`);
          if (event.kind === "open") opened.add(event.inner.container);
          else opened.delete(event.inner.container);
        }
      }
    }
    expect(story).toEqual([
      "◎ wrote 2 in a.ts",
      "open a.ts",
      "+ ● wrote f",
      "linked f to h",
      "+ ● wrote g",
      "close a.ts",
      "◎ amended 1 in b.ts",
      "open b.ts",
      "~ ● amended h",
      "close b.ts",
    ]);
    expect(run.parked).toBe(true);
  });

  it("expands the file row while the cursor is inside it, and folds it when it leaves", () => {
    const file = { note: "a.ts", plays: [0, 1, 2] };
    expect(fileOpen(file, new Set(), [], null)).toBe(false);
    expect(fileOpen(file, new Set(), [], 1)).toBe(true);
    expect(fileOpen(file, new Set(), [], 3)).toBe(false);
  });
});

describe("the popover's lit rows", () => {
  const visit = (plays: ReadonlyArray<number>, note: number): TourVisit => ({
    play: plays[0] ?? 0,
    plays,
    verb: "amend",
    note,
    to: -1,
    label: "",
    links: [],
    inner: null,
  });
  // package.json amended at plays 2 and 5, told as one visit.
  const tour = [visit([0], 1), visit([2, 5], 2)];

  it("lights the play the cursor is on alone; its visit's other plays are marked quietly", () => {
    expect(cursorRows(null, 2, tour)).toEqual({ lit: [2], near: [5] });
    expect(cursorRows(null, 0, tour)).toEqual({ lit: [0], near: [] });
    expect(cursorRows(null, null, tour)).toEqual({ lit: [], near: [] });
  });

  it("lights what was chosen, and nothing else", () => {
    expect(cursorRows([5], 2, tour)).toEqual({ lit: [5], near: [] });
  });
});
