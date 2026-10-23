import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { TourInner, TourVisit } from "../model/tour.ts";
import { AGENT_LABEL } from "./cursor.ts";
import type { Mark } from "./gestures.ts";
import { readingNotes } from "../model/level.ts";
import type { Memory } from "../model/memory.ts";
import { memoryBefore } from "../model/plays.ts";
import { readingAt, threadIndex, threadUniverse } from "../model/reading.ts";
import { NO_FILTERS } from "../model/search.ts";
import type { ThreadEvent, ThreadRecord } from "../model/thread.ts";
import { turnTour } from "../model/tour.ts";
import { buildUniverse } from "../model/universe.ts";
import { deriveView } from "../model/view.ts";
import { Storyteller, type CursorAt, type StoryHost } from "./storyteller.ts";

// The controller every renderer tells a turn with. The flat renderers host it
// on a world plane under a flat camera; the Atlas renderer (3D and flat) on a
// screen-space overlay. The same tests run against both hosts.

const WIDTH = 1000;
const HEIGHT = 700;
// Notes on screen, far apart; the park is in the bottom-right corner.
const onScreen: Record<number, { x: number; y: number; r: number }> = {
  1: { x: 100, y: 100, r: 6 },
  2: { x: 700, y: 150, r: 6 },
  3: { x: 400, y: 600, r: 8 },
  4: { x: 300, y: 300, r: 10 },
};

/** How each renderer maps a screen point onto the plane its marks draw on. */
const PLANES = {
  // Lean and Pixi: world units under a flat camera at (50, 20), 2 pixels per unit, y up.
  flat: {
    toPlane: (x: number, y: number) => ({
      x: 50 + (x - WIDTH / 2) / 2,
      y: 20 - (y - HEIGHT / 2) / 2,
    }),
    scale: 2,
  },
  // Atlas 3D and Flat: the overlay's CSS pixels, y up.
  overlay: { toPlane: (x: number, y: number) => ({ x, y: HEIGHT - y }), scale: 1 },
} as const;

const visit = (
  play: number,
  verb: TourVisit["verb"],
  note: number,
  to = -1,
  links: TourVisit["links"] = [],
  inner: TourInner | null = null,
): TourVisit => ({ play, plays: [play], verb, note, to, label: `${verb} ${play}`, links, inner });

let now = 1000;
beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function hosted(
  plane: keyof typeof PLANES,
  storyLit = () => true,
  screen: Record<number, { x: number; y: number; r: number }> = onScreen,
) {
  const { toPlane, scale } = PLANES[plane];
  const calls = {
    cursor: [] as Array<number | null>,
    drill: [] as Array<string>,
    camera: [] as Array<boolean>,
    relit: 0,
    held: 0,
    at: [] as Array<CursorAt>,
    animated: 0,
  };
  const host: StoryHost = {
    size: () => ({ width: WIDTH, height: HEIGHT }),
    noteOnScreen: (note) => screen[note] ?? null,
    noteOnPlane: (note) => {
      const at = screen[note];
      if (at === undefined) return null;
      const point = toPlane(at.x, at.y);
      return { x: point.x, y: point.y, r: at.r / scale };
    },
    toPlane,
    storyLit,
    holdStory: () => (calls.held += 1),
    relight: () => (calls.relit += 1),
    tourCamera: (open) => calls.camera.push(open),
    onCursor: (play) => calls.cursor.push(play),
    onCursorAt: (at) => calls.at.push(at),
    onDrill: (inner, open) => calls.drill.push(`${open ? "open" : "close"} ${inner.container}`),
    animate: () => (calls.animated += 1),
    invalidate: () => {},
  };
  const teller = new Storyteller(host);
  /** Draw frames at 60 Hz, as a renderer would while the telling asks for them. */
  const run = (seconds = 60) => {
    const frames: Array<ReturnType<Storyteller["frame"]>> = [];
    for (let t = 0; t < seconds; t += 1 / 60) {
      now += 1000 / 60;
      frames.push(teller.frame());
      if (!teller.tell(now / 1000)) break;
    }
    return frames;
  };
  return { teller, calls, run, toPlane };
}

