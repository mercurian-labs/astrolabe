/**
 * The bench's scenarios, pure: each is a named list of steps the harness
 * drives through the renderer's bench driver and the graph's props, and each
 * step says what it measures. Every mode runs the identical steps, after the
 * same reset to the reference workload.
 */
import { LINK_HOLD_SECONDS } from "../src/model/playback.ts";
import type { ThreadRecord } from "../src/model/thread.ts";

export type StepKind = "load" | "rest" | "glide" | "story" | "pan" | "zoom" | "hover";

/** What a step's frames are measured for. */
export type Measure =
  /** From handing the graph a fresh memory to its first settled frame. */
  | "loadMs"
  /** Per-frame render and prep time, presented-frame delta, draw calls, labels, edges, beads. */
  | "frames"
  /** Frames rendered and timers fired while nothing should move: 0, or near it. */
  | "rest"
  /** Overlapping label rectangles among drawn labels, and labels the budget cut. */
  | "legibility"
  /** The share of presented link-hold frames in which visible beads moved. */
  | "beads";

export interface Step {
  readonly kind: StepKind;
  /** How long the step runs; a story's length comes from its plan instead. */
  readonly seconds: number;
  /** The story's checkpoints; the hover's nodes. */
  readonly count?: number;
  readonly measures: ReadonlyArray<Measure>;
}

export const SCENARIO_NAMES = ["load", "rest", "glide", "story", "pan", "zoom", "hover"] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export interface Scenario {
  readonly name: ScenarioName;
  readonly description: string;
  readonly steps: ReadonlyArray<Step>;
}

/** The story's checkpoints per run: enough to see the gathering travel and links land. */
export const STORY_CHECKPOINTS = 6;
/** Each checkpoint's gathering glide is given this long before the next lands. */
export const STORY_GLIDE_SECONDS = 0.8;
export const HOVER_NODES = 50;
/** Frames the hover rests on each node, so the hover state lands and draws. */
export const HOVER_FRAMES = 2;

export const SCENARIOS: Readonly<Record<ScenarioName, Scenario>> = {
  load: {
    name: "load",
    description:
      "A fresh memory to its first settled frame: universe, layout, and the first frame.",
    steps: [{ kind: "load", seconds: 0, measures: ["loadMs", "frames"] }],
  },
  rest: {
    name: "rest",
    description: "Ten seconds at rest: no frames, no timers.",
    steps: [{ kind: "rest", seconds: 10, measures: ["rest"] }],
  },
  glide: {
    name: "glide",
    description: "The glide bench: every note glides for three seconds.",
    steps: [{ kind: "glide", seconds: 3, measures: ["frames", "legibility"] }],
  },
  story: {
    name: "story",
    description: `The synthetic thread's first ${STORY_CHECKPOINTS} checkpoints, each landing, gathering, and running its beads for a link hold.`,
    steps: [
      {
        kind: "story",
        seconds: 0,
        count: STORY_CHECKPOINTS,
        measures: ["frames", "legibility", "beads"],
      },
    ],
  },
  pan: {
    name: "pan",
    description: "Three seconds of scripted panning around a closed loop.",
    steps: [{ kind: "pan", seconds: 3, measures: ["frames", "legibility"] }],
  },
  zoom: {
    name: "zoom",
    description: "Wheel zoom in and back out about the canvas centre.",
    steps: [{ kind: "zoom", seconds: 3, measures: ["frames", "legibility"] }],
  },
  hover: {
    name: "hover",
    description: `The pointer sweeps across ${HOVER_NODES} notes in view.`,
    steps: [{ kind: "hover", seconds: 0, count: HOVER_NODES, measures: ["frames"] }],
  },
};

/**
 * A pan that returns to where it began: per-frame screen deltas along a
 * Lissajous loop of `radius` pixels, for `seconds` at `fps`.
 */
export function panDeltas(
  seconds: number,
  fps = 60,
  radius = 160,
): Array<readonly [number, number]> {
  const frames = Math.max(1, Math.round(seconds * fps));
  const point = (frame: number) => {
    const t = (frame / frames) * 2 * Math.PI;
    return [radius * Math.sin(t), radius * 0.6 * Math.sin(2 * t)] as const;
  };
  return Array.from({ length: frames }, (_, frame) => {
    const [x0, y0] = point(frame);
    const [x1, y1] = point(frame + 1);
    return [x1 - x0, y1 - y0] as const;
  });
}

/** Per-frame zoom factors: in by `depth` over the first half, back out over the second; they multiply to 1. */
export function zoomFactors(seconds: number, fps = 60, depth = 3): Array<number> {
  const frames = Math.max(2, Math.round(seconds * fps));
  const half = Math.floor(frames / 2);
  const step = depth ** (1 / half);
  return Array.from({ length: half * 2 }, (_, frame) => (frame < half ? step : 1 / step));
}

/** Up to `count` distinct notes from `candidates`, chosen by a seeded shuffle so every mode hovers the same ones. */
export function hoverTargets(
  candidates: ReadonlyArray<number>,
  count: number,
  seed = 20260927,
): Array<number> {
  const pool = [...candidates].toSorted((left, right) => left - right);
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    const held = pool[index] ?? 0;
    pool[index] = pool[swap] ?? 0;
    pool[swap] = held;
  }
  return pool.slice(0, count);
}

export interface StoryBeat {
  readonly checkpoint: number;
  /** The gathering's glide before anything else. */
  readonly glideSeconds: number;
  /** A link hold after it, when the turn made a link: beads run. */
  readonly linkSeconds: number;
}

/** The story's beats: the first `checkpoints` checkpoints, a glide each, and a link hold where the turn links. */
export function storyPlan(thread: ThreadRecord, checkpoints: number): Array<StoryBeat> {
  return thread.turns.slice(0, checkpoints).map((turn, checkpoint) => ({
    checkpoint,
    glideSeconds: STORY_GLIDE_SECONDS,
    linkSeconds: turn.events.some((event) => event.kind === "link") ? LINK_HOLD_SECONDS : 0,
  }));
}
