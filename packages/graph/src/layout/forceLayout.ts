/**
 * A memory links in cycles, so it is settled by forces, not ranked. The simulation runs a fixed
 * tick budget synchronously and stops before returning, and starts come from note ids, so a memory
 * always settles the same. The flat layout pins z to 0 and seeds from the spatial x and y, so the
 * two read as one shape.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type SimulationNode3D,
} from "d3-force-3d";

import type { LayoutForces } from "../model/settings.ts";
import type { Universe } from "../model/universe.ts";

export const LAYOUT_TICKS = 300;

/** A node's radius in the force solve: bigger with more links, so hubs get more room. */
export const nodeRadius = (degree: number) => 1.4 + 0.62 * Math.sqrt(Math.max(degree, 0));

/**
 * Layouts of larger memories spread wider; line details (dashes, arrowheads)
 * and motion scale with the web by this unit.
 */
export const MAX_LAYOUT_UNIT = 3.5;
export const layoutUnit = (layout: Pick<GraphLayout, "radius">) =>
  Math.max(1, Math.min(MAX_LAYOUT_UNIT, layout.radius / 150));

/**
 * The spacing a layout is drawn against: how far apart its notes actually sit,
 * never less than half the link distance, the collision force's own minimum.
 */
export const layoutSpan = (layout: Pick<GraphLayout, "spacing">, linkDistance: number) =>
  Math.max(layout.spacing, 0.5 * linkDistance);

/** A note with no links is drawn at this share of the spacing, at node size 1: a small dot. */
export const RADIUS_SHARE = 0.055;
/**
 * The share of the reading density's spacing a lone note is drawn at, at node
 * size 1: about 3.7 of the spacing's 96 pixels, whatever the memory, since the
 * graph always lands at that density.
 */
export const READING_RADIUS_SHARE = 0.039;
/** Whatever the node size, a note before its degree scale never draws past this share of the spacing. */
export const RADIUS_CAP = 0.14;
/** Size is connectedness, gently: the most-linked hub draws at most this many times a lone note. */
export const DEGREE_SCALE_CAP = 1.6;
export const degreeScale = (degree: number) =>
  Math.min(DEGREE_SCALE_CAP, 1 + 0.15 * Math.sqrt(Math.max(degree, 0)));

/** The collision force runs this much wide, since it is soft: pairs settle a hair inside it. */
const COLLISION_SLACK = 1.03;

/** The collision radius the layout holds a node to: `1.6 r + 0.25 L`. */
export const collisionRadius = (degree: number, linkDistance: number) =>
  1.6 * nodeRadius(degree) + 0.25 * linkDistance;

/**
 * Never past the collision radius: two drawn radii then sum to at most two collision radii, which
 * the layout holds apart, so drawn nodes never overlap at rest for any node size without solving
 * the layout again.
 */
export const drawnRadius = (
  degree: number,
  nodeSize: number,
  spacing: number,
  linkDistance: number,
) =>
  Math.min(
    Math.min(RADIUS_SHARE * nodeSize, RADIUS_CAP) * spacing * degreeScale(degree),
    collisionRadius(degree, linkDistance),
  );

/**
 * The radius a node is drawn at against the reading density's spacing `span`:
 * the same on screen in every memory and reading, since the graph lands at
 * that density. At most RADIUS_CAP of the span times the hub scale, a quarter
 * of it, so notes a spacing apart never overlap: no collision cap is needed.
 */
export const readingRadius = (degree: number, nodeSize: number, span: number) =>
  Math.min(READING_RADIUS_SHARE * nodeSize, RADIUS_CAP) * span * degreeScale(degree);

/** A closed container is drawn this many lone-note radii wider per square root of the notes it holds. */
export const CLOSED_GROWTH = 0.6;

/**
 * The drawn radius of a shown thing by its view degree: a note's degree, or
 * for a closed container minus the number of notes it holds, so it grows like
 * the disc those notes would pack into, gently.
 */
export const shownRadius = (degree: number, nodeSize: number, span: number) =>
  degree < 0
    ? readingRadius(0, nodeSize, span) * (1 + CLOSED_GROWTH * Math.sqrt(-degree))
    : readingRadius(degree, nodeSize, span);

