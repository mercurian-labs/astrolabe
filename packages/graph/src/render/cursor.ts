/**
 * The agent's cursor on the map: the editor's agent cursor's twin. It always
 * exists. With nothing to do it is parked at the canvas's bottom-right corner,
 * labelled "Agent". When a checkpoint lands it travels from wherever it is to
 * each visit of the turn in play order, rests there, and travels home to the
 * park; it never fades, pops, or hurries. It stops beside a note, never on
 * it, its tip pointing at the note; along a link it rides the link and stops
 * just short of the far note. A floating label beside it says what it is
 * doing, in the play-by-play's words, from the moment it sets off.
 *
 * Everything here is in screen pixels, read from the scene each frame, so the
 * cursor follows notes as they glide and the park stays put under pan and
 * zoom. A travel takes its eased duration, longer for a long way so that no
 * frame at 120 Hz moves it more than about 12 pixels.
 */
import type { Visit } from "../model/plays.ts";
import type { TourInner, TourVisit } from "../model/tour.ts";

/** How long it takes to travel from one visit to the next (at least). */
export const CURSOR_TRAVEL = 0.45;
/** How long it takes to ride a link from source to target (at least). */
export const CURSOR_LINK = 0.6;
/** How long it rests on each visit. */
export const CURSOR_PAUSE = 0.35;
/** The fastest it travels on average, in pixels a second: an eased travel peaks at 1.5 times this, 10 px a frame at 120 Hz. */
export const CURSOR_SPEED = 800;
/** The caret, in CSS pixels: tip to back. */
export const CURSOR_PIXELS = 26;
/** The caret's paper outline, in CSS pixels. */
export const CURSOR_OUTLINE = 1.5;
/** Where the cursor parks: this far in from the canvas's right and bottom edges, in CSS pixels. */
export const PARK_INSET = { right: 56, bottom: 64 } as const;
/** What the label says while the cursor is parked or on its way home. */
export const AGENT_LABEL = "Agent";
/** The longest label it shows; a longer one ends in an ellipsis. */
export const AGENT_LABEL_MAX = 64;
/** A caret stops this many note radii from the note's centre (plus half its own size). */
const BESIDE_RADII = 1.6;

export type Point = { readonly x: number; readonly y: number };

/** What the cursor reads from the frame, in screen pixels. */
export interface CursorScene {
  /** A shown note's centre and drawn radius, or null when it is not drawn. */
  noteAt(note: number): { readonly x: number; readonly y: number; readonly r: number } | null;
  /** The park, in the frame's bottom-right corner. */
  park(): Point;
}

/** The cursor at a frame, in screen pixels. */
export interface CursorFrame {
  readonly x: number;
  readonly y: number;
  /** Which way the tip points, in screen radians (y down). */
  readonly angle: number;
  /** What its label says. */
  readonly label: string;
  /** Which way its label sits from the caret, as a unit vector: outward from the note. */
  readonly outward: Point;
  /** The play it is visiting (setting off for or resting on), or -1. */
  readonly play: number;
}

type Phase = "travel" | "ride" | "rest" | "wait" | "home" | "parked";

