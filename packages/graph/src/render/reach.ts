/**
 * The camera reach: a hovered note's lit links can end outside the frame.
 * After the hover lingers, the camera pans just enough to bring those ends
 * inside the frame's edge, and returns when the hover ends; the notes never
 * move. A reader who takes the camera meanwhile keeps it where it is.
 */

/** How long a hover lingers before the camera reaches for its links' far ends. */
export const REACH_LINGER_MS = 350;
/** Reached notes land this share of the frame's half-extent inside its edge. */
export const REACH_MARGIN = 0.12;

/** A flat frame in world units: its centre and half-extents. */
export interface ReachFrame {
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
}

/** Shift `low`..`high` into `centre ± half`, keeping `keep` inside; 0 when it already is. */
function shiftAxis(centre: number, half: number, low: number, high: number, keep: number): number {
  let shift = 0;
  if (high > centre + half) shift = high - (centre + half);
  if (low < centre - half + shift) shift = low - (centre - half);
  // Wider than the frame: bring the far end in as far as the kept point allows.
  return Math.min(Math.max(shift, keep - (centre + half)), keep - (centre - half));
}

/**
 * The least pan that brings every point inside the frame's margin, keeping the
 * first point (the hovered note) inside; null when every point already is.
 */
export function reachShift(
  frame: ReachFrame,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): { readonly dx: number; readonly dy: number } | null {
  const first = points[0];
  if (first === undefined) return null;
  const halfWidth = frame.halfWidth * (1 - REACH_MARGIN);
  const halfHeight = frame.halfHeight * (1 - REACH_MARGIN);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const dx = shiftAxis(frame.x, halfWidth, Math.min(...xs), Math.max(...xs), first.x);
  const dy = shiftAxis(frame.y, halfHeight, Math.min(...ys), Math.max(...ys), first.y);
  return Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 ? null : { dx, dy };
}

/** Runs `run` after `ms`; returns what cancels it. */
type Schedule = (run: () => void, ms: number) => () => void;

const browserSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/**
 * The reach's timing. `reach` pans toward notes and says whether it moved;
 * `back` returns the camera to where the first reach found it.
 */
export class CameraReach {
  readonly #reach: (notes: ReadonlyArray<number>) => boolean;
  readonly #back: () => void;
  readonly #schedule: Schedule;
  #cancelTimer: (() => void) | null = null;
  #reached = false;

  constructor(
    reach: (notes: ReadonlyArray<number>) => boolean,
    back: () => void,
    schedule: Schedule = browserSchedule,
  ) {
    this.#reach = reach;
    this.#back = back;
    this.#schedule = schedule;
  }

  /** The camera is reaching (and will return on unhover). */
  get reached(): boolean {
    return this.#reached;
  }

  /** A hover on these notes (the hovered note first, then its links' ends), or none. */
  hover(notes: ReadonlyArray<number> | null): void {
    this.#cancel();
    if (notes === null || notes.length < 2) {
      if (this.#reached) {
        this.#reached = false;
        this.#back();
      }
      return;
    }
    this.#cancelTimer = this.#schedule(() => {
      this.#cancelTimer = null;
      if (this.#reach(notes)) this.#reached = true;
    }, REACH_LINGER_MS);
  }

  /** The reader took the camera: nothing returns. */
  release(): void {
    this.#cancel();
    this.#reached = false;
  }

  dispose(): void {
    this.#cancel();
  }

  #cancel(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }
}
