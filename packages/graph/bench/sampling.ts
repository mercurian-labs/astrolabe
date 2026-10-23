/**
 * The bench's measuring pieces: percentiles, long animation frames (observed
 * and folded), overlap counting among label rectangles, bead motion by
 * presented frame, and a counter for the timers, intervals, and animation
 * frames that fire while the graph is meant to be at rest. Each takes what it
 * touches (a timer target, an observer class) so a test can hand it a fake.
 */

export interface Distribution {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export const EMPTY_DISTRIBUTION: Distribution = { p50: 0, p95: 0, p99: 0, max: 0 };

/** The `p` quantile (0–1) of `values` by linear interpolation between closest ranks; 0 for none. */
export function percentile(values: ReadonlyArray<number>, p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lower = sorted[low] ?? 0;
  return lower + ((sorted[high] ?? lower) - lower) * (rank - low);
}

export function distribution(values: ReadonlyArray<number>): Distribution {
  if (values.length === 0) return EMPTY_DISTRIBUTION;
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: Math.max(...values),
  };
}

export const median = (values: ReadonlyArray<number>) => percentile(values, 0.5);

/** The median of each field across runs. */
export function medianDistribution(runs: ReadonlyArray<Distribution>): Distribution {
  return {
    p50: median(runs.map((run) => run.p50)),
    p95: median(runs.map((run) => run.p95)),
    p99: median(runs.map((run) => run.p99)),
    max: median(runs.map((run) => run.max)),
  };
}

/** The slice of a PerformanceLongAnimationFrameTiming the fold reads. */
export interface LongFrameEntry {
  readonly startTime: number;
  readonly duration: number;
  readonly blockingDuration?: number;
}

export interface LongFrames {
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly blockingMs: number;
}

/** Long animation frames, folded: how many, how long in all, the longest, and the blocking time. */
export function foldLongFrames(entries: ReadonlyArray<LongFrameEntry>): LongFrames {
  let totalMs = 0;
  let maxMs = 0;
  let blockingMs = 0;
  for (const entry of entries) {
    totalMs += entry.duration;
    maxMs = Math.max(maxMs, entry.duration);
    blockingMs += entry.blockingDuration ?? 0;
  }
  return { count: entries.length, totalMs, maxMs, blockingMs };
}

/** The long frames that overlap the window from `start` to `end` (performance.now() times). */
export function longFramesIn(
  entries: ReadonlyArray<LongFrameEntry>,
  start: number,
  end: number,
): Array<LongFrameEntry> {
  return entries.filter(
    (entry) => entry.startTime < end && entry.startTime + entry.duration > start,
  );
}

/** The slice of PerformanceObserver that long-frame observation uses. */
export interface LongFrameObserverClass {
  readonly supportedEntryTypes: ReadonlyArray<string>;
  new (callback: (list: { getEntries(): ReadonlyArray<ObservedEntry> }) => void): {
    observe(options: { type: string; buffered?: boolean }): void;
    takeRecords(): ReadonlyArray<ObservedEntry>;
    disconnect(): void;
  };
}

interface ObservedEntry {
  readonly startTime: number;
  readonly duration: number;
}

function toLongFrame(entry: ObservedEntry): LongFrameEntry {
  const blocking: unknown = Reflect.get(entry, "blockingDuration");
  return {
    startTime: entry.startTime,
    duration: entry.duration,
    blockingDuration: typeof blocking === "number" ? blocking : 0,
  };
}

/**
 * Observe long animation frames from now; the returned stop takes the window's
 * end. The browser queues a frame's entry after the frame, so stop first lets
 * the last frames land (`drain`: a frame and a macrotask), takes the records
 * still queued, then disconnects, and keeps the entries overlapping the
 * window. Null where the browser reports no long animation frames.
 */
export function observeLongFrames(
  start: number,
  drain: () => Promise<void>,
  Observer: LongFrameObserverClass | undefined = globalThis.PerformanceObserver,
): (end: number) => Promise<Array<LongFrameEntry> | null> {
  if (Observer === undefined || !Observer.supportedEntryTypes.includes("long-animation-frame"))
    return () => Promise.resolve(null);
  const entries: Array<LongFrameEntry> = [];
  const take = (list: ReadonlyArray<ObservedEntry>) => {
    for (const entry of list) entries.push(toLongFrame(entry));
  };
  const observer = new Observer((list) => take(list.getEntries()));
  observer.observe({ type: "long-animation-frame", buffered: false });
  return async (end) => {
    await drain();
    take(observer.takeRecords());
    observer.disconnect();
    return longFramesIn(entries, start, end);
  };
}

/** Rectangles as label boxes hold them: parallel arrays, `count` in use. */
export interface Rectangles {
  readonly count: number;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly width: ArrayLike<number>;
  readonly height: ArrayLike<number>;
}

