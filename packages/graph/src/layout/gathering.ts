/**
 * The reading gathers its notes to the front: each note springs from its fixed home to its place in
 * a small force-solved cluster, and back home when it leaves. Notes already clustered start where
 * they stood and the cluster is pulled to its previous centre, so it grows instead of reshuffling.
 * Lengths are shares of the home spacing, so density holds at any memory size.
 */
import {
  forceCollide,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type Force3D,
  type SimulationNode3D,
} from "d3-force-3d";

export const GATHER_TICKS = 180;
/** Charge, as a share of the spacing squared. */
const CHARGE = -0.12;
/** Two notes keep their radii plus this share of the spacing apart. */
const COLLIDE_PAD = 0.5;
/** Linked notes are drawn to their radii plus this share of the spacing apart. */
const LINK_PAD = 1.0;
const LINK_RATE = 0.08;
const CENTRE_PULL = 0.06;
const ANCHOR_RATE = 0.2;
/** A group's region reaches this share of the spacing past its outermost child: the disc drawn is the disc packed. */
export const GROUP_PAD = 0.2;
/** Sibling groups' discs keep at least this share of the spacing between them. */
const GROUP_GAP = 0.25;
/** In a containment tree a level is small and its groups are large: charge would hold them far apart. */
const TREE_CHARGE = 0.15;
/** Overlap passes after a level settles: anchors can hold a grown group over its neighbour. */
const SEPARATE_PASSES = 60;
/** A level with more items than this skips the overlap passes (they are pairwise). */
const SEPARATE_LIMIT = 600;

export type Point = readonly [number, number, number];

export interface GatherInput {
  /** Home positions, x, y, z per node. */
  readonly homes: Float32Array;
  /** The notes the reading shows, by node index. */
  readonly members: ReadonlyArray<number>;
  /** The reading's visible links between members. */
  readonly links: ReadonlyArray<readonly [number, number]>;
  /** Each member's drawn radius. */
  readonly radius: (index: number) => number;
  /** The previous checkpoint's cluster, or null at the first. */
  readonly previous: Gathering | null;
  /** The home layout's spacing: every length here is a share of it. */
  readonly spacing: number;
  readonly dimensions: 2 | 3;
  /** Each note's container, by index, in a containment tree: a container's members gather as a group. */
  readonly parentOf?: Int32Array;
}

export interface Gathering {
  /** Each member's place in the cluster. */
  readonly positions: ReadonlyMap<number, Point>;
  readonly centre: Point;
}

interface GatherNode extends SimulationNode3D {
  /** The node's index in the universe (d3 owns `index`). */
  readonly node: number;
  readonly r: number;
  /** A group (a container's disc), which keeps only GROUP_GAP from its neighbours. */
  readonly group?: boolean;
}

const centroid = (points: Iterable<Point>): Point => {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
    z += point[2];
    count += 1;
  }
  return count === 0 ? [0, 0, 0] : [x / count, y / count, z / count];
};

const homeOf = (homes: Float32Array, index: number): Point => [
  homes[index * 3] ?? 0,
  homes[index * 3 + 1] ?? 0,
  homes[index * 3 + 2] ?? 0,
];

/**
 * The dictionary's link force: each tick, linked ends move a share of the way
 * toward sitting `r_a + r_b + pad` apart. Unlike d3's, it ignores alpha.
 */
function gatherLinks(
  nodes: ReadonlyArray<GatherNode>,
  links: ReadonlyArray<readonly [number, number]>,
  pad: number,
  groupGap: number,
): Force3D<GatherNode> {
  const force = () => {
    for (const [from, to] of links) {
      const a = nodes[from];
      const b = nodes[to];
      if (a === undefined || b === undefined) continue;
      const dx = (b.x ?? 0) - (a.x ?? 0);
      const dy = (b.y ?? 0) - (a.y ?? 0);
      const dz = (b.z ?? 0) - (a.z ?? 0);
      const length = Math.hypot(dx, dy, dz) || 1;
      // A group's disc already carries its pad: linked groups are drawn to touch at the group gap.
      const want = a.r + b.r + (a.group === true || b.group === true ? groupGap : pad);
      const k = ((length - want) / length) * LINK_RATE;
      a.x = (a.x ?? 0) + dx * k;
      a.y = (a.y ?? 0) + dy * k;
      b.x = (b.x ?? 0) - dx * k;
      b.y = (b.y ?? 0) - dy * k;
      if (a.z !== undefined && b.z !== undefined) {
        a.z += dz * k;
        b.z -= dz * k;
      }
    }
  };
  return force;
}

