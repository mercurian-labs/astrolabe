import { describe, expect, it } from "vite-plus/test";

import type { TourVisit } from "../model/tour.ts";
import { LINK_HOLD_SECONDS, PLAY_HOLD_SECONDS } from "../model/playback.ts";
import {
  AGENT_LABEL,
  CURSOR_LINK,
  CURSOR_PAUSE,
  CURSOR_PIXELS,
  CURSOR_TRAVEL,
  CursorRun,
  POPOVER_CLEARANCE,
  POPOVER_INSET,
  popoverPlace,
  type CursorScene,
} from "./cursor.ts";
import {
  GESTURE_SECONDS,
  gestureMarks,
  goneMarks,
  pendingMarks,
  type GestureVerb,
  type Mark,
} from "./gestures.ts";

// A frame 1000 × 700 pixels: notes far apart, the park in the bottom-right corner.
const first = { x: 100, y: 100, r: 6 };
const second = { x: 700, y: 150, r: 6 };
const third = { x: 400, y: 600, r: 8 };
const notes: Record<number, { x: number; y: number; r: number }> = {
  1: first,
  2: second,
  3: third,
};
const scene: CursorScene = {
  noteAt: (note) => notes[note] ?? null,
  park: () => ({ x: 944, y: 636 }),
};
const visit = (play: number, verb: TourVisit["verb"], note: number, to = -1): TourVisit => ({
  play,
  plays: [play],
  verb,
  note,
  to,
  label: `${verb} ${play}`,
  links: [],
  inner: null,
});
const visits = [visit(0, "read", 1), visit(1, "write", 2), visit(2, "link", 2, 3)];

