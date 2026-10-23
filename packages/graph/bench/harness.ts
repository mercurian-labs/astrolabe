/**
 * The bench harness: runs a scenario on a mode and a memory size in the real
 * AtlasGraph, in the page, and measures it. Every run starts from the
 * reference workload (the synthetic thread's reading at checkpoint
 * REFERENCE_CHECKPOINT: what the graph draws by default, nothing searched,
 * filtered, lensed, picked, selected, or hovered, following, fitted, its
 * landing story fallen, at rest), whatever ran before; a warm-up run is
 * discarded; the medians of N runs are reported. The whole memory is the
 * opt-in view whose cost is linear in the memory; the bench does not measure it.
 *
 * Per rendered frame, through the renderer's bench driver: render ms (around
 * the render call only), prep ms, draw calls, labels drawn and cut, edges,
 * beads, and GPU ms where a timer query is available. Around each step: the
 * presented-frame delta (rAF to rAF), long animation frames where the browser
 * reports them, and the JS heap where it exposes it. At rest: frames rendered
 * and timers fired by a graph built under the counter, which should be 0.
 */
import type { SyntheticSize } from "../fixtures/synthetic.ts";
import type { AtlasGraphHandle } from "../src/AtlasGraph.tsx";
import type { ThreadRecord } from "../src/model/thread.ts";
import type { BenchDriver, FrameSample } from "../src/render/probe.ts";
import type { RenderMode } from "../src/render/renderer.ts";
import { medianRuns, type BenchCell, type BenchReport, type RunMetrics } from "./report.ts";
import {
  BeadMotion,
  distribution,
  foldLongFrames,
  harnessWait,
  installTimerCounter,
  median,
  observeLongFrames,
  overlapCount,
  type LongFrameEntry,
} from "./sampling.ts";
import {
  HOVER_FRAMES,
  hoverTargets,
  panDeltas,
  SCENARIOS,
  STORY_CHECKPOINTS,
  storyPlan,
  zoomFactors,
  type ScenarioName,
  type Step,
} from "./scenarios.ts";

/** What the page shows for the bench: the graph's props that the harness sets. */
export interface BenchState {
  readonly mode: RenderMode;
  readonly size: SyntheticSize;
  /** Bumped to hand the graph a fresh memory object (a load from nothing). */
  readonly memoryVersion: number;
  /** Bumped to mount the graph afresh (a new renderer), as the rest step does under its counter. */
  readonly mount: number;
  readonly reading: "whole" | "thread";
  readonly checkpoint: number;
  readonly turnRunning: boolean;
}

export interface BenchHost {
  handle(): AtlasGraphHandle | null;
  /** Show `state` and resolve once React has committed it. */
  show(state: BenchState): Promise<void>;
  readonly state: BenchState;
  /** The synthetic thread the story plays over a size (the same every run). */
  thread(size: SyntheticSize): ThreadRecord;
  readonly viewport: readonly [number, number];
}

export interface BenchMatrix {
  readonly modes: ReadonlyArray<RenderMode>;
  readonly sizes: ReadonlyArray<SyntheticSize>;
  readonly scenarios: ReadonlyArray<ScenarioName>;
  /** Runs per cell after the discarded warm-up. */
  readonly runs: number;
}

export interface BenchProgress {
  readonly cell: number;
  readonly cells: number;
  readonly label: string;
}

// The harness's own waits are tagged, so a rest step's timer counter never counts them.
const sleep = (ms: number) =>
  new Promise<void>((resolve) =>
    globalThis.setTimeout(
      harnessWait(() => resolve()),
      ms,
    ),
  );
const nextFrame = () =>
  new Promise<number>((resolve) => globalThis.requestAnimationFrame(harnessWait(resolve)));
/** A frame and then a macrotask: long enough for the browser to queue the last frame's entries. */
const drain = async () => {
  await nextFrame();
  await sleep(0);
};

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (predicate()) return true;
    await nextFrame();
  }
  return predicate();
}

function settled(handle: AtlasGraphHandle | null): boolean {
  if (handle === null) return false;
  const stats = handle.stats(performance.now());
  return stats.totalFrames > 0 && !stats.animating;
}

/** Presented frames with nothing rendered that make a graph at rest. */
const QUIET_FRAMES = 30;