/**
 * Nodes already in the cluster hold their places: each tick they move a share
 * of the way back toward where they stood (their anchors), so the cluster
 * grows around them while new arrivals (no anchor) find room.
 */
function anchorTo(
  nodes: ReadonlyArray<GatherNode>,
  anchors: ReadonlyArray<Point | null>,
): Force3D<GatherNode> {
  return () => {
    nodes.forEach((node, slot) => {
      const anchor = anchors[slot];
      if (anchor === null || anchor === undefined) return;
      node.x = (node.x ?? 0) + (anchor[0] - (node.x ?? 0)) * ANCHOR_RATE;
      node.y = (node.y ?? 0) + (anchor[1] - (node.y ?? 0)) * ANCHOR_RATE;
      if (node.z !== undefined) node.z += (anchor[2] - node.z) * ANCHOR_RATE;
    });
  };
}

interface Level {
  readonly nodes: Array<GatherNode>;
  readonly links: ReadonlyArray<readonly [number, number]>;
  /** Where each node stood in the previous cluster (in the level's frame), or null for an arrival. */
  readonly anchors: ReadonlyArray<Point | null> | null;
  readonly centre: Point;
  /** Something stood here before: settle gently from where things are. */
  readonly settled: boolean;
  /** A level of a containment tree: its charge runs at TREE_CHARGE of a flat reading's. */
  readonly tree?: boolean;
}

/** Settle one level of nodes in place, every length a share of `spacing`. */
function settle(level: Level, spacing: number, dimensions: 2 | 3): void {
  const { nodes, centre } = level;
  const simulation = forceSimulation(nodes, dimensions)
    .stop()
    .force(
      "charge",
      forceManyBody<GatherNode>().strength(
        CHARGE * (level.tree === true ? TREE_CHARGE : 1) * spacing * spacing,
      ),
    )
    .force(
      "collide",
      forceCollide<GatherNode>(
        (node) => node.r + (node.group === true ? GROUP_GAP / 2 : COLLIDE_PAD) * spacing,
      ).iterations(4),
    )
    .force("x", forceX<GatherNode>(centre[0]).strength(CENTRE_PULL))
    .force("y", forceY<GatherNode>(centre[1]).strength(CENTRE_PULL))
    .force(
      "link",
      level.links.length > 0
        ? gatherLinks(nodes, level.links, LINK_PAD * spacing, GROUP_GAP * spacing)
        : null,
    );
  if (dimensions === 3) simulation.force("z", forceZ<GatherNode>(centre[2]).strength(CENTRE_PULL));
  if (level.anchors !== null) simulation.force("anchor", anchorTo(nodes, level.anchors));
  simulation.alpha(level.settled ? 0.1 : 1);
  simulation.tick(GATHER_TICKS);
}

/**
 * Push apart any two items closer than their radii plus `gap`, half each,
 * until none are or the passes run out. The force solve settles most of a
 * level; this makes sure a group anchored where it stood, but grown since,
 * does not sit over its neighbour.
 */
function separate(nodes: ReadonlyArray<GatherNode>, gap: number, dimensions: 2 | 3): void {
  if (nodes.length < 2 || nodes.length > SEPARATE_LIMIT) return;
  for (let pass = 0; pass < SEPARATE_PASSES; pass += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (b === undefined) continue;
        let dx = (b.x ?? 0) - (a.x ?? 0);
        let dy = (b.y ?? 0) - (a.y ?? 0);
        let dz = dimensions === 3 ? (b.z ?? 0) - (a.z ?? 0) : 0;
        const want = a.r + b.r + gap;
        let length = Math.hypot(dx, dy, dz);
        if (length >= want) continue;
        if (length < 1e-9) {
          // Coincident: part them along a direction fixed by their order.
          const angle = (i * 7 + j * 13) % 360;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dz = 0;
          length = 1;
        }
        const push = (want - length) / length / 2;
        a.x = (a.x ?? 0) - dx * push;
        a.y = (a.y ?? 0) - dy * push;
        b.x = (b.x ?? 0) + dx * push;
        b.y = (b.y ?? 0) + dy * push;
        if (dimensions === 3) {
          a.z = (a.z ?? 0) - dz * push;
          b.z = (b.z ?? 0) + dz * push;
        }
        moved = true;
      }
    }
    if (!moved) return;
  }
}

