import type { PlayPick, ThreadRecord } from "@mercurian/graph/model";
import { describe, expect, it } from "vite-plus/test";

import {
  clampStrip,
  LIVE_STRIP,
  popoverClosesOnPark,
  shownCheckpoint,
  stripIsLive,
  turnStripReducer,
  type TurnStrip,
  type TurnStripAction,
} from "./turnStrip";

// Three turns: the first writes two files in a new folder (so its first event writes the
// folder, a structural move playback skips), the second changes nothing, the third amends one.
const thread: ThreadRecord = {
  id: "thread",
  title: "",
  memoryId: "thread",
  turns: [
    {
      id: "c1",
      label: "Add a and b",
      events: [
        { kind: "write", note: "src", name: "src", noteKind: "folder" },
        { kind: "write", note: "src/a.ts", name: "a.ts", noteKind: "file", parent: "src" },
        { kind: "write", note: "src/b.ts", name: "b.ts", noteKind: "file", parent: "src" },
      ],
    },
    { id: "c2", label: "Explain", events: [] },
    {
      id: "r3",
      label: "Fix a",
      events: [{ kind: "amend", note: "src/a.ts", noteKind: "file", parent: "src" }],
    },
  ],
};
const LIVE = 2;

const run = (actions: ReadonlyArray<TurnStripAction>, from: TurnStrip = LIVE_STRIP) =>
  actions.reduce(turnStripReducer, from);

describe("the turn strip", () => {
  it("starts live on the working turn, and reads live only while the camera follows", () => {
    expect(shownCheckpoint(LIVE_STRIP, LIVE)).toBe(LIVE);
    expect(stripIsLive(LIVE_STRIP, true)).toBe(true);
    expect(stripIsLive(LIVE_STRIP, false)).toBe(false);
  });

  it("pins a picked turn; picking the live turn (or Live) lets go", () => {
    const pinned = run([{ type: "pick", turn: 0, live: LIVE }]);
    expect(shownCheckpoint(pinned, LIVE)).toBe(0);
    expect(stripIsLive(pinned, true)).toBe(false);
    // The working turn moves on (a new run starts): the pinned turn stays shown.
    expect(shownCheckpoint(pinned, 3)).toBe(0);
    expect(run([{ type: "pick", turn: LIVE, live: LIVE }], pinned)).toEqual(LIVE_STRIP);
    expect(run([{ type: "live" }], pinned)).toEqual(LIVE_STRIP);
  });

  it("plays from the shown turn's first move, skipping the folder writes, through every turn", () => {
    const start = run([
      { type: "pick", turn: 0, live: LIVE },
      { type: "toggle-play", thread, live: LIVE },
    ]);
    // Turn 1's events: write src (structure), write a.ts, write b.ts.
    expect(start).toMatchObject({ pinned: 0, playing: true, play: 1 });
    const steps: Array<[number | null, PlayPick | null]> = [[start.pinned, start.play]];
    let strip = start;
    while (strip.playing) {
      strip = turnStripReducer(strip, { type: "advance", thread });
      steps.push([strip.pinned, strip.play]);
    }
    expect(steps).toEqual([
      [0, 1],
      [0, 2],
      // Each turn's settle beat, with nothing chosen; a turn with no moves is one beat.
      [0, null],
      [1, null],
      [2, 0],
      [2, null],
      // The end of the thread: it holds the last beat, paused.
      [2, null],
    ]);
  });

  it("pauses on the move it shows, and resumes after it", () => {
    const playing = run([
      { type: "pick", turn: 0, live: LIVE },
      { type: "toggle-play", thread, live: LIVE },
    ]);
    const paused = run([{ type: "toggle-play", thread, live: LIVE }], playing);
    expect(paused).toMatchObject({ playing: false, play: 1, pinned: 0 });
    const resumed = run([{ type: "toggle-play", thread, live: LIVE }], paused);
    expect(resumed).toMatchObject({ playing: true, play: 2, pinned: 0 });
  });

  it("pauses when a move is chosen by hand, pinning its turn, and resumes after it", () => {
    const playing = run([{ type: "toggle-play", thread, live: LIVE }]);
    expect(playing).toMatchObject({ pinned: LIVE, playing: true });
    const chosen = run([{ type: "choose", play: [1, 2], live: LIVE }], {
      ...LIVE_STRIP,
      pinned: 0,
    });
    expect(chosen).toMatchObject({ pinned: 0, playing: false, play: [1, 2] });
    // Live, a chosen move pins the working turn so the next run does not take it away.
    const live = run([{ type: "choose", play: 0, live: LIVE }]);
    expect(live.pinned).toBe(LIVE);
    // Letting go keeps the turn.
    expect(run([{ type: "choose", play: null, live: LIVE }], chosen)).toMatchObject({
      pinned: 0,
      play: null,
    });
  });

  it("discards a pinned turn a rollback took, so regrowth never restores it", () => {
    const pinned = run([
      { type: "pick", turn: 1, live: LIVE },
      { type: "choose", play: 0, live: LIVE },
    ]);
    expect(clampStrip(pinned, 3)).toBe(pinned);
    // Rolled back to one turn: the state itself goes live, pin, step, and move gone.
    const rolledBack = run([{ type: "turns", turns: 1 }], pinned);
    expect(rolledBack).toEqual(LIVE_STRIP);
    // Two new turns arrive: index 1 exists again, and the strip stays live.
    const regrown = run([{ type: "turns", turns: 3 }], rolledBack);
    expect(regrown).toEqual(LIVE_STRIP);
    expect(shownCheckpoint(regrown, 2)).toBe(2);
    // Play starts from the displayed (live) turn, not the stale pin.
    expect(run([{ type: "toggle-play", thread, live: LIVE }], regrown)).toMatchObject({
      pinned: LIVE,
      playing: true,
    });
    // A pause held on a step the rollback took is discarded too.
    const paused: TurnStrip = {
      pinned: null,
      playing: false,
      step: { checkpoint: 2, play: 0 },
      play: null,
    };
    expect(run([{ type: "turns", turns: 2 }], paused)).toEqual(LIVE_STRIP);
  });

  it("closes the popover when the cursor heads home with nothing chosen and nothing playing", () => {
    expect(popoverClosesOnPark(LIVE_STRIP, null)).toBe(true);
    // Still telling a move: it stays.
    expect(popoverClosesOnPark(LIVE_STRIP, 3)).toBe(false);
    // A chosen move holds it open (Escape lets go first, then the cursor's return closes it).
    expect(popoverClosesOnPark({ ...LIVE_STRIP, pinned: 0, play: 1 }, null)).toBe(false);
    // Playback's settle beat parks nothing for good.
    expect(popoverClosesOnPark({ ...LIVE_STRIP, pinned: 0, playing: true }, null)).toBe(false);
  });
});
