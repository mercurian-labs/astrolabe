/**
 * A file graph's forces, as Obsidian's: a pull to the centre, repulsion between every pair, a
 * spring along each link, and a link length. The simulation runs one tick per frame while it
 * moves and says when it has settled, so the graph stops drawing at rest; it can also settle at
 * once, for a picture shown whole. Starts come from the last picture's positions or from ids, so
 * a graph always settles the same.
 */
import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNode3D,
} from "d3-force-3d";

import type { FileGraphData } from "../model/fileGraph.ts";
import type { FileGraphForces } from "../model/fileGraphSettings.ts";
import { seededPoint } from "./forceLayout.ts";

/** Below this the simulation has cooled: it stops. */
export const ALPHA_MIN = 0.001;
/** Once cooling, no node moving faster than this (world pixels a tick) is at rest. */
export const REST_SPEED = 0.03;
/** About this many ticks from a full start to cool. */
const COOLING_TICKS = 220;
/** A dragged node keeps the graph this warm until it is let go. */
const DRAG_HEAT = 0.3;
/** Repel force 1 is this much d3 charge; 10 (the default) holds files a link apart. */
const REPEL_UNIT = 32;
/** Center force 1 is this much pull to the middle. */
const CENTER_UNIT = 0.12;
/** The most ticks a picture shown whole settles in. */
const SETTLE_TICKS = 600;

export interface Point {
  readonly x: number;
  readonly y: number;
}

interface ForceNode extends SimulationNode3D {
  readonly id: string;
}

/** d3 swaps a link's ends for its nodes as it starts. */
interface ForceLink {
  readonly source: number | ForceNode;
  readonly target: number | ForceNode;
}

export class FileForces {
  readonly #nodes: Array<ForceNode>;
  readonly #byId: Map<string, ForceNode>;
  /** Each link's least end degree, by the link's index. */
  readonly #leastDegree: ReadonlyArray<number>;
  readonly #simulation;
  readonly #link;
  readonly #charge;
  readonly #x;
  readonly #y;
  #moving = false;