export interface GraphLayout {
  readonly dimensions: 2 | 3;
  /** x, y, z per universe node. */
  readonly positions: Float32Array;
  readonly center: readonly [number, number, number];
  /** The radius around the center that holds every node. */
  readonly radius: number;
  /**
   * How far apart notes actually sit: the median distance from a note to its
   * nearest neighbour. A force layout packs tighter than its link distance,
   * so this, not the link distance, is what the reading density measures.
   */
  readonly spacing: number;
  /** How long the solve took, in milliseconds. */
  readonly ms: number;
}

/**
 * The median nearest-neighbour distance among the first `count` points,
 * exact, found through a uniform grid: each point searches outward cell ring
 * by cell ring until no nearer point can remain, so a web of any size costs
 * about one pass (it was quadratic, which 100,000 notes cannot afford).
 */
export function medianNearestNeighbour(positions: Float32Array, count = positions.length / 3) {
  if (count < 2) return 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < count; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index * 3 + axis] ?? 0;
      min[axis] = Math.min(min[axis] ?? 0, value);
      max[axis] = Math.max(max[axis] ?? 0, value);
    }
  }
  const extent = [0, 1, 2].map((axis) => (max[axis] ?? 0) - (min[axis] ?? 0));
  const spread = extent.filter((size) => size > 1e-9);
  // About one point per cell: the cell edge is the mean spacing over the occupied dimensions.
  const volume = spread.reduce((product, size) => product * size, 1);
  const cell = spread.length === 0 ? 1 : Math.max((volume / count) ** (1 / spread.length), 1e-9);
  const cells = extent.map((size) => Math.max(1, Math.floor(size / cell) + 1));
  const [nx = 1, ny = 1, nz = 1] = cells;
  const cellOf = (index: number, axis: number) =>
    Math.min(
      (cells[axis] ?? 1) - 1,
      Math.floor(((positions[index * 3 + axis] ?? 0) - (min[axis] ?? 0)) / cell),
    );
  // Counting sort of the points by cell: `starts` indexes `order` by cell.
  const cellCount = nx * ny * nz;
  const home = new Int32Array(count);
  const starts = new Int32Array(cellCount + 1);
  for (let index = 0; index < count; index += 1) {
    const key = cellOf(index, 0) + nx * (cellOf(index, 1) + ny * cellOf(index, 2));
    home[index] = key;
    starts[key + 1] = (starts[key + 1] ?? 0) + 1;
  }
  for (let key = 0; key < cellCount; key += 1)
    starts[key + 1] = (starts[key + 1] ?? 0) + (starts[key] ?? 0);
  const fill = starts.slice(0, cellCount);
  const order = new Int32Array(count);
  for (let index = 0; index < count; index += 1) {
    const key = home[index] ?? 0;
    order[fill[key] ?? 0] = index;
    fill[key] = (fill[key] ?? 0) + 1;
  }
  const nearest = new Float64Array(count);
  const maxRing = Math.max(nx, ny, nz);
  for (let index = 0; index < count; index += 1) {
    const cx = cellOf(index, 0);
    const cy = cellOf(index, 1);
    const cz = cellOf(index, 2);
    const px = positions[index * 3] ?? 0;
    const py = positions[index * 3 + 1] ?? 0;
    const pz = positions[index * 3 + 2] ?? 0;
    let best = Infinity;
    for (let ring = 0; ring <= maxRing; ring += 1) {
      // Everything outside this ring is at least `ring` cells away.
      if (best <= (ring - 1) * cell) break;
      for (let z = cz - ring; z <= cz + ring; z += 1) {
        if (z < 0 || z >= nz) continue;
        for (let y = cy - ring; y <= cy + ring; y += 1) {
          if (y < 0 || y >= ny) continue;
          for (let x = cx - ring; x <= cx + ring; x += 1) {
            if (x < 0 || x >= nx) continue;
            // Only the ring's shell: the inside was searched already.
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== ring) continue;
            const key = x + nx * (y + ny * z);
            for (let at = starts[key] ?? 0; at < (starts[key + 1] ?? 0); at += 1) {
              const other = order[at] ?? 0;
              if (other === index) continue;
              const distance = Math.hypot(
                px - (positions[other * 3] ?? 0),
                py - (positions[other * 3 + 1] ?? 0),
                pz - (positions[other * 3 + 2] ?? 0),
              );
              if (distance < best) best = distance;
            }
          }
        }
      }
    }
    nearest[index] = best;
  }
  nearest.sort();
  const middle = Math.floor(count / 2);
  return count % 2 === 1
    ? (nearest[middle] ?? 0)
    : ((nearest[middle - 1] ?? 0) + (nearest[middle] ?? 0)) / 2;
}