const near = (mark: Mark, x: number, y: number) =>
  "x" in mark && Math.abs(mark.x - x) < 1e-6 && Math.abs(mark.y - y) < 1e-6;

describe.each(["flat", "overlay"] as const)("the storyteller on the %s plane", (plane) => {
  it("parks the cursor in the corner saying Agent, asking for no frames", () => {
    const { teller, toPlane } = hosted(plane);
    const { marks, agent } = teller.frame();
    expect(marks).toEqual([]);
    expect(agent.text).toBe(AGENT_LABEL);
    // The caret sits at the park, in the plane's units: outline first, then the dart.
    const park = toPlane(WIDTH - 56, HEIGHT - 64);
    expect(agent.caret.map((mark) => mark.kind)).toEqual(["cursor", "cursor"]);
    expect(near(agent.caret[1] as Mark, park.x, park.y)).toBe(true);
    expect(agent.chip.kind).toBe("rect");
    expect(teller.tell(now / 1000)).toBe(false);
    // No visits: landing tours nothing and stays parked.
    teller.startTour();
    expect(teller.touring).toBe(false);
  });

  it("tells the turn in play order: written notes wait, gestures fire, links light then go quiet", () => {
    const { teller, calls, run, toPlane } = hosted(plane);
    const link = { edge: 7, kind: "link" as const, ways: 1 };
    const visits = [
      visit(0, "read", 1),
      visit(1, "write", 2),
      visit(2, "link", 2, 3, [link]),
      visit(3, "remove", 4),
    ];
    expect(teller.setMoves(visits)).toBe(true);
    // The same visits again change nothing.
    expect(teller.setMoves([...visits])).toBe(false);
    teller.startTour();
    // Before the cursor reaches it, the written note waits as an outline where it is drawn.
    const second = toPlane(700, 150);
    expect(teller.frame().marks.some((mark) => near(mark, second.x, second.y))).toBe(true);
    // During the link's visit its link runs in full; nothing told yet is quiet.
    let duringLink: ReturnType<Storyteller["focus"]> = null;
    const frames: Array<ReturnType<Storyteller["frame"]>> = [];
    for (let t = 0; t < 60; t += 1 / 60) {
      now += 1000 / 60;
      frames.push(teller.frame());
      if (calls.cursor.at(-1) === 2 && duringLink === null) duringLink = teller.focus();
      if (!teller.tell(now / 1000)) break;
    }
    expect(calls.cursor.filter((play) => play !== null)).toEqual([0, 1, 2, 3]);
    expect(calls.cursor.at(-1)).toBeNull();
    expect(duringLink?.links).toEqual([link]);
    expect(duringLink?.quiet).toEqual([]);
    expect(frames.some((frame) => frame.agent.text === "write 1")).toBe(true);
    // Each step held the story and relit what it had told.
    expect(calls.held).toBeGreaterThan(0);
    expect(calls.relit).toBeGreaterThan(0);
    // After the tour, home and still: the link it told stays quiet while the story is lit.
    expect(teller.touring).toBe(false);
    expect(teller.frame().agent.text).toBe(AGENT_LABEL);
    expect(teller.focus()?.quiet).toEqual([7]);
    expect(teller.focus()?.links).toEqual([]);
    expect(teller.tell(now / 1000)).toBe(false);
    // The removed note keeps its drained mark; the written one draws itself again.
    expect(teller.frame().marks.length).toBeGreaterThan(0);
    expect(run(1).length).toBe(1);
  });

  it("lets the quiet links fall with the story", () => {
    let lit = true;
    const { teller, run } = hosted(plane, () => lit);
    teller.setMoves([visit(0, "link", 1, 2, [{ edge: 3, kind: "link", ways: 1 }])]);
    teller.startTour();
    run();
    expect(teller.focus()?.quiet).toEqual([3]);
    lit = false;
    expect(teller.focus()).toBeNull();
  });

  it("opens a container it tells inside, then closes it, keeping the survey's camera", () => {
    const { teller, calls, run } = hosted(plane);
    const inner: TourInner = {
      container: 4,
      closed: new Set(),
      outer: new Set([4]),
      visits: [visit(1, "write", 1), visit(2, "amend", 2)],
    };
    teller.setMoves([visit(0, "amend", 4, -1, [], inner), visit(3, "read", 3)]);
    teller.startTour();
    run();
    expect(calls.drill).toEqual(["open 4", "close 4"]);
    expect(calls.camera).toEqual([true, false]);
    expect(calls.cursor.filter((play) => play !== null)).toEqual([0, 1, 2, 3]);
  });

  it("goes to a chosen play and stays, then home when it is let go", () => {
    const { teller, calls, run } = hosted(plane);
    teller.setMoves([visit(0, "read", 1), visit(1, "amend", 3)]);
    teller.cursorTo(1);
    run(5);
    expect(calls.cursor.at(-1)).toBe(1);
    expect(teller.touring).toBe(true);
    teller.cursorTo(null);
    run();
    expect(calls.cursor.at(-1)).toBeNull();
    expect(teller.touring).toBe(false);
  });

  it("goes on to tell what a working turn appends, in order, without telling it again", () => {
    const { teller, calls, run } = hosted(plane);
    const first = [visit(0, "write", 1), visit(1, "write", 2)];
    teller.setMoves(first);
    teller.startTour();
    // Partway through the tour, the agent writes another file.
    run(0.2);
    expect(teller.touring).toBe(true);
    expect(teller.setMoves([...first, visit(2, "write", 3)], [visit(2, "write", 3)])).toBe(true);
    run();
    expect(calls.cursor.filter((play) => play !== null)).toEqual([0, 1, 2]);
    expect(teller.touring).toBe(false);
    expect(teller.tell(now / 1000)).toBe(false);
    // Once home, more writes send it out again for those alone, and it rests after.
    calls.cursor.length = 0;
    teller.setMoves([...first, visit(2, "write", 3), visit(3, "amend", 4)], [visit(3, "amend", 4)]);
    expect(teller.touring).toBe(true);
    run();
    expect(calls.cursor.filter((play) => play !== null)).toEqual([3]);
    expect(teller.tell(now / 1000)).toBe(false);
  });

  it("keeps what the tour drew when the turn grows: the told notes do not wait again", () => {
    const { teller, run, toPlane } = hosted(plane);
    const first = [visit(0, "write", 1)];
    teller.setMoves(first);
    teller.startTour();
    run();
    const told = toPlane(100, 100);
    const drawnBefore = teller.frame().marks.filter((mark) => near(mark, told.x, told.y)).length;
    teller.setMoves([...first, visit(1, "write", 2)], [visit(1, "write", 2)]);
    // The new note waits as an outline; the told one draws as it did.
    const fresh = toPlane(700, 150);
    const marks = teller.frame().marks;
    expect(marks.some((mark) => near(mark, fresh.x, fresh.y))).toBe(true);
    expect(marks.filter((mark) => near(mark, told.x, told.y)).length).toBe(drawnBefore);
  });

  it("starts the tour for appended moves when the landing had none", () => {
    const { teller, calls, run } = hosted(plane);
    teller.setMoves([]);
    teller.startTour();
    expect(teller.touring).toBe(false);
    teller.setMoves([visit(0, "write", 1)], [visit(0, "write", 1)]);
    run();
    expect(calls.cursor.filter((play) => play !== null)).toEqual([0]);
  });

  it("leaves a chosen play alone when the turn grows", () => {
    const { teller, calls, run } = hosted(plane);
    const first = [visit(0, "read", 1), visit(1, "amend", 3)];
    teller.setMoves(first);
    teller.cursorTo(1);
    run(5);
    teller.setMoves([...first, visit(2, "write", 2)], [visit(2, "write", 2)]);
    run(5);
    expect(calls.cursor.findLast((play) => play !== null)).toBe(1);
  });

  it("gives the chip way to the host's popover, and reports where the cursor is", () => {
    const { teller, calls } = hosted(plane);
    const { agent } = teller.frame();
    expect(agent.text).toBe(AGENT_LABEL);
    // The chip catches a click where it is drawn: left of the park, outward from no note.
    expect(teller.chipAt(WIDTH - 56 - 40, HEIGHT - 64)).toBe(true);
    expect(calls.at.at(-1)).toMatchObject({ x: WIDTH - 56, y: HEIGHT - 64, width: WIDTH });
    teller.setExpanded(true);
    const expanded = teller.frame().agent;
    expect(expanded.text).toBe("");
    expect(expanded.caret.length).toBe(2);
    expect(teller.chipAt(WIDTH - 56 - 40, HEIGHT - 64)).toBe(false);
  });
});

