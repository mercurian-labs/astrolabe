/**
 * One gesture per verb when the cursor reaches a note: written draws in with a ripple, amended
 * sweeps and brightens, read glances, removed drains to a fading outline. Gestures are marks over
 * the note, so no renderer's node drawing changes, and each leaves the note at rest (a removed one
 * stays drained). An unreached written note waits as a faint outline.
 */

export type GestureVerb = "write" | "amend" | "read" | "remove";

/** How long each gesture runs, in seconds. */
export const GESTURE_SECONDS: Readonly<Record<GestureVerb, number>> = {
  write: 0.65,
  amend: 0.6,
  read: 0.5,
  remove: 0.7,
};

export type MarkColor = "paper" | "ink" | "accent";

/** A mark drawn over the map: positions and radii in world units, line widths in CSS pixels. */
export type Mark =
  | {
      readonly kind: "disc";
      readonly x: number;
      readonly y: number;
      readonly r: number;
      readonly color: MarkColor;
      readonly alpha: number;
      /** A soft edge (a halo) rather than a crisp one. */
      readonly soft: boolean;
    }
  | {
      readonly kind: "arc";
      readonly x: number;
      readonly y: number;
      readonly r: number;
      /** Where the arc starts and how far it runs, in radians, counterclockwise from +x. */
      readonly start: number;
      readonly sweep: number;
      readonly width: number;
      readonly color: MarkColor;
      readonly alpha: number;
    }
  | {
      readonly kind: "cursor";
      /** Its tip, in world units. */
      readonly x: number;
      readonly y: number;
      /** Tip to back, in CSS pixels. */
      readonly size: number;
      /** Which way the tip points, in world radians (counterclockwise from +x). */
      readonly angle: number;
      readonly color: MarkColor;
      readonly alpha: number;
    }
  | {
      /** The cursor label's chip: a rectangle in world units with a hairline border. */
      readonly kind: "rect";
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly color: MarkColor;
      readonly border: MarkColor;
      /** The border's width, in CSS pixels. */
      readonly width: number;
      readonly alpha: number;
    };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
/** The house ease for gestures: fast out, soft landing. */
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
/** Up and back down over 0..1: 0 at both ends, 1 in the middle. */
const bump = (t: number) => Math.sin(Math.PI * clamp01(t));
const TAU = Math.PI * 2;

/** A written note the cursor has not reached: covered to a faint outline. */
export function pendingMarks(x: number, y: number, r: number): Array<Mark> {
  return [
    { kind: "disc", x, y, r: r * 1.02, color: "paper", alpha: 1, soft: false },
    { kind: "arc", x, y, r, start: 0, sweep: TAU, width: 1, color: "accent", alpha: 0.3 },
  ];
}

/** A removed note once its gesture is done: drained away. */
export function goneMarks(x: number, y: number, r: number): Array<Mark> {
  return [{ kind: "disc", x, y, r: r * 1.02, color: "paper", alpha: 1, soft: false }];
}

/**
 * The marks of gesture `verb` at `t` seconds since it started, for a note at
 * (x, y) of radius r. Before it starts it draws what precedes it (a written
 * note's outline; nothing else); once done it draws the rest state: nothing,
 * or a removed note's drained cover.
 */