interface ForceNode extends SimulationNode3D {
  readonly radius: number;
}

/** A starting point in a cube of side `spread`, drawn from the id alone. */
export function seededPoint(id: string, spread: number): [number, number, number] {
  let state = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    state ^= id.charCodeAt(i);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const next = () => {
    // xorshift32: a few deterministic draws from the id's hash.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296 - 0.5;
  };
  return [next() * spread, next() * spread, next() * spread];
}

export function layoutUniverse(
  universe: Universe,
  forces: LayoutForces,
  dimensions: 2 | 3,
  seed?: GraphLayout,
): GraphLayout {
  const started = performance.now();
  const count = universe.nodes.length;
  const spread = forces.linkDistance * Math.cbrt(Math.max(count, 1));
  const nodes: Array<ForceNode> = universe.nodes.map((node, index) => {
    const radius = nodeRadius(universe.index.degree.get(node.id) ?? 0);
    const [x, y, z] =
      seed === undefined
        ? seededPoint(node.id, spread)
        : [seed.positions[index * 3] ?? 0, seed.positions[index * 3 + 1] ?? 0, 0];
    return dimensions === 3 ? { radius, x, y, z } : { radius, x, y };
  });
  const links = universe.edges
    .filter((edge) => !edge.lensOnly)
    .map((edge) => ({ source: edge.a, target: edge.b }));

  // Stopped in the same call that creates it, before d3's timer can fire.
  const simulation = forceSimulation(nodes, dimensions)
    .stop()
    .force(
      "link",
      forceLink<ForceNode, { source: number; target: number }>(links).distance(forces.linkDistance),
    )
    // A looser Barnes–Hut approximation keeps a 600-note solve well under a second.
    .force("charge", forceManyBody<ForceNode>().strength(-forces.repelForce).theta(1.2))
    .force("x", forceX<ForceNode>(0).strength(forces.centerForce))
    .force("y", forceY<ForceNode>(0).strength(forces.centerForce))
    .force(
      "collide",
      // A little past the collision radius, so the force's softness never leaves
      // two nodes nearer than their collision radii sum: drawn nodes stop there.
      forceCollide<ForceNode>(
        (node) => (node.radius * 1.6 + 0.25 * forces.linkDistance) * COLLISION_SLACK,
      ),
    );
  if (dimensions === 3) simulation.force("z", forceZ<ForceNode>(0).strength(forces.centerForce));
  simulation.tick(LAYOUT_TICKS);

  const positions = new Float32Array(count * 3);
  nodes.forEach((node, index) => {
    positions[index * 3] = node.x ?? 0;
    positions[index * 3 + 1] = node.y ?? 0;
    positions[index * 3 + 2] = dimensions === 3 ? (node.z ?? 0) : 0;
  });
  const { center, radius } = boundsOf(positions);
  const spacing = medianNearestNeighbour(positions, count);
  return { dimensions, positions, center, radius, spacing, ms: performance.now() - started };
}

/** The box center of a set of points, and the radius around it that holds them all. */
export function boundsOf(positions: Float32Array, only?: ReadonlyArray<number>) {
  const indices = only ?? Array.from({ length: positions.length / 3 }, (_, index) => index);
  if (indices.length === 0) return { center: [0, 0, 0] as const, radius: 0 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const index of indices) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index * 3 + axis] ?? 0;
      min[axis] = Math.min(min[axis] ?? 0, value);
      max[axis] = Math.max(max[axis] ?? 0, value);
    }
  }
  const center = [0, 1, 2].map((axis) => ((min[axis] ?? 0) + (max[axis] ?? 0)) / 2) as [
    number,
    number,
    number,
  ];
  let radius = 0;
  for (const index of indices) {
    radius = Math.max(
      radius,
      Math.hypot(
        (positions[index * 3] ?? 0) - center[0],
        (positions[index * 3 + 1] ?? 0) - center[1],
        (positions[index * 3 + 2] ?? 0) - center[2],
      ),
    );
  }
  return { center, radius };
}
