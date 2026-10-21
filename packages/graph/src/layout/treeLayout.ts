/**
 * The home layout of a containment tree (a codebase): every note sits inside
 * its container's disc. Bottom up, each container's children settle as a
 * small graph of their own, a leaf as a dot the size its degree gives it and
 * a container as the disc its own children pack into, pulled together by
 * whether links run between their descendants; the container's disc is the
 * extent they take. The roots settle the same way, and each note lands at its
 * container's place plus its own. Containment is not a force: notes in two
 * containers meet only through their containers' links.
 *
 * Past FORCE_LAYOUT_LIMIT notes (or in a level too large to settle) each
 * level is packed instead: largest first, each on a spiral where it overlaps
 * nothing, nested by the same tree.
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
import {
  boundsOf,
  collisionRadius,
  LAYOUT_TICKS,
  medianNearestNeighbour,
  seededPoint,
  type GraphLayout,
} from "./forceLayout.ts";

/** A container's disc reaches this share of the link distance past its outermost child. */
const DISC_PAD = 0.35;
/** Two linked items sit their radii plus this share of the link distance apart. */
const LINK_GAP = 0.35;
/** Within a level, charge runs at this share of the layout's repel force: collision does the spacing. */
const LEVEL_CHARGE = 0.25;
/** Within a level, the pull toward the level's middle is at least this strong. */
const LEVEL_CENTRE = 0.12;
/** A level with more items than this is packed even where forces would run. */
const PACK_ABOVE = 1500;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface Item extends SimulationNode3D {
  /** The note this item is, by universe index. */
  readonly note: number;
  readonly radius: number;
}

/** A link by item position; d3 replaces the ends with the items themselves once the force starts. */
interface Link {
  readonly source: number | Item;
  readonly target: number | Item;
}

/** Each item's place relative to its container's centre, and the radius of the disc they fill. */
export interface Settled {
  readonly places: Float64Array;
  readonly radius: number;
}

/**
 * The links between sibling items, per level (by container, -1 for the
 * roots): a link between two notes counts once for the two children of their
 * nearest common container that hold them.
 */