const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const length = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const unit = (from: Point, to: Point, fallback: Point): Point => {
  const d = length(from, to);
  return d < 1e-6 ? fallback : { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
};
/** A first visit is approached from the upper right. */
const UPPER_RIGHT: Point = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
/** Parked, the caret points up and to the left, into the canvas. */
const PARKED_ANGLE = Math.atan2(-1, -1);
const HALF = CURSOR_PIXELS / 2;

/** How long a stretch of `distance` pixels takes: at least `least`, and never faster than CURSOR_SPEED. */
export const travelSeconds = (distance: number, least: number) =>
  Math.max(least, distance / CURSOR_SPEED);

/** A step of a run: a visit, or opening or closing a container the run tells inside. */
export type CursorStep =
  | { readonly kind: "visit"; readonly visit: TourVisit }
  | { readonly kind: "open"; readonly inner: TourInner }
  | { readonly kind: "close"; readonly inner: TourInner };

/** A run's steps: each visit, and for a container its opening, its own visits, and its closing. */
export function cursorSteps(visits: ReadonlyArray<TourVisit>): Array<CursorStep> {
  return visits.flatMap((visit): Array<CursorStep> =>
    visit.inner === null
      ? [{ kind: "visit", visit }]
      : [
          { kind: "visit", visit },
          { kind: "open", inner: visit.inner },
          ...cursorSteps(visit.inner.visits),
          { kind: "close", inner: visit.inner },
        ],
  );
}

/** What a run asks of its host as it goes: open a container it tells inside, or close it again. */
export type CursorEvent =
  | { readonly kind: "arrive"; readonly visit: TourVisit }
  | { readonly kind: "open"; readonly inner: TourInner }
  | { readonly kind: "close"; readonly inner: TourInner };

/** How long it waits, at most, for an opened container's notes to show before going on. */
export const OPEN_WAIT = 1.2;

/**
 * A run of the cursor: the steps of a turn's tour (or one chosen play), then
 * home to the park unless it `stays` on its last visit. Step it with `at`
 * each frame, in time order; it reports what happened since the last step.
 */
export class CursorRun {
  #steps: Array<CursorStep>;
  readonly stays: boolean;
  #step = 0;
  #phase: Phase;
  #phaseStart: number;
  #duration = 0;
  #from: Point;
  /** The side the caret rests on, frozen when it sets off. */
  #side: Point = UPPER_RIGHT;
  #current: Point;
  #visited = 0;
  #events: Array<CursorEvent> = [];

  /** Start from `from` (where the cursor is now) at `now`, in seconds. */
  constructor(visits: ReadonlyArray<TourVisit>, from: Point, now: number, stays = false) {
    this.#steps = cursorSteps(visits);
    this.stays = stays;
    this.#from = from;
    this.#current = from;
    this.#phaseStart = now;
    this.#phase = this.#steps.length === 0 ? "home" : "travel";
  }

  get steps(): ReadonlyArray<CursorStep> {
    return this.#steps;
  }

  /**
   * More visits for a tour still out (travelling, riding, resting, or waiting
   * on an opening): it tells them after the ones it has, in order, without
   * going home between. False once it is on its way home or parked (or it
   * stays on a chosen play): the teller starts a new run then.
   */
  extend(visits: ReadonlyArray<TourVisit>): boolean {
    if (this.stays || this.#phase === "home" || this.#phase === "parked") return false;
    this.#steps = [...this.#steps, ...cursorSteps(visits)];
    return true;
  }

  /** Parked, with nothing left to do. */
  get parked(): boolean {
    return this.#phase === "parked";
  }

  /** Resting for good on a chosen play (it stays until sent home). */
  get resting(): boolean {
    return this.stays && this.#phase === "rest" && this.#step === this.#steps.length - 1;
  }

  /** The visit it is setting off for or resting on, or null. */
  get visit(): TourVisit | null {
    const step = this.#steps[this.#step];
    const busy = this.#phase === "travel" || this.#phase === "ride" || this.#phase === "rest";
    return busy && step?.kind === "visit" ? step.visit : null;
  }

  /** Whether it needs frames: moving or waiting. */
  moving(now: number): boolean {
    return !(this.parked || (this.resting && now - this.#phaseStart >= this.#duration));
  }

  /** Send it home from a chosen play it was staying on. */
  home(now: number, scene: CursorScene): void {
    if (this.parked) return;
    this.at(now, scene);
    this.#home(now, this.#current, scene);
  }

  /** What happened since the last call, in order: arrivals (their gestures fire), openings, closings. */
  takeEvents(): Array<CursorEvent> {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  /** Where it is now. */
  get point(): Point {
    return this.#current;
  }

  /** The visits it has told (reached), in order. */
  get visited(): number {
    return this.#visited;
  }

  /** Step to `now` (seconds) and say where it is. */
  at(now: number, scene: CursorScene): CursorFrame {
    for (let guard = 0; guard < 10_000; guard += 1) {
      if (this.#phase === "parked") break;
      if (this.#phase === "rest" && this.resting) break;
      if (this.#phase === "wait" && !this.#opened(scene) && now - this.#phaseStart < OPEN_WAIT)
        break;
      if (this.#phase !== "wait" && now - this.#phaseStart < this.#duration) break;
      this.#next(
        this.#phase === "wait"
          ? Math.min(now, this.#phaseStart + OPEN_WAIT)
          : this.#phaseStart + this.#duration,
        scene,
      );
    }
    const target = this.#target(scene);
    const t = this.#duration <= 0 ? 1 : (now - this.#phaseStart) / this.#duration;
    const moving = this.#phase === "travel" || this.#phase === "ride" || this.#phase === "home";
    this.#current = moving
      ? lerp(this.#from, target, smooth(t))
      : this.#phase === "wait"
        ? this.#current
        : target;
    const visit = this.visit;
    const homeward = this.#phase === "home" || this.#phase === "parked";
    const towards =
      visit === null
        ? null
        : scene.noteAt(
            this.#phase === "ride" || (this.#phase === "rest" && isLink(visit))
              ? visit.to
              : visit.note,
          );
    const angle =
      towards === null
        ? PARKED_ANGLE
        : Math.atan2(towards.y - this.#current.y, towards.x - this.#current.x);
    return {
      x: this.#current.x,
      y: this.#current.y,
      angle,
      label: visit === null ? (homeward ? AGENT_LABEL : this.#lastLabel) : visit.label,
      outward: visit === null ? { x: -1, y: 0 } : { x: -Math.cos(angle), y: -Math.sin(angle) },
      play: visit === null ? -1 : visit.play,
    };
  }

  #lastLabel = AGENT_LABEL;

  /** Whether the opening it waits on shows its first note yet. */
  #opened(scene: CursorScene): boolean {
    const next = this.#steps[this.#step + 1];
    return next === undefined || next.kind !== "visit" || scene.noteAt(next.visit.note) !== null;
  }

  /** Where the current phase is headed, now. */
  #target(scene: CursorScene): Point {
    if (this.#phase === "home" || this.#phase === "parked") return scene.park();
    if (this.#phase === "wait") return this.#current;
    const step = this.#steps[this.#step];
    if (step === undefined || step.kind !== "visit") return this.#current;
    const visit = step.visit;
    if (isLink(visit)) {
      const source = scene.noteAt(visit.note);
      const target = scene.noteAt(visit.to);
      if (source === null || target === null) return this.#current;
      const along = unit(source, target, UPPER_RIGHT);
      // On the link's line: just past the source's rim, then just short of the far note's.
      const near = source.r * BESIDE_RADII + HALF;
      const far = target.r * BESIDE_RADII + HALF;
      return this.#phase === "travel"
        ? { x: source.x + along.x * near, y: source.y + along.y * near }
        : { x: target.x - along.x * far, y: target.y - along.y * far };
    }
    const note = scene.noteAt(visit.note);
    if (note === null) return this.#current;
    const reach = note.r * BESIDE_RADII + HALF;
    return { x: note.x + this.#side.x * reach, y: note.y + this.#side.y * reach };
  }

  /** The phase after the current one, starting at `at`. */
  #next(at: number, scene: CursorScene): void {
    const ended = this.#target(scene);
    this.#current = ended;
    const step = this.#steps[this.#step];
    switch (this.#phase) {
      case "travel":
        if (step?.kind === "visit" && isLink(step.visit)) {
          const far = scene.noteAt(step.visit.to);
          const near = scene.noteAt(step.visit.note);
          const distance = far === null || near === null ? 0 : length(near, far);
          this.#set("ride", at, ended, travelSeconds(distance, CURSOR_LINK));
          return;
        }
        this.#arrive(step, at);
        return;
      case "ride":
        this.#arrive(step, at);
        return;
      case "rest":
      case "wait":
        this.#advance(at, ended, scene);
        return;
      case "home":
        this.#set("parked", at, ended, 0);
        return;
      case "parked":
        return;
    }
  }

  #arrive(step: CursorStep | undefined, at: number): void {
    if (step?.kind === "visit") {
      this.#events.push({ kind: "arrive", visit: step.visit });
      this.#visited += 1;
      this.#lastLabel = step.visit.label;
    }
    this.#set("rest", at, this.#current, CURSOR_PAUSE);
  }

  /** On to the next step: open or close a container, set off for a visit, or go home. */
  #advance(at: number, from: Point, scene: CursorScene): void {
    for (;;) {
      this.#step += 1;
      const step = this.#steps[this.#step];
      if (step === undefined) {
        this.#home(at, from, scene);
        return;
      }
      if (step.kind === "close") {
        this.#events.push({ kind: "close", inner: step.inner });
        continue;
      }
      if (step.kind === "open") {
        this.#events.push({ kind: "open", inner: step.inner });
        this.#set("wait", at, from, 0);
        return;
      }
      this.#setOff(at, from, scene);
      return;
    }
  }

  /** Set off for the current visit from `from`, choosing the side it will rest on. */
  #setOff(at: number, from: Point, scene: CursorScene): void {
    const step = this.#steps[this.#step];
    const note = step?.kind === "visit" ? scene.noteAt(step.visit.note) : null;
    // It rests on the side it arrived from; a run's first visit, from the upper right.
    this.#side = note === null || this.#step === 0 ? UPPER_RIGHT : unit(note, from, UPPER_RIGHT);
    this.#set("travel", at, from, 0);
    this.#duration = travelSeconds(length(from, this.#target(scene)), CURSOR_TRAVEL);
  }

  #home(at: number, from: Point, scene: CursorScene): void {
    this.#set("home", at, from, travelSeconds(length(from, scene.park()), CURSOR_TRAVEL));
  }

  #set(phase: Phase, at: number, from: Point, duration: number): void {
    this.#phase = phase;
    this.#phaseStart = at;
    this.#from = from;
    this.#duration = duration;
  }

  /** The first step: set off for the first visit (or home), with the scene in hand. */
  start(scene: CursorScene): void {
    if (this.#phase === "travel") this.#setOff(this.#phaseStart, this.#from, scene);
    else this.#home(this.#phaseStart, this.#from, scene);
  }
}

const isLink = (visit: Visit) =>
  (visit.verb === "link" || visit.verb === "unlink") && visit.to >= 0;

/** Where the cursor's popover sits, in CSS pixels from the frame's top left. */
export interface PopoverPlace {
  readonly left: number;
  readonly top: number;
  /**
   * The height it may take when the room it is given is shorter than it: the
   * host caps it there and its list scrolls inside. Null when it fits whole.
   */
  readonly maxHeight: number | null;
}

/** How far the popover keeps from the frame's edges, in CSS pixels. */
export const POPOVER_INSET = 8;

/**
 * How far around the cursor's tip the popover keeps clear, in CSS pixels: the
 * caret behind the tip and the note it visits ahead of it both lie within it.
 */
export const POPOVER_CLEARANCE = CURSOR_PIXELS + 6;

/**
 * The cursor's popover beside its caret, never over it or the note it visits
 * (it keeps out of the POPOVER_CLEARANCE box around the tip): past the caret's
 * back on the side its label sits (outward from the note), else the other side
 * when that one fits; when neither side fits (a narrow panel, the cursor
 * mid-frame), above or below the box, whichever has more room. Always inside
 * the frame: where the room is shorter than the popover, it says the height
 * it may take (`maxHeight`). A frame too narrow for it across pins it to the
 * left inset (the host's styles cap its width to the frame).
 */
export function popoverPlace(
  cursor: { readonly x: number; readonly y: number; readonly outward: Point },
  size: { readonly width: number; readonly height: number },
  frame: { readonly width: number; readonly height: number },
): PopoverPlace {
  const reach = POPOVER_CLEARANCE;
  const clamp = (value: number, extent: number, span: number) =>
    Math.max(POPOVER_INSET, Math.min(value, span - extent - POPOVER_INSET));
  const right = cursor.x + reach;
  const left = cursor.x - reach - size.width;
  const fitsRight = right + size.width <= frame.width - POPOVER_INSET;
  const fitsLeft = left >= POPOVER_INSET;
  if (fitsRight || fitsLeft) {
    const preferRight = cursor.outward.x >= 0;
    const x = (preferRight ? fitsRight : !fitsLeft) ? right : left;
    // Beside the box, the popover may take the frame's whole height.
    const room = Math.max(0, frame.height - 2 * POPOVER_INSET);
    const height = Math.min(size.height, room);
    return {
      left: x,
      top: clamp(cursor.y - height / 2, height, frame.height),
      maxHeight: height < size.height ? room : null,
    };
  }
  // Neither side: above or below the box, centred on the cursor across, as tall as the room.
  const roomAbove = Math.max(0, cursor.y - reach - POPOVER_INSET);
  const roomBelow = Math.max(0, frame.height - POPOVER_INSET - (cursor.y + reach));
  const above = roomAbove >= roomBelow;
  const room = above ? roomAbove : roomBelow;
  const height = Math.min(size.height, room);
  return {
    left: clamp(cursor.x - size.width / 2, size.width, frame.width),
    top: above ? cursor.y - reach - height : cursor.y + reach,
    maxHeight: height < size.height ? room : null,
  };
}