/**
 * Wait until the graph is at rest: settled, and no frame rendered across
 * QUIET_FRAMES presented frames. A graph just mounted reports no animation on
 * its first frame, before its opening ones start, so settled alone is not rest.
 */
async function waitForRest(handle: AtlasGraphHandle, timeoutMs: number): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (!settled(handle)) {
      await nextFrame();
      continue;
    }
    const before = handle.stats(performance.now()).totalFrames;
    for (let frame = 0; frame < QUIET_FRAMES; frame += 1) await nextFrame();
    if (settled(handle) && handle.stats(performance.now()).totalFrames === before) return true;
  }
  return false;
}

/** The JS heap in MB, where the browser exposes it (Chrome's `performance.memory`). */
function heapMB(): number | null {
  const memory: unknown = Reflect.get(performance, "memory");
  if (typeof memory !== "object" || memory === null || !("usedJSHeapSize" in memory)) return null;
  const used = memory.usedJSHeapSize;
  return typeof used === "number" ? used / 2 ** 20 : null;
}

/** Presented frames: a rAF loop recording the time between frames, and telling `onFrame` of each, until stopped. */
function measureDeltas(onFrame: () => void): () => Array<number> {
  const deltas: Array<number> = [];
  let last: number | null = null;
  let running = true;
  const loop = harnessWait((now: number) => {
    if (!running) return;
    if (last !== null) deltas.push(now - last);
    last = now;
    onFrame();
    globalThis.requestAnimationFrame(loop);
  });
  globalThis.requestAnimationFrame(loop);
  return () => {
    running = false;
    return deltas;
  };
}

/** Everything one run of one step collects. */
interface Collected {
  samples: Array<FrameSample>;
  overlaps: Array<number>;
  gpu: Array<number>;
  deltas: Array<number>;
  longFrames: ReadonlyArray<LongFrameEntry> | null;
  beadMotion: BeadMotion;
  restFrames: number | null;
  restTimers: number | null;
  loadMs: number | null;
}

/** Whether the renderer is in the reference view: following, nothing hovered or picked. */
/** The checkpoint of the synthetic thread whose reading every run starts from. */
export const REFERENCE_CHECKPOINT = 5;

/** Long enough for a checkpoint's landing story to fall and its edges to settle. */
export const LANDING_WAIT_MS = 4 * 1000 + 800;

function atReference(handle: AtlasGraphHandle): boolean {
  const view = handle.driver()?.view();
  return view !== undefined && view.following && !view.hovering && view.picked < 0;
}

/**
 * Put the graph in the reference workload for `mode` and `size`: the thread's
 * reading at REFERENCE_CHECKPOINT, nothing picked or hovered, following,
 * fitted, and at rest, whatever ran before (a pan or zoom pauses following,
 * and a renderer hand-over keeps that). A reading that lands anew (a new
 * memory, or a checkpoint the last run moved off) lights its story, so the
 * reset waits `landingMs` for it to fall. Throws when the graph cannot get
 * there, rather than measure off it.
 */
export async function reset(
  host: BenchHost,
  mode: RenderMode,
  size: SyntheticSize,
  landingMs = LANDING_WAIT_MS,
): Promise<AtlasGraphHandle> {
  const before = host.state;
  const lands =
    before.size !== size ||
    before.reading !== "thread" ||
    before.checkpoint !== REFERENCE_CHECKPOINT;
  await host.show({
    ...host.state,
    mode,
    size,
    reading: "thread",
    checkpoint: REFERENCE_CHECKPOINT,
    turnRunning: false,
  });
  if (lands) await sleep(landingMs);
  await waitFor(() => (host.handle()?.driver() ?? null) !== null, 60_000);
  const handle = host.handle();
  if (handle === null) throw new Error("the graph never mounted");
  // The pick is React state: it lets go on the next commit, and fit frames a pick, so wait for it first.
  handle.clearPick();
  await waitFor(() => (handle.driver()?.view().picked ?? -1) < 0, 30_000);
  handle.driver()?.hover(-1, -1);
  handle.resumeFollowing();
  handle.fit();
  await nextFrame();
  const ready = await waitFor(() => settled(handle) && atReference(handle), 120_000);
  await waitForRest(handle, 30_000);
  if (!ready || !atReference(handle)) {
    throw new Error(
      `reset left the graph off the reference: ${JSON.stringify(handle.driver()?.view() ?? null)}`,
    );
  }
  return handle;
}

