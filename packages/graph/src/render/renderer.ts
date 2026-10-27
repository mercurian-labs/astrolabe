/**
 * What `AtlasGraph` asks of a renderer. "3d" and "flat" are the Atlas renderer's two cameras, which
 * glide into each other; "lean" (Three) and "pixi" (Pixi.js) are 2D renderers with their own
 * canvas. Everything comes from the shared model and layout; a renderer only decides how to draw.
 */
import type { TourInner, TourVisit } from "../model/tour.ts";
import type { GraphLayout } from "../layout/forceLayout.ts";
import type { Gathering } from "../layout/gathering.ts";
import type { PlayFocus } from "../model/plays.ts";
import type { GraphSettings } from "../model/settings.ts";
import type { Universe } from "../model/universe.ts";
import type { ReadingView } from "../model/view.ts";
import type { BenchDriver } from "./probe.ts";
import type { FrameClock } from "./scheduler.ts";
import type { CursorAt } from "./storyteller.ts";
import type { GraphTag } from "./tags.ts";

export type RenderMode = "3d" | "flat" | "lean" | "pixi";
export const RENDER_MODES: ReadonlyArray<RenderMode> = ["3d", "flat", "lean", "pixi"];

/** Modes drawn by one renderer instance; switching within a family glides, across families cuts. */
export type RendererFamily = "atlas" | "lean" | "pixi";
export const rendererFamily = (mode: RenderMode): RendererFamily =>
  mode === "3d" || mode === "flat" ? "atlas" : mode;

/** Every mode but "3d" draws the flat layout (z pinned). */
export const isFlatMode = (mode: RenderMode) => mode !== "3d";

export type HoverTarget =
  | { readonly kind: "node"; readonly index: number; readonly x: number; readonly y: number }
  | { readonly kind: "edge"; readonly index: number; readonly x: number; readonly y: number };

export interface RendererCallbacks {
  onHover(target: HoverTarget | null): void;
  /** A node was clicked (pressed and released without dragging). */
  onPick(index: number): void;
  /** Empty space was clicked. */
  onBackground(): void;
  /** A region's name was clicked (the container, by universe index): it closes. */
  onRegion?(index: number): void;
  /** The agent's cursor reached a play (its place in the turn), or left the last one (null). */
  onCursor?(play: number | null): void;
  /**
   * The cursor's tour reached a container it tells inside (`open`), or has
   * told it (`!open`): open it to `inner.closed`, or close it back to
   * `inner.outer`.
   */
  onCursorDrill?(inner: TourInner, open: boolean): void;
  onFollowingChange(following: boolean): void;
  /** The cursor's chip was clicked: the host opens (or closes) the turn's moves beside it. */
  onCursorChip?(): void;
  /** Where the cursor is drawn, whenever that changes (see `CursorAt`): a popover rides beside it. */
  onCursorAt?(at: CursorAt): void;
  /** A tag (by its place in the last `setTags`) is hovered, or no longer (null). */
  onTag?(index: number | null): void;
}

/** Where a test counts a renderer's work: notes projected for picking, and slots allocated. */
export interface WorkCounter {
  count(kind: "project" | "allocate", amount: number): void;
}

export interface RendererOptions {
  readonly clock?: FrameClock;
  readonly counter?: WorkCounter;
}

export interface RendererStats {
  readonly mode: RenderMode;
  readonly framesLastSecond: number;
  readonly totalFrames: number;
  readonly animating: boolean;
  /** Shown nodes in view at the last frame, of all shown, and labels drawn. */
  readonly inView: number;
  /** Node slots the renderer holds: the working set with its headroom, never the memory. */
  readonly slots: number;
  readonly shown: number;
  readonly labels: number;
  /**
   * The smallest and largest shown node's ordinary radius on screen at the
   * camera's target, and the largest prominent note's grown radius (0 when
   * none), in CSS pixels.
   */
  readonly radiusPx: readonly [number, number, number];
  /** A hovered note's link (attention 0.6) and a story link (1) on screen at the target, in CSS pixels. */
  readonly edgePx: readonly [number, number];
  /** Beads running on the turn's new links. */
  readonly beads: number;
  /** GPU draw calls in the last rendered frame. */
  readonly drawCalls: number;
  /**
   * Mean and max milliseconds spent in the Three or Pixi render call itself,
   * over the last 60 frames that rendered.
   */
  readonly renderMs: readonly [number, number];
  /** Mean and max milliseconds spent on the rest of those frames: culling, labels, uploads. */
  readonly prepMs: readonly [number, number];
}

