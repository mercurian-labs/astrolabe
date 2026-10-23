import { describe, expect, it } from "vite-plus/test";

import {
  BeadMotion,
  distribution,
  foldLongFrames,
  harnessWait,
  installTimerCounter,
  medianDistribution,
  observeLongFrames,
  overlapCount,
  percentile,
  type LongFrameObserverClass,
  type TimerTarget,
} from "./sampling.ts";

describe("percentiles", () => {
  it("interpolates between closest ranks and summarises a run", () => {
    const values = Array.from({ length: 101 }, (_, index) => index);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile([1, 2], 0.5)).toBe(1.5);
    expect(percentile([], 0.5)).toBe(0);
    expect(distribution([5, 1, 3])).toEqual({ p50: 3, p95: 4.8, p99: 4.96, max: 5 });
    expect(distribution([])).toEqual({ p50: 0, p95: 0, p99: 0, max: 0 });
  });

  it("takes the median of each field across runs", () => {
    const run = (value: number) => ({ p50: value, p95: value * 2, p99: value * 3, max: value * 4 });
    expect(medianDistribution([run(1), run(9), run(2)])).toEqual(run(2));
  });
});

describe("foldLongFrames", () => {
  it("counts long animation frames, their total and longest, and the blocking time", () => {
    expect(
      foldLongFrames([
        { startTime: 0, duration: 60, blockingDuration: 10 },
        { startTime: 100, duration: 120 },
        { startTime: 300, duration: 55, blockingDuration: 5 },
      ]),
    ).toEqual({ count: 3, totalMs: 235, maxMs: 120, blockingMs: 15 });
    expect(foldLongFrames([])).toEqual({ count: 0, totalMs: 0, maxMs: 0, blockingMs: 0 });
  });
});

describe("overlapCount", () => {
  it("counts each overlapping pair of rectangles once", () => {
    const boxes = {
      count: 4,
      x: [0, 5, 20, 2],
      y: [0, 2, 0, 30],
      width: [10, 10, 5, 3],
      height: [5, 5, 5, 5],
    };
    // 0 and 1 overlap; 2 stands alone; 3 lies below them all.
    expect(overlapCount(boxes)).toBe(1);
    expect(overlapCount({ ...boxes, count: 0 })).toBe(0);
  });
});

describe("observeLongFrames", () => {
  /** A fake observer: `deliver` runs the callback; `queue` holds entries only takeRecords returns. */
  function fakeObserver() {
    const queued: Array<{ startTime: number; duration: number }> = [];
    let deliver: (entries: Array<{ startTime: number; duration: number }>) => void = () => {};
    let disconnected = false;
    const Observer: LongFrameObserverClass = class {
      static readonly supportedEntryTypes = ["long-animation-frame"];
      constructor(
        callback: (list: {
          getEntries(): ReadonlyArray<{ startTime: number; duration: number }>;
        }) => void,
      ) {
        deliver = (entries) => callback({ getEntries: () => entries });
      }
      observe() {}
      takeRecords() {
        return queued.splice(0);
      }
      disconnect() {
        disconnected = true;
      }
    };
    return {
      Observer,
      queued,
      deliver: (entries: Array<{ startTime: number; duration: number }>) => deliver(entries),
      disconnected: () => disconnected,
    };
  }

  it("counts a long frame still queued when the scenario ends, as at the end of a load", async () => {
    const fake = fakeObserver();
    const stop = observeLongFrames(1000, () => Promise.resolve(), fake.Observer);
    fake.deliver([{ startTime: 1100, duration: 60 }]);
    // The load's own long frame: it ends as the window does, and the browser has not delivered it yet.
    fake.queued.push({ startTime: 1200, duration: 950 });
    const frames = await stop(2150);
    expect(frames?.map((frame) => frame.duration)).toEqual([60, 950]);
    expect(fake.disconnected()).toBe(true);
  });

  it("drains before it takes the records, and keeps only frames overlapping the window", async () => {
    const fake = fakeObserver();
    const stop = observeLongFrames(
      1000,
      () => {
        // The last frame's entry lands during the drain.
        fake.queued.push({ startTime: 1900, duration: 80 });
        return Promise.resolve();
      },
      fake.Observer,
    );
    fake.deliver([
      { startTime: 800, duration: 100 },
      { startTime: 950, duration: 100 },
      { startTime: 2100, duration: 70 },
    ]);
    const frames = await stop(2000);
    expect(frames?.map((frame) => frame.startTime)).toEqual([950, 1900]);
  });

  it("reports null where the browser has no long animation frames", async () => {
    const fake = fakeObserver();
    const Unsupported: LongFrameObserverClass = class extends fake.Observer {
      static override readonly supportedEntryTypes = [];
    };
    expect(await observeLongFrames(0, () => Promise.resolve(), Unsupported)(10)).toBeNull();
  });
});