/** Pairs of item positions in `items`, from pairs of note indices. */
function pairsIn(
  items: ReadonlyArray<number>,
  links: ReadonlyArray<readonly [number, number]>,
): Array<readonly [number, number]> {
  const slot = new Map(items.map((index, at) => [index, at]));
  const pairs: Array<readonly [number, number]> = [];
  for (const [a, b] of links) {
    const left = slot.get(a);
    const right = slot.get(b);
    if (left !== undefined && right !== undefined) pairs.push([left, right]);
  }
  return pairs;
}

/** Gather the members into a cluster; synchronous and deterministic. */
export function gather(input: GatherInput): Gathering {
  const members = [...new Set(input.members)].toSorted((left, right) => left - right);
  const previous = input.previous;
  const centre =
    previous !== null && previous.positions.size > 0
      ? centroid(previous.positions.values())
      : centroid(members.map((index) => homeOf(input.homes, index)));
  if (members.length === 0) return { positions: new Map(), centre };
  const { parentOf } = input;
  if (parentOf !== undefined && members.some((index) => (parentOf[index] ?? -1) >= 0)) {
    return gatherTree(input, members, parentOf, centre);
  }
  const flat = input.dimensions === 2;
  const nodes: Array<GatherNode> = members.map((index) => {
    const [x, y, z] = previous?.positions.get(index) ?? homeOf(input.homes, index);
    const r = input.radius(index);
    return flat ? { node: index, r, x, y } : { node: index, r, x, y, z };
  });
  settle(
    {
      nodes,
      links: pairsIn(members, input.links),
      anchors:
        previous === null ? null : members.map((index) => previous.positions.get(index) ?? null),
      centre,
      settled: previous !== null,
    },
    input.spacing,
    input.dimensions,
  );
  const positions = new Map<number, Point>();
  for (const node of nodes) {
    positions.set(node.node, [node.x ?? 0, node.y ?? 0, flat ? 0 : (node.z ?? 0)]);
  }
  return { positions, centre };
}

/**
 * Bottom up, each group's children pack around its middle, starting where they stood last (else
 * where their homes put them), and fill the group's radius. Then the top level gathers like a flat
 * reading, and each member lands at its groups' places plus its own.
 */