  /**
   * `previous` gives a node the place it had in the last picture; a new node starts beside a
   * neighbour that had one, or around the middle.
   */
  constructor(
    graph: FileGraphData,
    forces: FileGraphForces,
    previous: (id: string) => Point | null = () => null,
  ) {
    const indexOf = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const links: Array<ForceLink> = [];
    const degree = graph.nodes.map(() => 0);
    const neighbours = new Map<string, Array<string>>();
    for (const link of graph.links) {
      const source = indexOf.get(link.from);
      const target = indexOf.get(link.to);
      if (source === undefined || target === undefined || source === target) continue;
      links.push({ source, target });
      degree[source] = (degree[source] ?? 0) + 1;
      degree[target] = (degree[target] ?? 0) + 1;
      neighbours.set(link.from, [...(neighbours.get(link.from) ?? []), link.to]);
      neighbours.set(link.to, [...(neighbours.get(link.to) ?? []), link.from]);
    }
    this.#leastDegree = links.map((link) =>
      Math.max(1, Math.min(degree[link.source as number] ?? 1, degree[link.target as number] ?? 1)),
    );
    const spread = forces.linkDistance;
    this.#nodes = graph.nodes.map((node) => {
      const kept = previous(node.id);
      if (kept !== null) return { id: node.id, x: kept.x, y: kept.y };
      const beside = (neighbours.get(node.id) ?? []).map(previous).find((point) => point !== null);
      const [dx, dy] = seededPoint(node.id, beside === undefined ? spread * 2 : spread);
      return { id: node.id, x: (beside?.x ?? 0) + dx, y: (beside?.y ?? 0) + dy };
    });
    this.#byId = new Map(this.#nodes.map((node) => [node.id, node]));
    this.#link = forceLink<ForceNode, ForceLink>(links);
    this.#charge = forceManyBody<ForceNode>();
    this.#x = forceX<ForceNode>(0);
    this.#y = forceY<ForceNode>(0);
    // Stopped in the same call that creates it, before d3's timer can fire.
    this.#simulation = forceSimulation(this.#nodes, 2)
      .stop()
      .alphaDecay(1 - ALPHA_MIN ** (1 / COOLING_TICKS))
      .force("link", this.#link)
      .force("charge", this.#charge)
      .force("x", this.#x)
      .force("y", this.#y);
    this.#apply(forces);
  }

  /** Whether it is still moving: the renderer draws a frame per tick while it is. */
  get moving(): boolean {
    return this.#moving;
  }

  positionOf(id: string): Point | null {
    const node = this.#byId.get(id);
    return node === undefined ? null : { x: node.x ?? 0, y: node.y ?? 0 };
  }

  /** Every node's place, in the graph's order. */
  positions(): ReadonlyArray<Point> {
    return this.#nodes.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 }));
  }

  /** New forces; the graph warms to find its new rest. */
  setForces(forces: FileGraphForces): void {
    this.#apply(forces);
    this.reheat(0.3);
  }

  /** Warm the graph to at least `alpha`, so it moves again. */
  reheat(alpha: number): void {
    this.#simulation.alpha(Math.max(this.#simulation.alpha(), alpha));
    this.#moving = true;
  }

  /** Every node thrown out from the middle, then laid out again from a full start: Animate. */
  scatter(): void {
    for (const node of this.#nodes) {
      const [dx, dy] = seededPoint(`${node.id}/scatter`, 40);
      node.x = dx;
      node.y = dy;
      node.vx = 0;
      node.vy = 0;
    }
    this.#simulation.alpha(1);
    this.#moving = true;
  }

  /** Hold `id` at a point while it is dragged; the graph stays warm around it. */
  drag(id: string, point: Point): void {
    const node = this.#byId.get(id);
    if (node === undefined) return;
    node.fx = point.x;
    node.fy = point.y;
    this.#simulation.alphaTarget(DRAG_HEAT);
    this.reheat(DRAG_HEAT);
  }

  /** Let a dragged node go: the graph cools and settles. */
  release(id: string): void {
    const node = this.#byId.get(id);
    if (node !== undefined) {
      node.fx = null;
      node.fy = null;
    }
    this.#simulation.alphaTarget(0);
  }

  /** One tick; false once it has settled, and it stays settled until warmed again. */
  step(): boolean {
    if (!this.#moving) return false;
    this.#simulation.tick();
    const cooling = this.#simulation.alphaTarget() === 0;
    this.#moving = !(
      cooling &&
      (this.#simulation.alpha() < ALPHA_MIN || this.#fastest() < REST_SPEED)
    );
    return this.#moving;
  }

  /** Settle at once, for a picture shown whole; returns how many ticks it took. */
  settle(): number {
    this.reheat(1);
    let ticks = 0;
    while (ticks < SETTLE_TICKS && this.step()) ticks += 1;
    this.#moving = false;
    return ticks;
  }

  #fastest(): number {
    let fastest = 0;
    for (const node of this.#nodes) {
      fastest = Math.max(fastest, Math.hypot(node.vx ?? 0, node.vy ?? 0));
    }
    return fastest;
  }

  #apply(forces: FileGraphForces): void {
    // d3's own link strength, scaled: a link between two hubs pulls less than one to a leaf.
    this.#link
      .distance(forces.linkDistance)
      .strength((_, index) => forces.linkForce / (this.#leastDegree[index] ?? 1));
    // A loose Barnes–Hut approximation: a few hundred files settle in a few dozen milliseconds.
    this.#charge.strength(-forces.repelForce * REPEL_UNIT).theta(1.2);
    this.#x.strength(forces.centerForce * CENTER_UNIT);
    this.#y.strength(forces.centerForce * CENTER_UNIT);
  }
}