/** What the host knows about the view beyond the view itself. */
export interface ViewContext {
  /** The layout the view and its gathering were computed for. */
  readonly layout: GraphLayout;
  /** The reading's cluster: where each shown note is gathered, or null (whole memory, no thread). */
  readonly gathering: Gathering | null;
  /** The view is a thread's reading, so it opens on the reading's centroid rather than a hub. */
  readonly reading: boolean;
  /** The reading is narrowed to the checkpoint's own turn: its story is that turn's links alone. */
  readonly thisTurnOnly: boolean;
}

/**
 * A flat view, in terms every 2D renderer shares: the world point at the
 * centre of the canvas and how many CSS pixels one world unit spans. It
 * carries the picture across a switch between renderer families.
 */
export interface FlatView {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** Frame times recorded over a scripted bench run: the render call, and the rest of each frame. */
export interface BenchResult {
  readonly frames: number;
  readonly meanMs: number;
  readonly maxMs: number;
  readonly prepMeanMs: number;
  readonly prepMaxMs: number;
}

export interface GraphRenderer {
  readonly following: boolean;
  stats(now: number): RendererStats;
  /** A new universe laid out, flat (z pinned) or in space: rebuild everything. */
  setGraph(universe: Universe, layout: GraphLayout, flat: boolean): void;
  /** The same universe laid out anew or seen flat; lands with the next `setView`. */
  setLayout(layout: GraphLayout, flat: boolean): void;
  /**
   * What shows now: the renderer seats the view's notes and edges in its own
   * slots (see `WorkingSet`) and eases toward the view's targets.
   */
  setView(view: ReadingView, context: ViewContext, instant?: boolean): void;
  /** The checkpoint's turn landed: its story lights. Called once per checkpoint. */
  landLinks(): void;
  setPlay(play: PlayFocus | null): void;
  setTurnRunning(running: boolean): void;
  setSettings(settings: GraphSettings): void;
  setLabelFont(font: string | undefined): void;
  setThemeKey(key: string | undefined): void;
  /** Frame these notes (universe indices) when following. */
  follow(indices: ReadonlyArray<number>): void;
  /** Frame these shown notes (universe indices) at the reading density now, following or not. */
  frame(indices: ReadonlyArray<number>): void;
  /**
   * The checkpoint's moves at the level shown, in play order, for the cursor's tour. Clears the
   * last checkpoint's gestures, unless `appended` is given: the same turn grew while the agent
   * works, and the cursor goes on to tell `appended`, the tour of the new plays alone.
   */
  setMoves(visits: ReadonlyArray<TourVisit>, appended?: ReadonlyArray<TourVisit> | null): void;
  /** The host shows the turn's moves in a popover beside the cursor: its chip gives way. */
  setCursorPopover(open: boolean): void;
  /**
   * Put the agent's cursor on play `play` (its place in the turn): it travels
   * to that play's visit and stays; null sends a cursor that stayed home.
   */
  cursorTo(play: number | null): void;
  resumeFollowing(): void;
  /** Name these clusters with small tags near their members (see `TagLayer`); empty clears them. */
  setTags(tags: ReadonlyArray<GraphTag>): void;
  fit(): void;
  /** The current flat view, or null in 3D (whose picture a flat renderer cannot take over). */
  flatView(): FlatView | null;
  /**
   * Take over another renderer's flat view (when both are flat; null keeps
   * this renderer's own framing) and its following state, without a jump.
   */
  adoptView(view: FlatView | null, following: boolean): void;
  /** Glide every node for about three seconds and report the frame times. */
  bench(seconds?: number): Promise<BenchResult>;
  /** The bench's hold on this renderer: frame samples and scripted pan, zoom, and hover. */
  driver(): BenchDriver;
  dispose(): void;
}

/**
 * Rolling windows of frame times, the last 60 frames that rendered: the
 * render call alone, and the preparation around it. A frame that rendered
 * nothing (a drawer still loading its font) records nothing.
 */
export class FrameTimer {
  static readonly WINDOW = 60;
  readonly #render: Array<number> = [];
  readonly #prep: Array<number> = [];
  #recording: { render: Array<number>; prep: Array<number> } | null = null;