export function siblingLinks(
  parentOf: Int32Array,
  edges: Iterable<{ readonly a: number; readonly b: number }>,
): Map<number, Array<readonly [number, number]>> {
  const chain = (note: number) => {
    const up: Array<number> = [];
    for (let at = note; at >= 0; at = parentOf[at] ?? -1) up.push(at);
    return up.toReversed();
  };
  const seen = new Set<string>();
  const levels = new Map<number, Array<readonly [number, number]>>();
  for (const edge of edges) {
    const a = chain(edge.a);
    const b = chain(edge.b);
    let depth = 0;
    while (depth < a.length && depth < b.length && a[depth] === b[depth]) depth += 1;
    const left = a[depth];
    const right = b[depth];
    // One end contains the other: containment is not a link.
    if (left === undefined || right === undefined) continue;
    const key = left < right ? `${left}:${right}` : `${right}:${left}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const container = depth === 0 ? -1 : (a[depth - 1] ?? -1);
    const level = levels.get(container) ?? [];
    level.push([left, right]);
    levels.set(container, level);
  }
  return levels;
}

/** Settle `items` by forces around the origin. */
function settleByForces(
  items: Array<Item>,
  pairs: ReadonlyArray<readonly [number, number]>,
  forces: LayoutForces,
  dimensions: 2 | 3,
  leafRadius: number,
): void {
  const at = new Map(items.map((item, slot) => [item.note, slot]));
  const links: Array<Link> = [];
  for (const [a, b] of pairs) {
    const source = at.get(a);
    const target = at.get(b);
    if (source !== undefined && target !== undefined) links.push({ source, target });
  }
  const gap = LINK_GAP * forces.linkDistance;
  const radiusOf = (end: number | Item) =>
    typeof end === "number" ? (items[end]?.radius ?? 0) : end.radius;
  // A level is a small graph: held together firmly so its disc packs, not drifts.
  const centre = Math.max(forces.centerForce, LEVEL_CENTRE);
  const simulation = forceSimulation(items, dimensions)
    .stop()
    .force(
      "link",
      forceLink<Item, Link>(links).distance((link) =>
        Math.max(forces.linkDistance, radiusOf(link.source) + radiusOf(link.target) + gap),
      ),
    )
    .force(
      "charge",
      forceManyBody<Item>()
        .strength(
          (item) => -forces.repelForce * LEVEL_CHARGE * Math.max(1, item.radius / leafRadius),
        )
        .theta(1.2),
    )
    .force("x", forceX<Item>(0).strength(centre))
    .force("y", forceY<Item>(0).strength(centre))
    // Siblings keep their radii and the link gap apart, containers or leaves alike.
    .force("collide", forceCollide<Item>((item) => item.radius * 1.03 + gap / 2).iterations(3));
  if (dimensions === 3) simulation.force("z", forceZ<Item>(0).strength(centre));
  simulation.tick(LAYOUT_TICKS);
}

/**
 * Pack `items` without forces around the origin: largest first, each on the
 * first point of a spiral (a sunflower flat, a golden-angle helix in space)
 * where it overlaps nothing placed.
 */
function settleByPacking(items: Array<Item>, dimensions: 2 | 3): void {
  const order = items
    .map((_, slot) => slot)
    .toSorted(
      (left, right) => (items[right]?.radius ?? 0) - (items[left]?.radius ?? 0) || left - right,
    );
  const step = Math.max(Math.min(...items.map((item) => item.radius)), 1e-6);
  const placed: Array<Item> = [];
  for (const slot of order) {
    const item = items[slot];
    if (item === undefined) continue;
    for (let k = 0; k <= 200_000; k += 1) {
      const reach = step * Math.sqrt(k) * 1.2;
      const angle = k * GOLDEN_ANGLE;
      const lift = dimensions === 3 ? Math.cos(k * 0.618034) : 0;
      const across = Math.sqrt(1 - lift * lift);
      const x = reach * across * Math.cos(angle);
      const y = reach * across * Math.sin(angle);
      const z = reach * lift;
      const clear = placed.every(
        (other) =>
          Math.hypot((other.x ?? 0) - x, (other.y ?? 0) - y, (other.z ?? 0) - z) >=
          other.radius + item.radius,
      );
      if (!clear && k < 200_000) continue;
      item.x = x;
      item.y = y;
      if (dimensions === 3) item.z = z;
      placed.push(item);
      break;
    }
  }
}

/**
 * Settle one level: `members` (siblings) as items of `radius` each, centred
 * on their centroid; the disc they fill is their extent plus a pad.
 */
export function settleLevel(
  members: ReadonlyArray<number>,
  radius: (note: number) => number,
  id: (note: number) => string,
  pairs: ReadonlyArray<readonly [number, number]>,
  forces: LayoutForces,
  dimensions: 2 | 3,
  packed: boolean,
): Settled {
  const spread = forces.linkDistance * Math.cbrt(Math.max(members.length, 1));
  const items: Array<Item> = members.map((note) => {
    const [x, y, z] = seededPoint(id(note), spread);
    return dimensions === 3
      ? { note, radius: radius(note), x, y, z }
      : { note, radius: radius(note), x, y };
  });
  if (items.length === 1) {
    const only = items[0];
    if (only !== undefined) {
      only.x = 0;
      only.y = 0;
      if (dimensions === 3) only.z = 0;
    }
  } else if (packed || items.length > PACK_ABOVE) settleByPacking(items, dimensions);
  else settleByForces(items, pairs, forces, dimensions, collisionRadius(0, forces.linkDistance));
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const item of items) {
    cx += item.x ?? 0;
    cy += item.y ?? 0;
    cz += item.z ?? 0;
  }
  const n = Math.max(items.length, 1);
  const places = new Float64Array(items.length * 3);
  let extent = 0;
  items.forEach((item, slot) => {
    const x = (item.x ?? 0) - cx / n;
    const y = (item.y ?? 0) - cy / n;
    const z = dimensions === 3 ? (item.z ?? 0) - cz / n : 0;
    places[slot * 3] = x;
    places[slot * 3 + 1] = y;
    places[slot * 3 + 2] = z;
    extent = Math.max(extent, Math.hypot(x, y, z) + item.radius);
  });
  return { places, radius: extent + DISC_PAD * forces.linkDistance };
}

export function treeLayout(
  universe: Universe,
  forces: LayoutForces,
  dimensions: 2 | 3,
  packed: boolean,
): GraphLayout {
  const started = performance.now();
  const { nodes, childrenOf, parentOf } = universe;
  const count = nodes.length;
  const levels = siblingLinks(
    parentOf,
    universe.edges.filter((edge) => !edge.lensOnly && !edge.aggregate),
  );
  const degree = (note: number) => universe.index.degree.get(nodes[note]?.id ?? "") ?? 0;
  const settled = new Map<number, Settled>();
  const radius = (note: number) =>
    settled.get(note)?.radius ?? collisionRadius(degree(note), forces.linkDistance);
  const id = (note: number) => nodes[note]?.id ?? String(note);
  const level = (members: ReadonlyArray<number>, container: number) =>
    settleLevel(members, radius, id, levels.get(container) ?? [], forces, dimensions, packed);

  // Bottom up: a container settles once its children have.
  const roots = nodes.map((_, note) => note).filter((note) => (parentOf[note] ?? -1) < 0);
  const visit = (note: number) => {
    const children = childrenOf[note] ?? [];
    for (const child of children) visit(child);
    if (children.length > 0) settled.set(note, level(children, note));
  };
  for (const root of roots) visit(root);
  const top = level(roots, -1);

  // Top down: each note at its container's place plus its own; a container's own place is its disc's middle.
  const positions = new Float32Array(count * 3);
  const place = (
    members: ReadonlyArray<number>,
    at: Settled,
    ox: number,
    oy: number,
    oz: number,
  ) => {
    members.forEach((note, slot) => {
      const x = ox + (at.places[slot * 3] ?? 0);
      const y = oy + (at.places[slot * 3 + 1] ?? 0);
      const z = oz + (at.places[slot * 3 + 2] ?? 0);
      positions[note * 3] = x;
      positions[note * 3 + 1] = y;
      positions[note * 3 + 2] = z;
      const inner = settled.get(note);
      if (inner !== undefined) place(childrenOf[note] ?? [], inner, x, y, z);
    });
  };
  place(roots, top, 0, 0, 0);

  const { center, radius: extent } = boundsOf(positions);
  // The spacing is the leaves': a container's place is its disc's middle, not a note beside the others.
  const leaves = nodes
    .map((_, note) => note)
    .filter((note) => (childrenOf[note] ?? []).length === 0);
  const leafPositions = new Float32Array(leaves.length * 3);
  leaves.forEach((note, slot) => {
    for (let axis = 0; axis < 3; axis += 1) {
      leafPositions[slot * 3 + axis] = positions[note * 3 + axis] ?? 0;
    }
  });
  return {
    dimensions,
    positions,
    center,
    radius: extent,
    spacing: medianNearestNeighbour(leafPositions, leaves.length),
    ms: performance.now() - started,
  };
}