export function gestureMarks(
  verb: GestureVerb,
  t: number,
  x: number,
  y: number,
  r: number,
): Array<Mark> {
  const length = GESTURE_SECONDS[verb];
  if (t < 0) return verb === "write" ? pendingMarks(x, y, r) : [];
  if (t >= length) return verb === "remove" ? goneMarks(x, y, r) : [];
  const p = t / length;
  switch (verb) {
    case "write": {
      // The ring closes over the first 40%, the dot fills over the next 30%, one ripple spreads from 40% on.
      const close = easeOut(p / 0.4);
      const fill = easeOut((p - 0.4) / 0.3);
      const spread = clamp01((p - 0.4) / 0.6);
      // At 0 this is exactly the waiting outline; the closing stroke draws over it.
      const marks: Array<Mark> = [
        { kind: "disc", x, y, r: r * 1.02, color: "paper", alpha: 1 - fill, soft: false },
        {
          kind: "arc",
          x,
          y,
          r,
          start: 0,
          sweep: TAU,
          width: 1,
          color: "accent",
          alpha: 0.3 * (1 - fill),
        },
        {
          kind: "arc",
          x,
          y,
          r,
          start: Math.PI / 2,
          sweep: TAU * close,
          width: 1.5,
          color: "accent",
          alpha: 1 - fill,
        },
      ];
      if (spread > 0) {
        marks.push({
          kind: "arc",
          x,
          y,
          r: r * (1 + 2 * easeOut(spread)),
          start: 0,
          sweep: TAU,
          width: 1.2,
          color: "accent",
          alpha: 0.6 * (1 - spread),
        });
      }
      return marks;
    }
    case "amend": {
      // A quarter-turn stroke travels once around; the fill brightens and settles.
      const head = TAU * easeOut(p / 0.85);
      const stroke = Math.PI / 2;
      return [
        { kind: "disc", x, y, r, color: "paper", alpha: 0.45 * bump(p), soft: false },
        {
          kind: "arc",
          x,
          y,
          r: r * 1.35,
          start: Math.PI / 2 - head,
          sweep: stroke * bump(p / 0.85),
          width: 1.5,
          color: "accent",
          alpha: bump(p),
        },
      ];
    }
    case "read":
      return [
        { kind: "disc", x, y, r: r * 2.2, color: "accent", alpha: 0.3 * bump(p), soft: true },
      ];
    case "remove": {
      // The fill drains over the first half to an ink outline, which then fades.
      const drain = easeOut(p / 0.5);
      const fade = clamp01((p - 0.5) / 0.5);
      return [
        { kind: "disc", x, y, r: r * 1.02, color: "paper", alpha: drain, soft: false },
        {
          kind: "arc",
          x,
          y,
          r,
          start: 0,
          sweep: TAU,
          width: 1.2,
          color: "ink",
          alpha: drain * (1 - fade),
        },
      ];
    }
  }
}

/**
 * The gestures of a checkpoint, by note (universe index), on the renderer's
 * clock in seconds: written notes waiting for the cursor, gestures running,
 * and removed notes drained. Cleared when the checkpoint changes.
 */
export class Gestures {
  readonly #pending = new Set<number>();
  readonly #running = new Map<number, { readonly verb: GestureVerb; readonly start: number }>();
  readonly #gone = new Set<number>();

  /** A written note waits, drawn as an outline, until its gesture fires. */
  pend(note: number): void {
    this.#pending.add(note);
  }

  fire(note: number, verb: GestureVerb, now: number): void {
    this.#pending.delete(note);
    this.#gone.delete(note);
    this.#running.set(note, { verb, start: now });
  }

  /** Every gesture and mark gone: a new checkpoint. */
  clear(): void {
    this.#pending.clear();
    this.#running.clear();
    this.#gone.clear();
  }

  /** Let every waiting note draw itself now (the cursor will not reach them). */
  release(now: number): void {
    for (const note of this.#pending) this.fire(note, "write", now);
  }

  /** Whether a gesture is still running at `now`; finished ones settle into their rest state. */
  active(now: number): boolean {
    for (const [note, gesture] of this.#running) {
      if (now - gesture.start < GESTURE_SECONDS[gesture.verb]) continue;
      this.#running.delete(note);
      if (gesture.verb === "remove") this.#gone.add(note);
    }
    return this.#running.size > 0;
  }

  /** Whether anything draws at all (waiting, running, or drained). */
  get any(): boolean {
    return this.#pending.size + this.#running.size + this.#gone.size > 0;
  }

  /** The marks of every gesture now, each note placed by `place` (or skipped when it is not drawn). */
  marks(
    now: number,
    place: (note: number) => { readonly x: number; readonly y: number; readonly r: number } | null,
  ): Array<Mark> {
    const marks: Array<Mark> = [];
    for (const note of this.#pending) {
      const at = place(note);
      if (at !== null) marks.push(...pendingMarks(at.x, at.y, at.r));
    }
    for (const note of this.#gone) {
      const at = place(note);
      if (at !== null) marks.push(...goneMarks(at.x, at.y, at.r));
    }
    for (const [note, gesture] of this.#running) {
      const at = place(note);
      if (at !== null)
        marks.push(...gestureMarks(gesture.verb, now - gesture.start, at.x, at.y, at.r));
    }
    return marks;
  }
}