  add(renderMs: number, prepMs: number): void {
    this.#render.push(renderMs);
    this.#prep.push(prepMs);
    if (this.#render.length > FrameTimer.WINDOW) this.#render.shift();
    if (this.#prep.length > FrameTimer.WINDOW) this.#prep.shift();
    this.#recording?.render.push(renderMs);
    this.#recording?.prep.push(prepMs);
  }

  /** Mean and max of the render call over the window. */
  get render(): readonly [number, number] {
    return summarize(this.#render);
  }

  /** Mean and max of the preparation over the window. */
  get prep(): readonly [number, number] {
    return summarize(this.#prep);
  }

  record(): void {
    this.#recording = { render: [], prep: [] };
  }

  stop(): BenchResult {
    const recording = this.#recording ?? { render: [], prep: [] };
    this.#recording = null;
    const [meanMs, maxMs] = summarize(recording.render);
    const [prepMeanMs, prepMaxMs] = summarize(recording.prep);
    return { frames: recording.render.length, meanMs, maxMs, prepMeanMs, prepMaxMs };
  }
}

function summarize(times: ReadonlyArray<number>): readonly [number, number] {
  if (times.length === 0) return [0, 0];
  let sum = 0;
  let max = 0;
  for (const time of times) {
    sum += time;
    max = Math.max(max, time);
  }
  return [sum / times.length, max];
}

/** A bench's glides: every node from an exploded, then a collapsed, then an exploded web. */
export const BENCH_GLIDES: ReadonlyArray<number> = [1.6, 0.6, 1.6];

/**
 * Run a bench: record frame times while `glide` sends every node from a
 * scaled copy of the web back to its place, once per glide in `BENCH_GLIDES`,
 * spread over `seconds`.
 */
export async function runBench(
  timer: FrameTimer,
  glide: (factor: number) => void,
  seconds = 3,
): Promise<BenchResult> {
  timer.record();
  const each = (seconds * 1000) / BENCH_GLIDES.length;
  for (const factor of BENCH_GLIDES) {
    glide(factor);
    await new Promise((resolve) => setTimeout(resolve, each));
  }
  return timer.stop();
}

/** What a replaced renderer leaves for the next one. */
export interface Handover {
  readonly view: FlatView | null;
  readonly following: boolean;
}

/**
 * What the next renderer takes over from the one it replaces: the flat view
 * only when both draw flat (a 3D picture has no flat view to carry, and a 3D
 * renderer cannot take one), and whether it is following always, so a pause
 * survives any chain of switches.
 */
export function handover(previous: Handover | null, nextFlat: boolean): Handover | null {
  if (previous === null) return null;
  return { view: nextFlat ? previous.view : null, following: previous.following };
}

/**
 * Release a Three renderer for good: its resources, then its WebGL context
 * (which `dispose` alone leaves alive, so repeated switches would pile up
 * contexts until the browser evicts one), then its canvas.
 */
export function releaseRenderer(renderer: {
  dispose(): void;
  forceContextLoss(): void;
  readonly domElement: HTMLElement;
}): void {
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.remove();
}