function gatherTree(
  input: GatherInput,
  members: ReadonlyArray<number>,
  parentOf: Int32Array,
  centre: Point,
): Gathering {
  const { previous, spacing, dimensions } = input;
  const flat = dimensions === 2;
  const memberSet = new Set(members);
  const children = new Map<number, Array<number>>();
  const top: Array<number> = [];
  const seen = new Set<number>();
  const enlist = (index: number) => {
    if (seen.has(index)) return;
    seen.add(index);
    const parent = parentOf[index] ?? -1;
    if (parent < 0) {
      top.push(index);
      return;
    }
    const list = children.get(parent) ?? [];
    list.push(index);
    children.set(parent, list);
    enlist(parent);
  };
  for (const index of members) enlist(index);
  // Where each item stood before: a member at its place, a group at its members' middle.
  const before = new Map<number, Point | null>();
  const standing = (index: number): Point | null => {
    if (previous === null) return null;
    const known = before.get(index);
    if (known !== undefined) return known;
    const own = memberSet.has(index) ? (previous.positions.get(index) ?? null) : null;
    const inner = (children.get(index) ?? [])
      .map(standing)
      .filter((point): point is Point => point !== null);
    const place = own ?? (inner.length > 0 ? centroid(inner) : null);
    before.set(index, place);
    return place;
  };
  const home = (index: number): Point => standing(index) ?? homeOf(input.homes, index);
  const levels = siblingPairs(parentOf, input.links);
  const packed = new Map<
    number,
    { readonly places: Map<number, Point>; readonly radius: number }
  >();
  const radiusOf = (index: number) =>
    packed.get(index)?.radius ?? (memberSet.has(index) ? input.radius(index) : 0);

  const packGroup = (group: number) => {
    const items = (children.get(group) ?? []).toSorted((left, right) => left - right);
    for (const item of items) if (children.has(item)) packGroup(item);
    // Each item starts where it stood relative to the group, else where its home is relative to the group's home.
    const was = standing(group);
    const groupHome = homeOf(input.homes, group);
    const relativeTo = (index: number): { at: Point; stood: boolean } => {
      const stood = standing(index);
      if (stood !== null && was !== null) {
        return { at: [stood[0] - was[0], stood[1] - was[1], stood[2] - was[2]], stood: true };
      }
      const own = homeOf(input.homes, index);
      return {
        at: [own[0] - groupHome[0], own[1] - groupHome[1], own[2] - groupHome[2]],
        stood: false,
      };
    };
    const starts = items.map(relativeTo);
    const nodes: Array<GatherNode> = items.map((index, at) => {
      const [x, y, z] = starts[at]?.at ?? [0, 0, 0];
      const r = radiusOf(index);
      const group = children.has(index);
      return flat ? { node: index, r, group, x, y } : { node: index, r, group, x, y, z };
    });
    const anchors = starts.map((start) => (start.stood ? start.at : null));
    settle(
      {
        nodes,
        links: pairsIn(items, levels.get(group) ?? []),
        anchors,
        centre: [0, 0, 0],
        settled: anchors.some((at) => at !== null),
        tree: true,
      },
      spacing,
      dimensions,
    );
    if (items.some((index) => children.has(index)))
      separate(nodes, GROUP_GAP * spacing, dimensions);
    const mid = centroid(nodes.map((node): Point => [node.x ?? 0, node.y ?? 0, node.z ?? 0]));
    const places = new Map<number, Point>();
    let extent = 0;
    for (const node of nodes) {
      const place: Point = [
        (node.x ?? 0) - mid[0],
        (node.y ?? 0) - mid[1],
        flat ? 0 : (node.z ?? 0) - mid[2],
      ];
      places.set(node.node, place);
      extent = Math.max(extent, Math.hypot(place[0], place[1], place[2]) + node.r);
    }
    packed.set(group, { places, radius: extent + GROUP_PAD * spacing });
  };
  for (const index of top) if (children.has(index)) packGroup(index);

  // The top level gathers as a flat reading would.
  const topItems = top.toSorted((left, right) => left - right);
  const nodes: Array<GatherNode> = topItems.map((index) => {
    const [x, y, z] = home(index);
    const r = radiusOf(index);
    const group = children.has(index);
    return flat ? { node: index, r, group, x, y } : { node: index, r, group, x, y, z };
  });
  settle(
    {
      nodes,
      links: pairsIn(topItems, levels.get(-1) ?? []),
      anchors: previous === null ? null : topItems.map(standing),
      centre,
      settled: previous !== null,
      tree: true,
    },
    spacing,
    dimensions,
  );
  if (topItems.some((index) => children.has(index)))
    separate(nodes, GROUP_GAP * spacing, dimensions);
  const positions = new Map<number, Point>();
  const place = (index: number, x: number, y: number, z: number) => {
    if (memberSet.has(index)) positions.set(index, [x, y, flat ? 0 : z]);
    const inner = packed.get(index);
    if (inner === undefined) return;
    for (const [child, at] of inner.places) place(child, x + at[0], y + at[1], z + at[2]);
  };
  for (const node of nodes) place(node.node, node.x ?? 0, node.y ?? 0, node.z ?? 0);
  return { positions, centre };
}

/** The links between siblings in the gathering, per group (-1 for the top), each pair once. */
function siblingPairs(
  parentOf: Int32Array,
  links: ReadonlyArray<readonly [number, number]>,
): Map<number, Array<readonly [number, number]>> {
  const chain = (index: number) => {
    const up: Array<number> = [];
    for (let at = index; at >= 0; at = parentOf[at] ?? -1) up.push(at);
    return up.toReversed();
  };
  const seen = new Set<string>();
  const levels = new Map<number, Array<readonly [number, number]>>();
  for (const [from, to] of links) {
    const a = chain(from);
    const b = chain(to);
    let depth = 0;
    while (depth < a.length && depth < b.length && a[depth] === b[depth]) depth += 1;
    const left = a[depth];
    const right = b[depth];
    if (left === undefined || right === undefined) continue;
    const key = left < right ? `${left}:${right}` : `${right}:${left}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = depth === 0 ? -1 : (a[depth - 1] ?? -1);
    const level = levels.get(group) ?? [];
    level.push([left, right]);
    levels.set(group, level);
  }
  return levels;
}

/** Offsets from home to cluster, the springs' targets; a note not in the cluster goes home. */
export function gatheringOffset(
  gathering: Gathering | null,
  homes: Float32Array,
  index: number,
): Point {
  const place = gathering?.positions.get(index);
  if (place === undefined) return [0, 0, 0];
  const [x, y, z] = homeOf(homes, index);
  return [place[0] - x, place[1] - y, place[2] - z];
}
