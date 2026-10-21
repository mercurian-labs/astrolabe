/**
 * The agent's cursor telling a turn, shared by every renderer: the tour of the
 * landing turn's visits (travel, ride, open, close), the gestures it leaves on
 * the notes it reaches, what the tour has told (lit quietly once told, the
 * visit being told in full with its beads), and the parked cursor with its
 * chip. A renderer hosts it: it says where notes are on screen and how a
 * screen point maps onto the plane its marks draw on, and draws what each
 * frame returns. The cursor works in screen pixels; marks come back in the
 * host's plane (world units on a flat camera, overlay pixels over a 3D one).
 */
import type { PlayFocus, PlayLink } from "../model/plays.ts";
import { sameVisits } from "../model/plays.ts";
import type { TourInner, TourVisit } from "../model/tour.ts";
import { tourSteps } from "../model/tour.ts";
import {
  AGENT_LABEL,
  AGENT_LABEL_MAX,
  CURSOR_OUTLINE,
  CURSOR_PIXELS,
  CursorRun,
  PARK_INSET,
  type CursorFrame,
  type CursorScene,
} from "./cursor.ts";
import type { AgentDraw } from "./flat/drawer.ts";
import { Gestures, type Mark } from "./gestures.ts";

export const AGENT_LABEL_PIXELS = 11;
const CHIP_PAD_X = 6;
const CHIP_PAD_Y = 4;
const NO_MARKS: ReadonlyArray<Mark> = [];

/** What a renderer gives its storyteller. */
export interface StoryHost {
  /** The frame's size in CSS pixels. */
  size(): { readonly width: number; readonly height: number };
  /** A shown note (universe index) on screen: centre and drawn radius in pixels, or null. */
  noteOnScreen(note: number): { readonly x: number; readonly y: number; readonly r: number } | null;
  /** A shown note where its gesture draws, in the plane's units, or null when it is not drawn. */
  noteOnPlane(note: number): { readonly x: number; readonly y: number; readonly r: number } | null;
  /** A screen point (CSS pixels, y down) as a point of the plane. */
  toPlane(x: number, y: number): { readonly x: number; readonly y: number };
  /** Whether the landing turn's story is lit. */
  storyLit(): boolean;
  /** The tour is still telling: a lit story holds. */
  holdStory(): void;
  /** What the tour has told changed: light the story anew (unless a chosen play holds it). */
  relight(): void;
  /** The tour opened (true) or closed (false) a container: keep or restore the survey's camera. */
  tourCamera(open: boolean): void;
  onCursor(play: number | null): void;
  onDrill(inner: TourInner, open: boolean): void;
  /** Where the cursor is drawn, whenever that changes: a host's popover rides beside it. */
  onCursorAt?(at: CursorAt): void;
  /** A tour (not a chosen play, not a trip home) has ended and the cursor is parked: frame the survey again. */
  tourEnded?(): void;
  /** Ask for frames until the telling says it is still. */
  animate(): void;
  invalidate(): void;
}

/** The cursor as drawn this frame, in the frame's CSS pixels. */
export interface CursorAt {
  readonly x: number;
  readonly y: number;
  /** Which way its label sits from the caret: outward from the note it visits. */
  readonly outward: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
}