/** How many pairs of rectangles overlap, by a sweep along x: O(n log n) plus the overlaps. */
export function overlapCount(boxes: Rectangles): number {
  const order = Array.from({ length: boxes.count }, (_, index) => index).toSorted(
    (left, right) => (boxes.x[left] ?? 0) - (boxes.x[right] ?? 0),
  );
  let overlaps = 0;
  for (let at = 0; at < order.length; at += 1) {
    const a = order[at] ?? 0;
    const right = (boxes.x[a] ?? 0) + (boxes.width[a] ?? 0);
    const top = boxes.y[a] ?? 0;
    const bottom = top + (boxes.height[a] ?? 0);
    for (let next = at + 1; next < order.length; next += 1) {
      const b = order[next] ?? 0;
      if ((boxes.x[b] ?? 0) >= right) break;
      const bTop = boxes.y[b] ?? 0;
      if (bTop < bottom && bTop + (boxes.height[b] ?? 0) > top) overlaps += 1;
    }
  }
  return overlaps;
}

/**
 * Beads moving through a link hold, by presented frame. A rendered frame moved
 * the beads when a bead was visible and the positions' checksum changed from
 * the frame rendered before it; a presented frame in the hold counts as moving
 * when a frame that moved them rendered since the last presented one. Every
 * presented frame in the hold is in the denominator, so a dropped or unrendered
 * frame counts against the share.
 */
export class BeadMotion {
  #last: number | null = null;
  #moved = false;
  #holding = false;
  #presented = 0;
  #moving = 0;

  /** A frame rendered with this checksum and this many visible beads. */
  rendered(checksum: number, visible: number): void {
    if (this.#last !== null && visible > 0 && checksum !== this.#last) this.#moved = true;
    this.#last = checksum;
  }

  /** The link hold begins or ends. */
  hold(holding: boolean): void {
    this.#holding = holding;
    this.#moved = false;
  }

  /** A frame was presented (one requestAnimationFrame tick). */
  presented(): void {
    if (this.#holding) {
      this.#presented += 1;
      if (this.#moved) this.#moving += 1;
    }
    this.#moved = false;
  }

  /** The moving share of presented hold frames, or null when none were presented. */
  get share(): number | null {
    return this.#presented > 0 ? this.#moving / this.#presented : null;
  }
}

/** What a timer counter wraps: a window's timer, interval, and animation-frame functions. */
export interface TimerTarget {
  setTimeout: (handler: TimerHandler, timeout?: number, ...rest: Array<unknown>) => number;
  setInterval: (handler: TimerHandler, timeout?: number, ...rest: Array<unknown>) => number;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
}

const harnessCallbacks = new WeakSet<object>();

/** Tag a callback as the harness's own wait: a timer counter never counts it. */
export function harnessWait<Callback extends object>(callback: Callback): Callback {
  harnessCallbacks.add(callback);
  return callback;
}

export interface TimerCounter {
  /** Open the window: every wrapped callback that fires from now counts. */
  start(): void;
  /** Close the window and return what fired inside it. */
  stop(): { timers: number; frames: number };
  /** Put the originals back; callbacks already scheduled still fire, uncounted. */
  uninstall(): void;
}

/**
 * The rest step's proof that an idle graph asks for nothing. Install it before
 * the code under test is built, so every timeout, interval, and animation
 * frame that code schedules is wrapped; then every one that fires inside the
 * window counts, whenever it was scheduled. Callbacks tagged `harnessWait`
 * pass through unwrapped.
 */
export function installTimerCounter(target: TimerTarget): TimerCounter {
  const { setTimeout, setInterval, requestAnimationFrame } = target;
  let counting = false;
  let timers = 0;
  let frames = 0;
  const counted = (handler: TimerHandler): TimerHandler => {
    if (typeof handler !== "function" || harnessCallbacks.has(handler)) return handler;
    return (...args: Array<unknown>) => {
      if (counting) timers += 1;
      handler(...args);
    };
  };
  target.setTimeout = (handler, delay, ...rest) => setTimeout(counted(handler), delay, ...rest);
  target.setInterval = (handler, delay, ...rest) => setInterval(counted(handler), delay, ...rest);
  target.requestAnimationFrame = (callback) =>
    requestAnimationFrame(
      harnessCallbacks.has(callback)
        ? callback
        : (now) => {
            if (counting) frames += 1;
            callback(now);
          },
    );
  return {
    start: () => {
      counting = true;
      timers = 0;
      frames = 0;
    },
    stop: () => {
      counting = false;
      return { timers, frames };
    },
    uninstall: () => {
      target.setTimeout = setTimeout;
      target.setInterval = setInterval;
      target.requestAnimationFrame = requestAnimationFrame;
    },
  };
}
