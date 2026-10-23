/**
 * Beads travelling the links a turn made, the AI Coding Dictionary's bead
 * system adapted: a pool of 320 points, eight per link, each running along
 * its link at its own speed and brightening through the middle of the run.
 * Direction is the link's: a link from A to B runs A → B; a link the turn
 * added both ways splits its beads, half each way.
 *
 * Beads exist only while the turn's story is lit. With no lanes the pool is
 * empty, and the renderer stops asking for frames.
 */
import { Vector3 } from "three";

import type { PlayFocus } from "../model/plays.ts";
import { EdgeDirection, EdgeKind, type GraphView } from "../model/view.ts";
import type { EdgeStyle } from "./edgeStyle.ts";
import { type NodeState, StyleChannel } from "./nodeState.ts";

export const BEAD_POOL = 320;
export const BEADS_PER_EDGE = 8;
/** The longest step a bead takes, so a returning tab does not jump them. */
export const MAX_BEAD_DT = 0.05;

/** A link beads run along: its edge index and the ways the turn added it (`EdgeDirection` bits). */
export interface BeadLane {
  readonly edge: number;
  readonly ways: number;
}

export class BeadSet {
  count = 0;
  /** The edge each bead runs along. */
  readonly edge = new Int32Array(BEAD_POOL);
  /** 1 when the bead runs from the edge's b end to its a end. */
  readonly reversed = new Uint8Array(BEAD_POOL);
  /** How far along its run, 0–1. */
  readonly t = new Float32Array(BEAD_POOL);
  /** Edge lengths per second. */
  readonly speed = new Float32Array(BEAD_POOL);
  /** Diameter in pixels at the reading density, before line thickness. */
  readonly size = new Float32Array(BEAD_POOL);
}

/**
 * The lanes of a view: the links the checkpoint's own turn made new (not the
 * ones it broke) and still shows, while the story is lit. None when dark. A
 * selected link play is the story instead: its link alone, the way it was
 * written, for as long as it is selected.
 */
export function beadLanes(
  view: GraphView,
  storyLit: boolean,
  play: PlayFocus | null = null,
): Array<BeadLane> {
  const lanes: Array<BeadLane> = [];
  if (play !== null) {
    // The play draws its own links, whatever became of them later in the turn.
    for (const { edge, kind, ways } of play.links) {
      if (kind === "link" && edge >= 0 && ways !== 0) lanes.push({ edge, ways });
    }
    return lanes;
  }
  if (!storyLit) return lanes;
  view.edgeNewWays.forEach((ways, edge) => {
    if (ways === 0 || view.edgeVisible[edge] !== 1) return;
    if (view.edgeCurrent[edge] !== 1 || view.edgeKind[edge] !== EdgeKind.new) return;
    lanes.push({ edge, ways });
  });
  return lanes;
}

/**
 * Deal the pool over the lanes: `min(320, 8 × lanes)` beads, bead i on lane
 * i mod n, at a random place, speed, and size. A two-way lane alternates its
 * beads' direction round by round, so half run each way.
 */
export function assignBeads(
  beads: BeadSet,
  lanes: ReadonlyArray<BeadLane>,
  random: () => number = Math.random,
): void {
  const n = lanes.length;
  beads.count = Math.min(BEAD_POOL, BEADS_PER_EDGE * n);
  for (let i = 0; i < beads.count; i += 1) {
    const lane = lanes[i % n];
    if (lane === undefined) continue;
    const forward = (lane.ways & EdgeDirection.forward) !== 0;
    const backward = (lane.ways & EdgeDirection.backward) !== 0;
    const round = Math.floor(i / n);
    beads.edge[i] = lane.edge;
    beads.reversed[i] = forward && backward ? round % 2 : forward ? 0 : 1;
    beads.t[i] = random();
    beads.speed[i] = 0.1 + 0.1 * random();
    beads.size[i] = 2.4 + 1.4 * random();
  }
}

/** Move every bead along by `dt` seconds (clamped), wrapping at the end of its run. */
export function advanceBeads(beads: BeadSet, dt: number): void {
  const h = Math.min(Math.max(dt, 0), MAX_BEAD_DT);
  for (let i = 0; i < beads.count; i += 1) {
    const t = (beads.t[i] ?? 0) + (beads.speed[i] ?? 0) * h;
    beads.t[i] = t >= 1 ? t - Math.floor(t) : t;
  }
}

/** A bead brightens through the middle of its run and is dark at both ends. */
export const beadBrightness = (t: number) => Math.sin(t * Math.PI);

/** Where along the a → b path a bead sits: `t`, or `1 − t` when it runs b → a. */
export const beadAlong = (t: number, reversed: boolean) => (reversed ? 1 - t : t);

/** Anything beads can be written into: a typed array or a buffer attribute's array. */
type Slots = { [index: number]: number };

/**
 * Write each bead where it runs now, along its link between the two nodes'
 * rims as the ribbon draws it, into `positions` (x, y, z per bead), and how
 * bright it is into `bright`: its run's brightness, dimmed with its link.
 */
export function placeBeads(
  beads: BeadSet,
  edges: ReadonlyArray<{ readonly a: number; readonly b: number }>,
  state: NodeState,
  edgeStyle: EdgeStyle,
  positions: Slots,
  bright: Slots,
): void {
  const a = new Vector3();
  const b = new Vector3();
  for (let i = 0; i < beads.count; i += 1) {
    const index = beads.edge[i] ?? -1;
    const edge = edges[index];
    if (edge === undefined) continue;
    state.current(edge.a, a);
    state.current(edge.b, b);
    const visibleA = state.styleOf(edge.a, StyleChannel.visibility);
    const visibleB = state.styleOf(edge.b, StyleChannel.visibility);
    const span = a.distanceTo(b);
    const ra = state.drawnRadius(edge.a) * visibleA;
    const rb = state.drawnRadius(edge.b) * visibleB;
    const t = beads.t[i] ?? 0;
    const along = beadAlong(t, beads.reversed[i] === 1);
    const from = span > 0 ? ra / span : 0;
    const to = span > 0 ? 1 - rb / span : 1;
    b.sub(a)
      .multiplyScalar(from + (to - from) * along)
      .add(a);
    positions[i * 3] = b.x;
    positions[i * 3 + 1] = b.y;
    positions[i * 3 + 2] = b.z;
    const lit = (edgeStyle.values[index * 2] ?? 0) * (edgeStyle.values[index * 2 + 1] ?? 0);
    bright[i] = span > ra + rb ? beadBrightness(t) * lit * Math.min(visibleA, visibleB) : 0;
  }
}