async function runStep(
  host: BenchHost,
  handle: AtlasGraphHandle,
  driver: BenchDriver,
  step: Step,
  into: Collected,
) {
  if (step.kind === "rest") {
    await rest(host, step.seconds, into);
    return;
  }
  const legible = step.measures.includes("legibility");
  const motion = into.beadMotion;
  driver.sample(
    (sample) => {
      into.samples.push({ ...sample, boxes: null });
      into.gpu.push(...sample.gpuMs);
      if (legible && sample.boxes !== null) into.overlaps.push(overlapCount(sample.boxes));
      motion.rendered(sample.beadChecksum, sample.beadsVisible);
    },
    { boxes: legible, gpu: true },
  );
  const stopLong = observeLongFrames(performance.now(), drain);
  const stopDeltas = measureDeltas(() => motion.presented());
  const [width, height] = host.viewport;
  switch (step.kind) {
    case "load": {
      // From handing over a fresh memory (its universe and layout are built from nothing)
      // to the first frame of the new graph, which is drawn settled. The checkpoint's
      // story lighting afterwards is the thread's, not the load's.
      const before = handle.stats(performance.now()).totalFrames;
      const started = performance.now();
      await host.show({ ...host.state, memoryVersion: host.state.memoryVersion + 1 });
      await waitFor(
        () => (host.handle()?.stats(performance.now()).totalFrames ?? before) > before,
        180_000,
      );
      into.loadMs = performance.now() - started;
      break;
    }
    case "glide":
      await handle.bench(step.seconds);
      break;
    case "story": {
      await host.show({ ...host.state, reading: "thread", checkpoint: 0, turnRunning: true });
      await sleep(1000);
      const plan = storyPlan(
        host.thread(host.state.size),
        (step.count ?? STORY_CHECKPOINTS) + 1,
      ).slice(1);
      for (const beat of plan) {
        await host.show({ ...host.state, checkpoint: beat.checkpoint });
        await sleep(beat.glideSeconds * 1000);
        if (beat.linkSeconds > 0) {
          motion.hold(true);
          await sleep(beat.linkSeconds * 1000);
          motion.hold(false);
        }
      }
      await host.show({ ...host.state, turnRunning: false });
      break;
    }
    case "pan":
      for (const [dx, dy] of panDeltas(step.seconds)) {
        driver.pan(dx, dy);
        await nextFrame();
      }
      break;
    case "zoom":
      for (const factor of zoomFactors(step.seconds)) {
        driver.zoom(width / 2, height / 2, factor);
        await nextFrame();
      }
      break;
    case "hover": {
      const candidates = [...driver.inView()].sort((left, right) => left - right);
      for (const node of hoverTargets(candidates, step.count ?? 50)) {
        const at = driver.screenOf(node);
        if (at === null) continue;
        driver.hover(at[0], at[1]);
        for (let frame = 0; frame < HOVER_FRAMES; frame += 1) await nextFrame();
      }
      driver.hover(-1, -1);
      await nextFrame();
      break;
    }
  }
  const ended = performance.now();
  driver.sample(null);
  into.deltas.push(...stopDeltas());
  const long = await stopLong(ended);
  if (long !== null) into.longFrames = [...(into.longFrames ?? []), ...long];
}

/**
 * Rest: the timer counter goes in before a fresh graph is mounted, so every
 * timeout, interval, and frame its renderer schedules is wrapped; once it has
 * settled, everything that fires in the window counts.
 */
async function rest(host: BenchHost, seconds: number, into: Collected): Promise<void> {
  const previous = host.handle();
  const counter = installTimerCounter(globalThis);
  try {
    await host.show({ ...host.state, mount: host.state.mount + 1 });
    await waitFor(() => {
      const handle = host.handle();
      return handle !== null && handle !== previous;
    }, 120_000);
    const handle = host.handle();
    if (handle === null || handle === previous) throw new Error("the graph never remounted");
    // A graph mounted afresh lands its reading: its story falls first. A graph
    // that never comes to rest after that is still measured: its frames and timers are the finding.
    await sleep(LANDING_WAIT_MS);
    await waitForRest(handle, 60_000);
    const before = handle.stats(performance.now()).totalFrames;
    counter.start();
    await sleep(seconds * 1000);
    const counts = counter.stop();
    into.restFrames = handle.stats(performance.now()).totalFrames - before;
    into.restTimers = counts.timers + counts.frames;
  } finally {
    counter.uninstall();
  }
}