export class Storyteller {
  readonly #host: StoryHost;
  #visits: ReadonlyArray<TourVisit> = [];
  /** What the tour has told: the visit it is on, the links and notes of those it has reached. */
  #told: {
    visit: TourVisit | null;
    touring: boolean;
    readonly links: Map<number, PlayLink>;
    readonly notes: Set<number>;
  } | null = null;
  readonly #gestures = new Gestures();
  /** The cursor's run, or null while it is parked with nothing to do. */
  #run: CursorRun | null = null;
  #cursorPlay = -1;
  /** The host shows the turn's moves in a popover beside the cursor: the chip gives way to it. */
  #expanded = false;
  /** The chip as last drawn, in CSS pixels, or null while it gives way to the popover. */
  #chip: { left: number; top: number; width: number; height: number } | null = null;
  #at: CursorAt | null = null;

  constructor(host: StoryHost) {
    this.#host = host;
  }

  get visits(): ReadonlyArray<TourVisit> {
    return this.#visits;
  }

  /** The cursor stays on a chosen play (until it is let go). */
  get holding(): boolean {
    return this.#run !== null && this.#run.stays && !this.#run.parked;
  }

  /** The cursor is out on a tour or a chosen play (not parked). */
  get touring(): boolean {
    return this.#run !== null && !this.#run.parked;
  }

  /**
   * The checkpoint's moves at the level shown; returns whether they changed
   * (the story relights then). With `appended`, the moves are the same
   * turn's, grown while the agent works, and `appended` is the tour of the
   * new plays alone (`turnTour` with `only`): the cursor goes on to tell it,
   * in order, after whatever it is telling now, without telling the earlier
   * moves again or redrawing what they left. Otherwise a new checkpoint: the
   * cursor heads home, and the host's landing starts the tour.
   */
  setMoves(
    visits: ReadonlyArray<TourVisit>,
    appended: ReadonlyArray<TourVisit> | null = null,
  ): boolean {
    // The same visits handed again (a new view of the same checkpoint) change nothing.
    if (sameVisits(visits, this.#visits)) return false;
    this.#visits = visits;
    if (appended !== null) {
      this.#tellAppended(appended);
      this.#host.invalidate();
      return true;
    }
    this.#gestures.clear();
    this.#told = null;
    // A new checkpoint: whatever the cursor was doing, it heads home (or on to the new turn, when it lands).
    if (this.#run !== null && !this.#run.parked) this.#runCursor([], false);
    this.#host.invalidate();
    return true;
  }

  /** Tell the tour a working turn appended: on from where the tour is, or out from where the cursor is. */
  #tellAppended(fresh: ReadonlyArray<TourVisit>): void {
    if (fresh.length === 0) return;
    const run = this.#run;
    // A chosen play holds the cursor: the reader is reading, and the new moves wait for them.
    if (run?.stays === true && !run.parked) return;
    for (const visit of tourSteps(fresh)) {
      if (visit.verb === "write" && visit.inner === null) this.#gestures.pend(visit.note);
    }
    this.#told ??= { visit: null, touring: true, links: new Map(), notes: new Set() };
    if (run !== null && !run.parked && run.extend(fresh)) {
      this.#host.animate();
      return;
    }
    this.#runCursor(fresh, false);
  }

  /** Whether the host's popover stands in for the chip (the cursor's caret still draws). */
  setExpanded(expanded: boolean): void {
    if (expanded === this.#expanded) return;
    this.#expanded = expanded;
    this.#host.invalidate();
  }

  /** Whether (x, y), in CSS pixels, is on the chip as last drawn. */
  chipAt(x: number, y: number): boolean {
    const chip = this.#chip;
    return (
      chip !== null &&
      x >= chip.left &&
      x <= chip.left + chip.width &&
      y >= chip.top &&
      y <= chip.top + chip.height
    );
  }

  /** The cursor as last drawn, or null before the first frame. */
  get at(): CursorAt | null {
    return this.#at;
  }

  cursorTo(play: number | null): void {
    if (play === null) {
      // A chosen play let go: the cursor that stayed on it goes home.
      if (this.#run?.stays === true) {
        this.#run.home(performance.now() / 1000, this.#scene());
        this.#host.animate();
      }
      return;
    }
    // The play's visit at the deepest level that shows now: inside an opened container, its own.
    const scene = this.#scene();
    const visit = tourSteps(this.#visits)
      .filter((each) => each.plays.includes(play))
      .findLast((each) => scene.noteAt(each.note) !== null);
    if (visit === undefined) return;
    // The rest of the tour gives way: every note still waiting draws itself.
    this.#gestures.release(performance.now() / 1000);
    this.#runCursor([visit], true);
  }

  /** The cursor's tour of the landing turn: written notes wait as outlines until it reaches them. */
  startTour(): void {
    this.#gestures.clear();
    // Nothing to visit and nowhere to come home from: it stays parked, asking for no frames.
    if (this.#visits.length === 0 && (this.#run === null || this.#run.parked)) return;
    for (const visit of tourSteps(this.#visits)) {
      if (visit.verb === "write" && visit.inner === null) this.#gestures.pend(visit.note);
    }
    // The links light as the cursor tells them: none yet.
    this.#told = { visit: null, touring: true, links: new Map(), notes: new Set() };
    this.#runCursor(this.#visits, false);
  }

  /**
   * What the tour lights, standing in for a selected play: the visit being
   * told runs its links at full ink with beads; what it has told stays lit,
   * quietly; what it has not reached stays dark. Once the tour is over, its
   * links stay quiet while the story is lit.
   */
  focus(): PlayFocus | null {
    const told = this.#told;
    if (told === null) return null;
    const touring = this.touring;
    if (!touring && !this.#host.storyLit()) return null;
    const current = touring ? told.visit : null;
    const links = current?.links ?? [];
    const quiet = [...told.links.keys()].filter(
      (edge) => !links.some((link) => link.edge === edge),
    );
    const notes = new Set(told.notes);
    if (current !== null) {
      notes.add(current.note);
      if (current.to >= 0) notes.add(current.to);
    }
    return { kind: "many", nodes: [...notes], links, quiet };
  }

  /** One step of the telling: whether the cursor or a gesture still needs frames. */
  tell(now: number): boolean {
    const running = this.#gestures.active(now);
    return (this.#run?.moving(now) ?? false) || running;
  }

  /**
   * The cursor this frame: stepped to now, its arrivals' gestures fired and
   * its row lit; drawn as its gestures (under the labels) and as its caret
   * and label (over the labels).
   */
  frame(): { readonly marks: ReadonlyArray<Mark>; readonly agent: AgentDraw } {
    const now = performance.now() / 1000;
    const scene = this.#scene();
    const run = this.#run;
    const park = scene.park();
    const frame = run?.at(now, scene) ?? {
      x: park.x,
      y: park.y,
      angle: Math.atan2(-1, -1),
      label: AGENT_LABEL,
      outward: { x: -1, y: 0 },
      play: -1,
    };
    for (const event of run?.takeEvents() ?? []) {
      if (event.kind === "open" || event.kind === "close") {
        this.#host.tourCamera(event.kind === "open");
        this.#host.onDrill(event.inner, event.kind === "open");
        continue;
      }
      const { visit } = event;
      // A container told inside has no gesture of its own: its members have theirs.
      if (visit.verb !== "link" && visit.verb !== "unlink" && visit.inner === null) {
        this.#gestures.fire(visit.note, visit.verb, now);
      }
    }
    if (run !== null && run.parked && !run.moving(now)) {
      this.#run = null;
      if (!run.stays && run.steps.length > 0) this.#host.tourEnded?.();
    }
    this.#followTour(run);
    this.#setCursorPlay(frame.play);
    const gestures = this.#gestures.any
      ? this.#gestures.marks(now, (note) => this.#host.noteOnPlane(note))
      : [];
    return {
      marks: gestures.length === 0 ? NO_MARKS : gestures,
      agent: this.#agentDraw(frame),
    };
  }

  /** The cursor's view of the frame: the shown notes on screen, and the park in its corner. */
  #scene(): CursorScene {
    return {
      noteAt: (note) => this.#host.noteOnScreen(note),
      park: () => {
        const { width, height } = this.#host.size();
        return { x: width - PARK_INSET.right, y: height - PARK_INSET.bottom };
      },
    };
  }

  /** The tour moved on to another visit (or home): what it was telling is told; light anew. */
  #followTour(run: CursorRun | null): void {
    const told = this.#told;
    if (told === null) return;
    const visit = run === null || run.parked ? null : run.visit;
    const touring = run !== null && !run.parked;
    // A change of visit, or the tour parking (its quiet links fall if the story has), relights.
    if (visit === told.visit && touring === told.touring) return;
    told.touring = touring;
    // The story does not fall under the cursor: each step holds a lit story the landing window.
    if (touring) this.#host.holdStory();
    const done = told.visit;
    if (done !== null) {
      for (const link of done.links) told.links.set(link.edge, link);
      told.notes.add(done.note);
      if (done.to >= 0) told.notes.add(done.to);
    }
    told.visit = visit;
    this.#host.relight();
  }

  /** Send the cursor through `visits` from wherever it is now (home after, unless it `stays`). */
  #runCursor(visits: ReadonlyArray<TourVisit>, stays: boolean): void {
    const now = performance.now() / 1000;
    const scene = this.#scene();
    const from = this.#run?.at(now, scene) ?? scene.park();
    this.#run = new CursorRun(visits, { x: from.x, y: from.y }, now, stays);
    this.#run.start(scene);
    this.#host.animate();
  }

  #setCursorPlay(play: number): void {
    if (play === this.#cursorPlay) return;
    this.#cursorPlay = play;
    this.#host.onCursor(play < 0 ? null : play);
  }

  /** The caret (outlined in paper) and its label's chip, beside it and outward from the note. */
  #agentDraw(frame: CursorFrame): AgentDraw {
    const host = this.#host;
    const { width: frameWidth, height: frameHeight } = host.size();
    const tip = host.toPlane(frame.x, frame.y);
    // The plane's y runs up: the screen's angle turns the other way.
    const angle = -frame.angle;
    const along = { x: Math.cos(frame.angle), y: Math.sin(frame.angle) };
    // The outline is the same dart, a little larger, its tip a little ahead.
    const outlineTip = host.toPlane(
      frame.x + along.x * CURSOR_OUTLINE,
      frame.y + along.y * CURSOR_OUTLINE,
    );
    const caret: Array<Mark> = [
      {
        kind: "cursor",
        x: outlineTip.x,
        y: outlineTip.y,
        size: CURSOR_PIXELS + CURSOR_OUTLINE * 3,
        angle,
        color: "paper",
        alpha: 1,
      },
      { kind: "cursor", x: tip.x, y: tip.y, size: CURSOR_PIXELS, angle, color: "accent", alpha: 1 },
    ];
    const at = this.#at;
    if (
      at === null ||
      Math.abs(at.x - frame.x) > 0.5 ||
      Math.abs(at.y - frame.y) > 0.5 ||
      at.outward.x !== frame.outward.x ||
      at.outward.y !== frame.outward.y ||
      at.width !== frameWidth ||
      at.height !== frameHeight
    ) {
      this.#at = {
        x: frame.x,
        y: frame.y,
        outward: frame.outward,
        width: frameWidth,
        height: frameHeight,
      };
      host.onCursorAt?.(this.#at);
    }
    if (this.#expanded) {
      // The popover holds the words now: the chip draws nothing and catches no click.
      this.#chip = null;
      const none = host.toPlane(frame.x, frame.y);
      return {
        caret,
        chip: {
          kind: "rect",
          x0: none.x,
          y0: none.y,
          x1: none.x,
          y1: none.y,
          color: "paper",
          border: "accent",
          width: 0,
          alpha: 0,
        },
        text: "",
        x: none.x,
        y: none.y,
        pixels: AGENT_LABEL_PIXELS,
      };
    }
    const text =
      frame.label.length > AGENT_LABEL_MAX
        ? `${frame.label.slice(0, AGENT_LABEL_MAX - 1)}…`
        : frame.label;
    const width = [...text].length * AGENT_LABEL_PIXELS * 0.6 + 2 * CHIP_PAD_X;
    const height = AGENT_LABEL_PIXELS + 2 * CHIP_PAD_Y;
    // Past the caret's back, outward from the note, and kept inside the frame.
    const reach = CURSOR_PIXELS + 6;
    const anchor = { x: frame.x + frame.outward.x * reach, y: frame.y + frame.outward.y * reach };
    const left = Math.min(
      Math.max(4, frame.outward.x >= 0 ? anchor.x : anchor.x - width),
      frameWidth - width - 4,
    );
    const top = Math.min(
      Math.max(4, anchor.y - height / 2 + frame.outward.y * height * 0.5),
      frameHeight - height - 4,
    );
    this.#chip = { left, top, width, height };
    const low = host.toPlane(left, top + height);
    const high = host.toPlane(left + width, top);
    const textAt = host.toPlane(left + CHIP_PAD_X, top + height / 2);
    return {
      caret,
      chip: {
        kind: "rect",
        x0: low.x,
        y0: low.y,
        x1: high.x,
        y1: high.y,
        color: "paper",
        border: "accent",
        width: 1,
        alpha: 1,
      },
      text,
      x: textAt.x,
      y: textAt.y,
      pixels: AGENT_LABEL_PIXELS,
    };
  }
}