describe("a working turn's appended moves, told from its tour", () => {
  // a.ts then b.ts written and told; then the agent amends b.ts, then a.ts.
  const memory: Memory = { id: "m", notes: [], links: [], lenses: [] };
  const told: Array<ThreadEvent> = [
    { kind: "write", note: "a.ts", name: "a.ts" },
    { kind: "write", note: "b.ts", name: "b.ts" },
  ];
  const grown: Array<ThreadEvent> = [
    ...told,
    { kind: "amend", note: "b.ts" },
    { kind: "amend", note: "a.ts" },
  ];
  const tourOf = (events: ReadonlyArray<ThreadEvent>, only: ReadonlySet<number> | null = null) => {
    const thread: ThreadRecord = {
      id: "t",
      title: "",
      memoryId: "m",
      turns: [{ id: "t0", label: "t0", events }],
    };
    const universe = buildUniverse(
      "m/t",
      threadUniverse(memory, thread),
      threadIndex(memory, thread),
    );
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
    const turn = thread.turns[0];
    if (turn === undefined) throw new Error("no turn");
    return {
      universe,
      tour: turnTour(
        turn,
        universe,
        new Set(),
        viewAt,
        readingNotes(universe, reading),
        memoryBefore(memory, thread, 0),
        new Map(),
        only,
      ),
    };
  };

  it("tells the amendments alone, b.ts before a.ts, as amendments", () => {
    const { universe, tour: first } = tourOf(told);
    const index = (id: string) => universe.indexOf.get(id) ?? -1;
    const { tour: whole } = tourOf(grown);
    const { tour: appended } = tourOf(grown, new Set([2, 3]));
    // The whole turn groups each file's moves under its first play: a.ts first, as a write.
    expect(whole.map((each) => [each.note, each.verb])).toEqual([
      [index("a.ts"), "write"],
      [index("b.ts"), "write"],
    ]);
    // The appended tour is the appended plays, in their order, with their own verbs.
    expect(appended.map((each) => [each.play, each.note, each.verb])).toEqual([
      [2, index("b.ts"), "amend"],
      [3, index("a.ts"), "amend"],
    ]);
    const screen = {
      [index("a.ts")]: { x: 100, y: 100, r: 6 },
      [index("b.ts")]: { x: 700, y: 150, r: 6 },
    };
    const { teller, calls, run } = hosted("flat", () => true, screen);
    teller.setMoves(first);
    teller.startTour();
    run();
    calls.cursor.length = 0;
    expect(teller.setMoves(whole, appended)).toBe(true);
    const frames = run();
    expect(calls.cursor.filter((play) => play !== null)).toEqual([2, 3]);
    const said = [...new Set(frames.map((frame) => frame.agent.text))];
    expect(said.filter((text) => text.includes("amended"))).toEqual([
      "~ amended b.ts",
      "~ amended a.ts",
    ]);
    expect(said.some((text) => text.includes("wrote"))).toBe(false);
    expect(teller.tell(now / 1000)).toBe(false);
  });
});
