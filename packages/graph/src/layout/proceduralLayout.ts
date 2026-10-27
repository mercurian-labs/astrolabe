/**
 * The home layout past FORCE_LAYOUT_LIMIT, where forces cannot settle on the main thread: placed,
 * not simulated. Each group is a ball of lattice slots filled most-linked first, every note nudged
 * off its slot so no lattice shows, and groups sit far enough apart never to touch. Deterministic
 * from ids; 100,000 notes in well under a second.
 */
import type { LayoutForces } from "../model/settings.ts";
import type { Universe } from "../model/universe.ts";
import { boundsOf, medianNearestNeighbour, seededPoint, type GraphLayout } from "./forceLayout.ts";

/** The force layout runs up to this many notes; past it (3k takes ~7 s, 10k ~30 s), notes are placed. */
export const FORCE_LAYOUT_LIMIT = 3000;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Hashed groups for notes without one: about this many notes each. */
const HASHED_GROUP_SIZE = 50;
/** Neighbours sit this share of the link distance apart, give or take the jitter. */
const PITCH = 0.85;
/** Each note is nudged up to this share of the pitch off its slot, so no lattice shows. */
const JITTER = 0.3;

/** A point `slot` of `count` on a sunflower spiral filling a disc of radius 1, the first at the centre. */
function sunflower(slot: number, count: number): readonly [number, number] {
  const radius = Math.sqrt((slot + 0.5) / count);
  const angle = slot * GOLDEN_ANGLE;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/** The radius of a disc holding `count` sunflower points one pitch apart. */
const discRadius = (count: number) => Math.sqrt(count / Math.PI) * 1.05;
/** The radius of a ball holding `count` lattice points one pitch apart. */
const ballRadius = (count: number) => Math.cbrt((3 * count) / (4 * Math.PI)) + 0.5;

/**
 * The `count` cubic-lattice points nearest the origin, nearest first (in
 * pitch units): a ball whose neighbours sit exactly one pitch apart.
 */
function latticeBall(count: number): Float32Array {
  const reach = Math.ceil(ballRadius(count)) + 1;
  const points: Array<readonly [number, number, number, number]> = [];
  for (let x = -reach; x <= reach; x += 1)
    for (let y = -reach; y <= reach; y += 1)
      for (let z = -reach; z <= reach; z += 1) points.push([x * x + y * y + z * z, x, y, z]);
  // Nearest first; ties broken by coordinates so the order never varies.
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  const out = new Float32Array(count * 3);
  for (let slot = 0; slot < count; slot += 1) {
    const point = points[slot];
    out[slot * 3] = point?.[1] ?? 0;
    out[slot * 3 + 1] = point?.[2] ?? 0;
    out[slot * 3 + 2] = point?.[3] ?? 0;
  }
  return out;
}

export function proceduralLayout(
  universe: Universe,
  forces: LayoutForces,
  dimensions: 2 | 3,
): GraphLayout {
  const started = performance.now();
  const flat = dimensions === 2;
  const count = universe.nodes.length;
  const pitch = forces.linkDistance * PITCH;
  const hashedGroups = Math.max(1, Math.round(count / HASHED_GROUP_SIZE));
  const groups = new Map<string, Array<number>>();
  universe.nodes.forEach((node, index) => {
    const key = node.group ?? `#${Math.floor((seededPoint(node.id, 1)[0] + 0.5) * hashedGroups)}`;
    let members = groups.get(key);
    if (members === undefined) {
      members = [];
      groups.set(key, members);
    }
    members.push(index);
  });
  const degree = (index: number) => universe.index.degree.get(universe.nodes[index]?.id ?? "") ?? 0;
  // Largest groups first, and by name among equals, so the order never depends on insertion.
  const ordered = [...groups].toSorted(
    ([leftKey, left], [rightKey, right]) =>
      right.length - left.length || (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0),
  );
  const radiusOf = (members: number) => (flat ? discRadius(members) : ballRadius(members)) * pitch;
  // Group centres on a spiral of their own, far enough apart that the largest groups never touch.
  const gap = 2 * radiusOf(ordered[0]?.[1].length ?? 1) + 2 * pitch;
  const groupCount = ordered.length;
  const centres = flat ? null : latticeBall(groupCount);
  const positions = new Float32Array(count * 3);
  ordered.forEach(([, members], slot) => {
    const [cx, cy] = flat
      ? sunflower(slot, groupCount).map((value) => value * discRadius(groupCount) * gap)
      : [(centres?.[slot * 3] ?? 0) * gap, (centres?.[slot * 3 + 1] ?? 0) * gap];
    const cz = flat ? 0 : (centres?.[slot * 3 + 2] ?? 0) * gap;
    // Hubs first: the most-linked member at the centre, the least on the rim.
    const byDegree = members.toSorted(
      (left, right) => degree(right) - degree(left) || left - right,
    );
    const ball = flat ? null : latticeBall(byDegree.length);
    const disc = discRadius(byDegree.length);
    byDegree.forEach((index, rank) => {
      const [jx, jy, jz] = seededPoint(universe.nodes[index]?.id ?? "", pitch * JITTER);
      if (flat) {
        const [x, y] = sunflower(rank, byDegree.length);
        positions[index * 3] = (cx ?? 0) + x * disc * pitch + jx;
        positions[index * 3 + 1] = (cy ?? 0) + y * disc * pitch + jy;
        positions[index * 3 + 2] = 0;
        return;
      }
      positions[index * 3] = (cx ?? 0) + (ball?.[rank * 3] ?? 0) * pitch + jx;
      positions[index * 3 + 1] = (cy ?? 0) + (ball?.[rank * 3 + 1] ?? 0) * pitch + jy;
      positions[index * 3 + 2] = cz + (ball?.[rank * 3 + 2] ?? 0) * pitch + jz;
    });
  });
  const { center, radius } = boundsOf(positions);
  return {
    dimensions,
    positions,
    center,
    radius,
    spacing: medianNearestNeighbour(positions, count),
    ms: performance.now() - started,
  };
}