async function runOnce(
  host: BenchHost,
  mode: RenderMode,
  size: SyntheticSize,
  scenario: ScenarioName,
): Promise<RunMetrics> {
  const handle = await reset(host, mode, size);
  const driver = handle.driver();
  if (driver === null) throw new Error("the renderer has no bench driver");
  const into: Collected = {
    samples: [],
    overlaps: [],
    gpu: [],
    deltas: [],
    longFrames: null,
    beadMotion: new BeadMotion(),
    restFrames: null,
    restTimers: null,
    loadMs: null,
  };
  for (const step of SCENARIOS[scenario].steps) {
    // A load swaps the memory, and with it the renderer's graph: take the driver afresh after.
    await runStep(
      host,
      host.handle() ?? handle,
      (host.handle() ?? handle).driver() ?? driver,
      step,
      into,
    );
  }
  const { samples } = into;
  const pick = (read: (sample: FrameSample) => number) => samples.map(read);
  const memory = (host.handle()?.driver() ?? driver).memory();
  return {
    frames: samples.length,
    renderMs: distribution(pick((sample) => sample.renderMs)),
    prepMs: distribution(pick((sample) => sample.prepMs)),
    frameDelta: distribution(into.deltas),
    gpuMs: into.gpu.length > 0 ? distribution(into.gpu) : null,
    drawCalls: median(pick((sample) => sample.drawCalls)),
    labels: median(pick((sample) => sample.labels)),
    labelsCut: median(pick((sample) => sample.labelsCut)),
    overlaps: into.overlaps.length > 0 ? median(into.overlaps) : null,
    edges: median(pick((sample) => sample.edges)),
    beads: median(pick((sample) => sample.beads)),
    beadsMoving: into.beadMotion.share,
    longFrames: into.longFrames === null ? null : foldLongFrames(into.longFrames),
    heapMB: heapMB(),
    textures: memory.textures,
    buffers: memory.buffers,
    restFrames: into.restFrames,
    restTimers: into.restTimers,
    loadMs: into.loadMs,
  };
}

/** One cell: a warm-up run discarded, then `runs` runs, reported as their medians. */
export async function runCell(
  host: BenchHost,
  mode: RenderMode,
  size: SyntheticSize,
  scenario: ScenarioName,
  runs: number,
): Promise<BenchCell> {
  await runOnce(host, mode, size, scenario);
  const measured: Array<RunMetrics> = [];
  for (let run = 0; run < runs; run += 1) measured.push(await runOnce(host, mode, size, scenario));
  return { mode, size, scenario, runs, metrics: medianRuns(measured) };
}

/** The GPU the page renders on, as WebGL names it. */
export function gpuName(): string {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (gl === null) return "no WebGL 2";
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name: unknown = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL);
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return typeof name === "string" ? name : "unknown";
}

/** Run every cell of the matrix in order: sizes, then modes, then scenarios. */
export async function runMatrix(
  host: BenchHost,
  matrix: BenchMatrix,
  onProgress: (progress: BenchProgress) => void = () => {},
): Promise<BenchReport> {
  const cells: Array<BenchCell> = [];
  const total = matrix.sizes.length * matrix.modes.length * matrix.scenarios.length;
  for (const size of matrix.sizes) {
    for (const mode of matrix.modes) {
      for (const scenario of matrix.scenarios) {
        onProgress({ cell: cells.length, cells: total, label: `${mode} · ${size} · ${scenario}` });
        cells.push(await runCell(host, mode, size, scenario, matrix.runs));
      }
    }
  }
  onProgress({ cell: total, cells: total, label: "done" });
  return {
    date: new Date().toISOString(),
    machine: {
      userAgent: navigator.userAgent,
      gpu: gpuName(),
      dpr: globalThis.devicePixelRatio || 1,
      viewport: host.viewport,
    },
    cells,
  };
}
