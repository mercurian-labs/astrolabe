/**
 * What a benchmark reads from a renderer and how it drives one. Every renderer
 * reports each rendered frame as a `FrameSample` while a bench listens, and
 * takes scripted pans, zooms, and hovers through the same `BenchDriver`, so
 * every mode runs the identical steps. Nothing here runs unless a bench asks.
 */
import type { LabelBoxes } from "./pool.ts";

/** One rendered frame, as a bench samples it. */
export interface FrameSample {
  /** `performance.now()` when the frame rendered. */
  readonly time: number;
  /** Milliseconds in the Three or Pixi render call itself. */
  readonly renderMs: number;
  /** Milliseconds in the rest of the frame: culling, labels, uploads. */
  readonly prepMs: number;
  readonly drawCalls: number;
  readonly labels: number;
  /** Labels in view and inside the label window that the budget left out. */
  readonly labelsCut: number;
  readonly edges: number;
  readonly beads: number;
  /** Beads bright enough to see this frame. */
  readonly beadsVisible: number;
  /** A checksum of the visible beads' positions: it changes when a visible bead moves. */
  readonly beadChecksum: number;
  /** GPU milliseconds of earlier frames whose timer queries resolved by now (empty without the extension). */
  readonly gpuMs: ReadonlyArray<number>;
  /** The drawn labels' screen rectangles, when the bench asked for them. */
  readonly boxes: LabelBoxes | null;
}

export interface SampleOptions {
  /** Record the drawn labels' rectangles each frame (costs a projection per label). */
  readonly boxes?: boolean;
  /** Time each render on the GPU, where the context has a timer query extension. */
  readonly gpu?: boolean;
}

/** GPU resources a renderer holds, as far as it can tell; null where it cannot. */
export interface GpuMemory {
  readonly textures: number | null;
  readonly buffers: number | null;
}

/** What a bench resets before every run: nothing hovered or picked, and the camera following. */
export interface BenchView {
  readonly following: boolean;
  /** A note or an edge is hovered. */
  readonly hovering: boolean;
  /** The picked note's index, or −1. */
  readonly picked: number;
}

/** How a bench drives a renderer: the same scripted steps for every mode. */
export interface BenchDriver {
  /** The renderer's view state, as a reset checks it. */
  view(): BenchView;
  /** Call `listener` after every rendered frame with its sample; null stops. */
  sample(listener: ((sample: FrameSample) => void) | null, options?: SampleOptions): void;
  /** Pan by a screen delta in CSS pixels, as a drag of empty space would; following stops. */
  pan(dx: number, dy: number): void;
  /** Zoom by `factor` (above 1 in) about canvas pixel (x, y), as the wheel would. */
  zoom(x: number, y: number, factor: number): void;
  /** Move the hover to canvas pixel (x, y), as the pointer would; (−1, −1) leaves. */
  hover(x: number, y: number): void;
  /** Where note `index` (a universe index) is drawn on the canvas, or null when it is not in view. */
  screenOf(index: number): readonly [number, number] | null;
  /** The notes (universe indices) drawn in view at the last frame. */
  inView(): ReadonlyArray<number>;
  /** Whether a timer query can time this renderer's frames on the GPU. */
  readonly gpuTiming: boolean;
  memory(): GpuMemory;
}

/** The EXT_disjoint_timer_query_webgl2 enums (the extension object carries them too). */
const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;

/** The slice of a WebGL 2 context a timer query uses. */
export interface QueryContext {
  readonly QUERY_RESULT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
  getExtension(name: string): unknown;
  createQuery(): WebGLQuery | null;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getParameter(name: number): unknown;
  getQueryParameter(query: WebGLQuery, name: number): unknown;
  deleteQuery(query: WebGLQuery | null): void;
}

/**
 * GPU time per frame through EXT_disjoint_timer_query_webgl2: a query brackets
 * the render call and resolves a few frames later. `create` returns null where
 * the extension is missing, and the bench reports "n/a" rather than a guess.
 */
export class GpuTimer {
  readonly #gl: QueryContext;
  readonly #pending: Array<WebGLQuery> = [];
  #active: WebGLQuery | null = null;

  private constructor(gl: QueryContext) {
    this.#gl = gl;
  }

  static create(gl: QueryContext | null): GpuTimer | null {
    if (gl === null || gl.getExtension("EXT_disjoint_timer_query_webgl2") === null) return null;
    return new GpuTimer(gl);
  }

  begin(): void {
    if (this.#active !== null) return;
    const query = this.#gl.createQuery();
    if (query === null) return;
    this.#gl.beginQuery(TIME_ELAPSED_EXT, query);
    this.#active = query;
  }

  end(): void {
    if (this.#active === null) return;
    this.#gl.endQuery(TIME_ELAPSED_EXT);
    this.#pending.push(this.#active);
    this.#active = null;
  }

  /**
   * The milliseconds of every query resolved since the last poll, oldest first.
   * A disjoint event (the GPU clock jumped) spoils every query in flight, so a
   * disjoint poll discards them all, resolved or not, and reports nothing.
   */
  poll(): Array<number> {
    const gl = this.#gl;
    if (gl.getParameter(GPU_DISJOINT_EXT) === true) {
      this.dispose();
      return [];
    }
    const resolved: Array<number> = [];
    while (this.#pending.length > 0) {
      const query = this.#pending[0];
      if (query === undefined || gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) !== true)
        break;
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT);
      if (typeof nanoseconds === "number") resolved.push(nanoseconds / 1e6);
      gl.deleteQuery(query);
      this.#pending.shift();
    }
    return resolved;
  }

  dispose(): void {
    for (const query of this.#pending) this.#gl.deleteQuery(query);
    this.#pending.length = 0;
  }
}

/**
 * Time one render call: the CPU timestamps bracket the call alone, and the GPU
 * query's begin and end sit outside them, so their cost lands in the frame's
 * preparation (a caller takes prep as the frame's total less this).
 */
export function timeRender(
  render: () => void,
  gpu: Pick<GpuTimer, "begin" | "end"> | null,
  now: () => number = () => performance.now(),
): number {
  gpu?.begin();
  const before = now();
  render();
  const after = now();
  gpu?.end();
  return after - before;
}

/** How many of the first `count` beads are bright enough to see. */
export function visibleBeads(bright: ArrayLike<number>, count: number): number {
  let visible = 0;
  for (let index = 0; index < count; index += 1) if ((bright[index] ?? 0) > 0.001) visible += 1;
  return visible;
}

/** A checksum of the visible beads' positions (x, y, z per bead): it changes when a visible bead moves. */
export function beadChecksum(
  positions: ArrayLike<number>,
  bright: ArrayLike<number>,
  count: number,
): number {
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    if ((bright[index] ?? 0) <= 0.001) continue;
    const at = index * 3;
    sum +=
      (index + 1) *
      ((positions[at] ?? 0) + 3 * (positions[at + 1] ?? 0) + 7 * (positions[at + 2] ?? 0));
  }
  return sum;
}

/** The context as WebGL 2, or null (timer queries need WebGL 2). */
export function webgl2(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null,
): WebGL2RenderingContext | null {
  return gl !== null &&
    typeof WebGL2RenderingContext !== "undefined" &&
    gl instanceof WebGL2RenderingContext
    ? gl
    : null;
}

/** Whether `gl` can time frames on the GPU. */
export const canTimeGpu = (gl: WebGL2RenderingContext | null) =>
  gl !== null && gl.getExtension("EXT_disjoint_timer_query_webgl2") !== null;
