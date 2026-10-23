import { describe, expect, it } from "vite-plus/test";

import { CameraReach, REACH_LINGER_MS, REACH_MARGIN, reachShift } from "./reach.ts";

/** Timers a test runs by hand: `advance` fires whatever is due. */
function manualTimers() {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    schedule: (run: () => void, ms: number) => {
      next += 1;
      const key = next;
      due.set(key, { at: now + ms, run });
      return () => {
        due.delete(key);
      };
    },
    advance(ms: number) {
      now += ms;
      for (const [key, timer] of due) {
        if (timer.at > now) continue;
        due.delete(key);
        timer.run();
      }
    },
  };
}

const frame = { x: 0, y: 0, halfWidth: 100, halfHeight: 50 };

describe("reachShift", () => {
  it("does not move when every end is already in the frame", () => {
    expect(
      reachShift(frame, [
        { x: 0, y: 0 },
        { x: 60, y: 20 },
      ]),
    ).toBeNull();
  });

  it("pans just enough to bring an end inside the frame's edge", () => {
    const shift = reachShift(frame, [
      { x: 0, y: 0 },
      { x: 150, y: 0 },
    ]);
    expect(shift?.dx).toBeCloseTo(150 - 100 * (1 - REACH_MARGIN));
    expect(shift?.dy).toBe(0);
  });

  it("keeps the hovered note in the frame when its ends are wider than it", () => {
    const shift = reachShift(frame, [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
    expect(shift?.dx).toBeCloseTo(100 * (1 - REACH_MARGIN));
  });
});

describe("CameraReach", () => {
  const setup = () => {
    const clock = manualTimers();
    const calls: Array<string> = [];
    let offFrame = true;
    const reach = new CameraReach(
      (notes) => {
        calls.push(`reach ${notes.join(",")}`);
        return offFrame;
      },
      () => calls.push("back"),
      clock.schedule,
    );
    return { clock, calls, reach, setOffFrame: (value: boolean) => (offFrame = value) };
  };

  it("reaches only after the hover lingers, and returns on unhover", () => {
    const { clock, calls, reach } = setup();
    reach.hover([1, 2]);
    clock.advance(REACH_LINGER_MS - 1);
    expect(calls).toEqual([]);
    clock.advance(1);
    expect(calls).toEqual(["reach 1,2"]);
    reach.hover(null);
    expect(calls).toEqual(["reach 1,2", "back"]);
  });

  it("never reaches for a hover that ends before the linger, nor returns", () => {
    const { clock, calls, reach } = setup();
    reach.hover([1, 2]);
    clock.advance(REACH_LINGER_MS / 2);
    reach.hover(null);
    clock.advance(REACH_LINGER_MS);
    expect(calls).toEqual([]);
  });

  it("does not return when the ends were already in the frame", () => {
    const { clock, calls, reach, setOffFrame } = setup();
    setOffFrame(false);
    reach.hover([1, 2]);
    clock.advance(REACH_LINGER_MS);
    reach.hover(null);
    expect(calls).toEqual(["reach 1,2"]);
  });

  it("stays where the reader took the camera", () => {
    const { clock, calls, reach } = setup();
    reach.hover([1, 2]);
    clock.advance(REACH_LINGER_MS);
    reach.release();
    reach.hover(null);
    expect(calls).toEqual(["reach 1,2"]);
  });

  it("does nothing for a note with no lit link", () => {
    const { clock, calls, reach } = setup();
    reach.hover([1]);
    clock.advance(REACH_LINGER_MS * 2);
    expect(calls).toEqual([]);
  });
});