/** Step a run at 120 Hz from `start` until it parks (or `limit` seconds pass). */
function walk(run: CursorRun, start: number, limit = 30) {
  const frames: Array<ReturnType<CursorRun["at"]> & { readonly t: number }> = [];
  const arrivals: Array<{ play: number; t: number }> = [];
  for (let t = start; t < start + limit; t += 1 / 120) {
    frames.push({ ...run.at(t, scene), t });
    for (const event of run.takeEvents()) {
      if (event.kind === "arrive") arrivals.push({ play: event.visit.play, t });
    }
    if (run.parked) break;
  }
  return { frames, arrivals };
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("the agent's cursor", () => {
  it("leaves the park, visits in play order, and comes back to the park", () => {
    const run = new CursorRun(visits, scene.park(), 0);
    run.start(scene);
    const { frames, arrivals } = walk(run, 0);
    expect(frames[0]).toMatchObject({ x: 944, y: 636, label: "read 0" });
    expect(arrivals.map((arrival) => arrival.play)).toEqual([0, 1, 2]);
    const last = frames.at(-1);
    expect(last).toMatchObject({ x: 944, y: 636, label: AGENT_LABEL, play: -1 });
    expect(run.parked).toBe(true);
    // Parked, it asks for nothing.
    expect(run.moving((last?.t ?? 0) + 5)).toBe(false);
  });

  it("never hurries: each travel its full eased length, each rest its pause", () => {
    const run = new CursorRun(visits, scene.park(), 0);
    run.start(scene);
    const { arrivals } = walk(run, 0);
    const [one, two, three] = arrivals;
    expect(one?.t).toBeGreaterThanOrEqual(CURSOR_TRAVEL - 1e-6);
    expect((two?.t ?? 0) - (one?.t ?? 0)).toBeGreaterThanOrEqual(
      CURSOR_PAUSE + CURSOR_TRAVEL - 0.01,
    );
    expect((three?.t ?? 0) - (two?.t ?? 0)).toBeGreaterThanOrEqual(
      CURSOR_PAUSE + CURSOR_TRAVEL + CURSOR_LINK - 0.01,
    );
    // A long turn takes as long as its visits do: nothing is quickened.
    const long = Array.from({ length: 40 }, (_, play) =>
      visit(play, "amend", play % 2 === 0 ? 1 : 2),
    );
    const longRun = new CursorRun(long, scene.park(), 0);
    longRun.start(scene);
    const told = walk(longRun, 0, 200);
    expect(told.arrivals).toHaveLength(40);
    expect(told.arrivals.at(-1)?.t ?? 0).toBeGreaterThan(40 * (CURSOR_PAUSE + CURSOR_TRAVEL) - 1);
  });

  it("never moves more than about 12 pixels in a frame at 120 Hz", () => {
    const run = new CursorRun(visits, scene.park(), 0);
    run.start(scene);
    const { frames } = walk(run, 0);
    const steps = frames.slice(1).map((frame, at) => distance(frame, frames[at] ?? frame));
    expect(Math.max(...steps)).toBeLessThanOrEqual(12.5);
  });

  it("rests beside a note, never on it, its tip toward it; rides a link to just short of the far note", () => {
    const run = new CursorRun(visits, scene.park(), 0);
    run.start(scene);
    const { frames } = walk(run, 0);
    const resting = (play: number) =>
      frames.find(
        (frame, at) => frame.play === play && distance(frame, frames[at + 1] ?? frame) < 1e-6,
      );
    const atRead = resting(0);
    if (atRead === undefined) throw new Error("it never rested on the read");
    expect(distance(atRead, first)).toBeCloseTo(1.6 * first.r + CURSOR_PIXELS / 2, 1);
    // The tip points at the note.
    expect(atRead.angle).toBeCloseTo(Math.atan2(first.y - atRead.y, first.x - atRead.x), 3);
    // A first visit is approached from the upper right.
    expect(atRead.x > first.x && atRead.y < first.y).toBe(true);
    const atLink = resting(2);
    if (atLink === undefined) throw new Error("it never rested after the link");
    expect(distance(atLink, third)).toBeCloseTo(1.6 * third.r + CURSOR_PIXELS / 2, 1);
    // On the link's line.
    const cross =
      ((third.x - second.x) * (atLink.y - second.y) -
        (third.y - second.y) * (atLink.x - second.x)) /
      distance(second, third);
    expect(Math.abs(cross)).toBeLessThan(0.5);
  });

  it("says where it is going from the moment it sets off, and Agent when parked or going home", () => {
    const run = new CursorRun([visit(4, "amend", 2)], scene.park(), 0);
    run.start(scene);
    expect(run.at(0.01, scene).label).toBe("amend 4");
    const { frames } = walk(run, 0.01);
    expect(frames.at(-1)?.label).toBe(AGENT_LABEL);
  });

  it("stays on a chosen play until let go, then goes home", () => {
    const run = new CursorRun([visit(1, "write", 2)], scene.park(), 0, true);
    run.start(scene);
    const { frames } = walk(run, 0, 3);
    expect(run.parked).toBe(false);
    expect(run.moving((frames.at(-1)?.t ?? 0) + 3)).toBe(false);
    run.home(10, scene);
    const back = walk(run, 10);
    expect(back.frames.at(-1)).toMatchObject({ x: 944, y: 636, label: AGENT_LABEL });
  });

  it("is waited for by playback: a play holds longer than its visit takes", () => {
    expect(PLAY_HOLD_SECONDS).toBeGreaterThan(CURSOR_TRAVEL + CURSOR_PAUSE);
    expect(LINK_HOLD_SECONDS).toBeGreaterThan(CURSOR_TRAVEL + CURSOR_LINK + CURSOR_PAUSE);
  });

  it("is large enough to read over notes", () => {
    expect(CURSOR_PIXELS).toBe(26);
  });
});

/** Whether a mark draws anything: some ink, and an arc of some length. */
const visible = (mark: Mark) => mark.alpha > 1e-6 && (mark.kind !== "arc" || mark.sweep > 1e-6);

describe("gestures", () => {
  const verbs: Array<GestureVerb> = ["write", "amend", "read", "remove"];

  it("start where the note stood and end at its rest", () => {
    for (const verb of verbs) {
      const before = verb === "write" ? pendingMarks(0, 0, 5) : [];
      const start = gestureMarks(verb, 0, 0, 0, 5).filter(visible);
      expect(start).toEqual(before.filter(visible));
      const rest = verb === "remove" ? goneMarks(0, 0, 5) : [];
      expect(gestureMarks(verb, GESTURE_SECONDS[verb], 0, 0, 5)).toEqual(rest);
      expect(GESTURE_SECONDS[verb]).toBeGreaterThanOrEqual(0.5);
      expect(GESTURE_SECONDS[verb]).toBeLessThanOrEqual(0.7);
    }
  });

  it("draws a written note's ripple out to about three radii", () => {
    const late = gestureMarks("write", GESTURE_SECONDS.write * 0.99, 0, 0, 5);
    const ripple = late.find((mark) => mark.kind === "arc" && mark.r > 5);
    expect(ripple?.kind === "arc" ? ripple.r : 0).toBeGreaterThan(14);
  });

  it("leaves a read's ink alone: only a halo", () => {
    const glance = gestureMarks("read", GESTURE_SECONDS.read / 2, 0, 0, 5);
    expect(glance.every((mark) => mark.kind === "disc" && mark.soft)).toBe(true);
  });
});

describe("a run extended while it is out", () => {
  const visitsOf = (run: CursorRun, until: number) => {
    const told: Array<number> = [];
    for (let now = 0; now <= until; now += 1 / 120) {
      run.at(now, scene);
      for (const event of run.takeEvents())
        if (event.kind === "arrive") told.push(event.visit.play);
    }
    return told;
  };

  it("tells the appended visits after its own, without going home between", () => {
    const run = new CursorRun([visit(0, "write", 1)], scene.park(), 0);
    run.start(scene);
    run.at(0.1, scene);
    expect(run.extend([visit(1, "write", 2)])).toBe(true);
    expect(visitsOf(run, 20)).toEqual([0, 1]);
    expect(run.parked).toBe(true);
  });

  it("refuses once it is on its way home, and when it stays on a chosen play", () => {
    const run = new CursorRun([visit(0, "write", 1)], scene.park(), 0);
    run.start(scene);
    visitsOf(run, 20);
    expect(run.extend([visit(1, "write", 2)])).toBe(false);
    const chosen = new CursorRun([visit(0, "write", 1)], scene.park(), 0, true);
    chosen.start(scene);
    expect(chosen.extend([visit(1, "write", 2)])).toBe(false);
  });
});

describe("the cursor's popover", () => {
  const frame = { width: 490, height: 800 };
  const size = { width: 300, height: 340 };

  it("sits past the caret on its label's side when there is room", () => {
    const place = popoverPlace({ x: 60, y: 400, outward: { x: 1, y: 0 } }, size, frame);
    expect(place.left).toBe(60 + CURSOR_PIXELS + 6);
    expect(place.top).toBe(400 - size.height / 2);
  });

  it("takes the other side when its own has no room, and stays inside the frame", () => {
    const place = popoverPlace({ x: 400, y: 790, outward: { x: 1, y: 0 } }, size, frame);
    expect(place.left).toBe(400 - CURSOR_PIXELS - 6 - size.width);
    expect(place.top).toBe(frame.height - size.height - POPOVER_INSET);
    // The parked cursor, bottom right: up and to the left of it.
    const parked = popoverPlace({ x: 434, y: 736, outward: { x: -1, y: 0 } }, size, frame);
    expect(parked.left + size.width).toBeLessThanOrEqual(434);
    expect(parked.top + size.height).toBeLessThanOrEqual(frame.height - POPOVER_INSET);
  });

  /** The popover placed for `cursor`, asserted clear of the caret's box and inside the frame. */
  const clearOf = (
    cursor: { x: number; y: number },
    within: { width: number; height: number },
    popover = size,
  ) => {
    const place = popoverPlace({ ...cursor, outward: { x: 1, y: 0 } }, popover, within);
    const height = place.maxHeight ?? popover.height;
    expect(height).toBeLessThanOrEqual(popover.height);
    const overlaps =
      place.left < cursor.x + POPOVER_CLEARANCE &&
      cursor.x - POPOVER_CLEARANCE < place.left + popover.width &&
      place.top < cursor.y + POPOVER_CLEARANCE &&
      cursor.y - POPOVER_CLEARANCE < place.top + height;
    expect(overlaps).toBe(false);
    expect(place.left).toBeGreaterThanOrEqual(POPOVER_INSET);
    expect(place.left + popover.width).toBeLessThanOrEqual(within.width - POPOVER_INSET);
    expect(place.top).toBeGreaterThanOrEqual(POPOVER_INSET);
    expect(place.top + height).toBeLessThanOrEqual(within.height - POPOVER_INSET);
    return place;
  };

  it("goes above or below when neither side fits, clear of the caret and its note", () => {
    // A 490 px panel, a 300 px popover, the cursor mid-frame: no side has room.
    const low = clearOf({ x: 245, y: 600 }, frame);
    expect(low.top).toBe(600 - POPOVER_CLEARANCE - size.height);
    expect(low.maxHeight).toBeNull();
    const high = clearOf({ x: 245, y: 150 }, frame);
    expect(high.top).toBe(150 + POPOVER_CLEARANCE);
  });

  it("takes the larger room and caps its height when neither above nor below fits whole", () => {
    // 490 × 500, the cursor in the middle: 210 px above, 210 below, the popover 340 tall.
    const place = clearOf({ x: 245, y: 250 }, { width: 490, height: 500 });
    expect(place.maxHeight).toBe(250 - POPOVER_CLEARANCE - POPOVER_INSET);
    expect(place.top).toBe(POPOVER_INSET);
  });

  it("fits a frame shorter than the popover, on the side with more room", () => {
    const short = { width: 490, height: 300 };
    const place = clearOf({ x: 245, y: 60 }, short);
    expect(place.top).toBe(60 + POPOVER_CLEARANCE);
    expect(place.maxHeight).toBe(300 - POPOVER_INSET - (60 + POPOVER_CLEARANCE));
    // Beside the cursor, too: the popover takes the frame's height and no more.
    const beside = clearOf({ x: 40, y: 150 }, short, { width: 200, height: 340 });
    expect(beside.maxHeight).toBe(300 - 2 * POPOVER_INSET);
  });

  it("pins to the left inset in a frame too narrow for it across", () => {
    const place = popoverPlace({ x: 100, y: 100, outward: { x: 1, y: 0 } }, size, {
      width: 200,
      height: 200,
    });
    expect(place.left).toBe(POPOVER_INSET);
    expect(place.top + (place.maxHeight ?? size.height)).toBeLessThanOrEqual(
      100 - POPOVER_CLEARANCE,
    );
  });
});
