/**
 * The on-demand render loop. Nothing draws unless something asked:
 *
 * - `invalidate()` asks for one frame (a state change, a resize, a font arriving);
 * - `animate(animation)` keeps frames coming while the animation reports it is
 *   still moving (springs, a camera flight, orbit damping, a crossfade);
 * - `beforeFrame(task)` runs work on the next frame without forcing a draw
 *   (hover picking): the frame draws only if the task says something changed.
 *
 * When every animation has settled and nothing is invalid, no frame is
 * requested at all: the graph at rest costs zero frames per second.
 */
export interface Animation {
  /** Advance by `dt` seconds; return true while still moving. */
  step(dt: number, now: number): boolean;
}

export interface FrameClock {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

export const browserClock: FrameClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** The longest step an animation sees, so a tab returning from the background does not jump. */
const MAX_DT = 1 / 20;

export class FrameScheduler {
  readonly #clock: FrameClock;
  readonly #render: () => void;
  readonly #animations = new Set<Animation>();
  readonly #tasks: Array<() => boolean> = [];
  #invalid = false;
  #disposed = false;
  #handle: number | null = null;
  #last: number | null = null;
  /** Timestamps of rendered frames in the last second, for the debug readout. */
  readonly #rendered: Array<number> = [];
  #total = 0;

  constructor(clock: FrameClock, render: () => void) {
    this.#clock = clock;
    this.#render = render;
  }

  /** Whether a frame is pending. False means the loop is asleep. */
  get awake(): boolean {
    return this.#handle !== null;
  }

  get animating(): boolean {
    return this.#animations.size > 0;
  }

  /** Frames rendered since creation. */
  get totalFrames(): number {
    return this.#total;
  }

  /** Frames rendered in the second before `now`. */
  framesInLastSecond(now: number): number {
    while (this.#rendered.length > 0 && (this.#rendered[0] ?? 0) <= now - 1000) {
      this.#rendered.shift();
    }
    return this.#rendered.length;
  }

  invalidate(): void {
    if (this.#disposed) return;
    this.#invalid = true;
    this.#wake();
  }

  animate(animation: Animation): void {
    if (this.#disposed) return;
    this.#animations.add(animation);
    this.#wake();
  }

  stop(animation: Animation): void {
    this.#animations.delete(animation);
  }

  beforeFrame(task: () => boolean): void {
    if (this.#disposed) return;
    this.#tasks.push(task);
    this.#wake();
  }

  /** Stop for good: late requests (a label font arriving after unmount) never draw again. */
  dispose(): void {
    this.#disposed = true;
    if (this.#handle !== null) this.#clock.cancel(this.#handle);
    this.#handle = null;
    this.#animations.clear();
    this.#tasks.length = 0;
  }

  #wake(): void {
    if (this.#disposed || this.#handle !== null) return;
    this.#handle = this.#clock.request((now) => this.frame(now));
  }

  /** One frame: run tasks and animations, draw if anything changed, sleep if all is still. */
  frame(now: number): void {
    this.#handle = null;
    const dt =
      this.#last === null ? 1 / 60 : Math.min(MAX_DT, Math.max(0, (now - this.#last) / 1000));
    let dirty = this.#invalid;
    this.#invalid = false;
    for (const task of this.#tasks.splice(0)) if (task()) dirty = true;
    for (const animation of this.#animations) {
      dirty = true;
      if (!animation.step(dt, now)) this.#animations.delete(animation);
    }
    if (dirty) {
      this.#render();
      this.#total += 1;
      this.#rendered.push(now);
    }
    if (this.#animations.size > 0 || this.#invalid || this.#tasks.length > 0) {
      this.#last = now;
      this.#wake();
    } else {
      // Asleep: the next wake measures its first step fresh.
      this.#last = null;
    }
  }
}
