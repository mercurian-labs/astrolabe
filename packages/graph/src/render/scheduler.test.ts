import { describe, expect, it } from "vite-plus/test";

import { FrameScheduler, type Animation, type FrameClock } from "./scheduler.ts";

/** A clock whose frames run only when the test says so. */
function manualClock() {
  let pending: ((now: number) => void) | null = null;
  let now = 0;
  let requests = 0;
  const clock: FrameClock = {
    request: (callback) => {
      requests += 1;
      pending = callback;
      return requests;
    },
    cancel: () => {
      pending = null;
    },
  };
  return {
    clock,
    get pending() {
      return pending !== null;
    },
    get requests() {
      return requests;
    },
    /** Run frames until the loop sleeps, up to a limit; returns how many ran. */
    run(limit = 1000) {
      let frames = 0;
      while (pending !== null && frames < limit) {
        const callback = pending;
        pending = null;
        now += 16;
        callback(now);
        frames += 1;
      }
      return frames;
    },
  };
}

function counted(steps: number): Animation & { calls: number } {
  const animation = {
    calls: 0,
    step: () => {
      animation.calls += 1;
      return animation.calls < steps;
    },
  };
  return animation;
}

describe("FrameScheduler", () => {
  it("does no work at all when nothing animates", () => {
    const frames = manualClock();
    let renders = 0;
    const scheduler = new FrameScheduler(frames.clock, () => (renders += 1));
    expect(frames.requests).toBe(0);
    expect(frames.run()).toBe(0);
    expect(renders).toBe(0);
    expect(scheduler.awake).toBe(false);
  });

  it("draws one frame per invalidation, however many arrive before it", () => {
    const frames = manualClock();
    let renders = 0;
    const scheduler = new FrameScheduler(frames.clock, () => (renders += 1));
    scheduler.invalidate();
    scheduler.invalidate();
    scheduler.invalidate();
    expect(frames.run()).toBe(1);
    expect(renders).toBe(1);
    expect(scheduler.awake).toBe(false);
  });

  it("keeps drawing while an animation moves, then sleeps", () => {
    const frames = manualClock();
    let renders = 0;
    const scheduler = new FrameScheduler(frames.clock, () => (renders += 1));
    const animation = counted(5);
    scheduler.animate(animation);
    expect(frames.run()).toBe(5);
    expect(renders).toBe(5);
    expect(scheduler.animating).toBe(false);
    expect(scheduler.awake).toBe(false);
    expect(frames.pending).toBe(false);
  });

  it("runs a before-frame task without drawing unless it reports a change", () => {
    const frames = manualClock();
    let renders = 0;
    const scheduler = new FrameScheduler(frames.clock, () => (renders += 1));
    scheduler.beforeFrame(() => false);
    expect(frames.run()).toBe(1);
    expect(renders).toBe(0);
    scheduler.beforeFrame(() => true);
    frames.run();
    expect(renders).toBe(1);
  });

  it("counts the frames drawn in the last second", () => {
    const frames = manualClock();
    const scheduler = new FrameScheduler(frames.clock, () => {});
    scheduler.animate(counted(10));
    frames.run();
    expect(scheduler.framesInLastSecond(160)).toBe(10);
    expect(scheduler.framesInLastSecond(5000)).toBe(0);
    expect(scheduler.totalFrames).toBe(10);
  });

  it("stops an animation on request and cancels on dispose", () => {
    const frames = manualClock();
    const scheduler = new FrameScheduler(frames.clock, () => {});
    const endless = counted(Infinity);
    scheduler.animate(endless);
    frames.run(3);
    scheduler.stop(endless);
    frames.run();
    expect(scheduler.awake).toBe(false);
    scheduler.animate(endless);
    scheduler.dispose();
    expect(frames.pending).toBe(false);
  });

  it("requests nothing after dispose", () => {
    const frames = manualClock();
    let renders = 0;
    let tasks = 0;
    const scheduler = new FrameScheduler(frames.clock, () => (renders += 1));
    scheduler.dispose();
    scheduler.invalidate();
    scheduler.animate(counted(5));
    scheduler.beforeFrame(() => {
      tasks += 1;
      return true;
    });
    expect(frames.requests).toBe(0);
    expect(frames.run()).toBe(0);
    expect(renders).toBe(0);
    expect(tasks).toBe(0);
    expect(scheduler.awake).toBe(false);
  });
});