describe("BeadMotion", () => {
  it("counts no presented frame as moving while the beads stand still", () => {
    const motion = new BeadMotion();
    motion.hold(true);
    for (let frame = 0; frame < 10; frame += 1) {
      motion.rendered(42, 3);
      motion.presented();
    }
    expect(motion.share).toBe(0);
  });

  it("counts presented frames whose beads advanced, and a dropped frame against them", () => {
    const motion = new BeadMotion();
    motion.rendered(0, 3);
    motion.hold(true);
    for (let frame = 1; frame <= 8; frame += 1) {
      motion.rendered(frame, 3);
      motion.presented();
    }
    // Two presented frames with no render between them: the second moved nothing.
    motion.presented();
    motion.presented();
    motion.hold(false);
    expect(motion.share).toBe(8 / 10);
  });

  it("does not count movement of invisible beads, nor frames outside the hold", () => {
    const motion = new BeadMotion();
    motion.rendered(1, 3);
    motion.rendered(2, 3);
    motion.presented();
    expect(motion.share).toBeNull();
    motion.hold(true);
    motion.rendered(3, 0);
    motion.presented();
    expect(motion.share).toBe(0);
  });
});

describe("installTimerCounter", () => {
  /** A fake window: timers and frames queue until `fire` runs them; intervals stay queued. */
  function fakeWindow() {
    const queue: Array<{ run: () => void; repeat: boolean }> = [];
    const target: TimerTarget = {
      setTimeout: (handler) => {
        if (typeof handler === "function") queue.push({ run: () => handler(), repeat: false });
        return queue.length;
      },
      setInterval: (handler) => {
        if (typeof handler === "function") queue.push({ run: () => handler(), repeat: true });
        return queue.length;
      },
      requestAnimationFrame: (callback) => {
        queue.push({ run: () => callback(0), repeat: false });
        return queue.length;
      },
    };
    const fire = () => {
      const due = queue.splice(0);
      for (const timer of due) {
        timer.run();
        if (timer.repeat) queue.push(timer);
      }
    };
    return { target, fire };
  }

  it("counts callbacks scheduled before the window that fire inside it, intervals each time, but not the harness's waits", () => {
    const { target, fire } = fakeWindow();
    const originals = { ...target };
    const counter = installTimerCounter(target);
    // The renderer's construction, under the counter: a timeout and an interval.
    let ran = 0;
    target.setTimeout(() => {
      ran += 1;
    }, 100);
    target.setInterval(() => {
      ran += 1;
    }, 50);
    target.requestAnimationFrame(() => {
      ran += 1;
    });
    // The harness waits through the window on its own tagged timeout and frame.
    target.setTimeout(
      harnessWait(() => {}),
      10_000,
    );
    target.requestAnimationFrame(harnessWait(() => {}));
    counter.start();
    fire();
    fire();
    const counts = counter.stop();
    expect(ran).toBe(4);
    expect(counts).toEqual({ timers: 3, frames: 1 });
    counter.uninstall();
    expect(target.setTimeout).toBe(originals.setTimeout);
    expect(target.setInterval).toBe(originals.setInterval);
    expect(target.requestAnimationFrame).toBe(originals.requestAnimationFrame);
  });

  it("counts nothing that fires before the window opens or after it closes", () => {
    const { target, fire } = fakeWindow();
    const counter = installTimerCounter(target);
    target.setInterval(() => {}, 50);
    fire();
    counter.start();
    const inside = counter.stop();
    fire();
    expect(inside).toEqual({ timers: 0, frames: 0 });
    expect(counter.stop()).toEqual({ timers: 0, frames: 0 });
    counter.uninstall();
  });
});
