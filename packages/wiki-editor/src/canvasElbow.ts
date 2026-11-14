// Ported from Excalidraw's elbow arrows (packages/element/src/elbowArrow.ts, heading.ts and
// shape.ts, packages/common/src/binary-heap.ts), MIT License, Copyright (c) 2020 Excalidraw.
// Adapted to plain boxes, and extended to step around cards between the two ends.
import type { CanvasBounds, CanvasSide } from "@mercurian/wiki/canvas";

type Point = readonly [number, number];
type Bounds = readonly [minX: number, minY: number, maxX: number, maxY: number];
type Heading = readonly [1, 0] | readonly [0, 1] | readonly [-1, 0] | readonly [0, -1];

const HEADING_RIGHT: Heading = [1, 0];
const HEADING_DOWN: Heading = [0, 1];
const HEADING_LEFT: Heading = [-1, 0];
const HEADING_UP: Heading = [0, -1];

const SIDE_HEADING: Readonly<Record<CanvasSide, Heading>> = {
  top: HEADING_UP,
  right: HEADING_RIGHT,
  bottom: HEADING_DOWN,
  left: HEADING_LEFT,
};

/** One end of an elbow: where it is, and the card it's on and which side, if any. */
export interface CanvasElbowEnd {
  readonly x: number;
  readonly y: number;
  readonly box?: CanvasBounds;
  readonly side?: CanvasSide;
  readonly head: boolean;
}

const BASE_PADDING = 40;
const BINDING_GAP = 5;
const DEDUP_THRESHOLD = 1;
/** The board's arrowhead, where Excalidraw's is 25. */
const ARROWHEAD_SIZE = 12;
export const CANVAS_ELBOW_CORNER_RADIUS = 16;
/** Room kept round a card the route steps around. */
const OBSTACLE_PADDING = BASE_PADDING / 2;

const vectorToHeading = (x: number, y: number): Heading => {
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (x > absY) return HEADING_RIGHT;
  if (x <= -absY) return HEADING_LEFT;
  if (y > absX) return HEADING_DOWN;
  return HEADING_UP;
};

const compareHeading = (a: Heading, b: Heading) => a[0] === b[0] && a[1] === b[1];
const headingIsHorizontal = (a: Heading) =>
  compareHeading(a, HEADING_RIGHT) || compareHeading(a, HEADING_LEFT);
const flipHeading = (h: Heading): Heading =>
  [h[0] === 0 ? 0 : h[0] > 0 ? -1 : 1, h[1] === 0 ? 0 : h[1] > 0 ? -1 : 1] as unknown as Heading;

const pointInsideBounds = (p: Point, b: Bounds) =>
  p[0] > b[0] && p[0] < b[2] && p[1] > b[1] && p[1] < b[3];
const doBoundsIntersect = (a: Bounds, b: Bounds) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const commonAABB = (aabbs: ReadonlyArray<Bounds>): Bounds => [
  Math.min(...aabbs.map((aabb) => aabb[0])),
  Math.min(...aabbs.map((aabb) => aabb[1])),
  Math.max(...aabbs.map((aabb) => aabb[2])),
  Math.max(...aabbs.map((aabb) => aabb[3])),
];
const vectorCross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
const m_dist = (a: Point, b: Point) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const pointDistance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const boundsOf = (box: CanvasBounds): Bounds => [
  box.x,
  box.y,
  box.x + box.width,
  box.y + box.height,
];
/** `offset` is up, right, down and left. */
const padded = (b: Bounds, [up, right, down, left]: readonly number[]): Bounds => [
  b[0] - left!,
  b[1] - up!,
  b[2] + right!,
  b[3] + down!,
];

const offsetFromHeading = (heading: Heading, head: number, side: number) => {
  if (heading === HEADING_UP) return [head, side, side, side];
  if (heading === HEADING_RIGHT) return [side, head, side, side];
  if (heading === HEADING_DOWN) return [side, side, head, side];
  return [side, side, side, head];
};

class BinaryHeap<T> {
  readonly #content: T[] = [];
  readonly #score: (node: T) => number;

  constructor(score: (node: T) => number) {
    this.#score = score;
  }

  #sinkDown(start: number) {
    let idx = start;
    const node = this.#content[idx]!;
    const nodeScore = this.#score(node);
    while (idx > 0) {
      const parentN = ((idx + 1) >> 1) - 1;
      const parent = this.#content[parentN]!;
      if (nodeScore >= this.#score(parent)) break;
      this.#content[idx] = parent;
      idx = parentN;
    }
    this.#content[idx] = node;
  }

  #bubbleUp(start: number) {
    let idx = start;
    const length = this.#content.length;
    const node = this.#content[idx]!;
    const score = this.#score(node);
    while (true) {
      const child1N = ((idx + 1) << 1) - 1;
      const child2N = child1N + 1;
      let smallestIdx = idx;
      let smallestScore = score;
      if (child1N < length) {
        const child1Score = this.#score(this.#content[child1N]!);
        if (child1Score < smallestScore) {
          smallestIdx = child1N;
          smallestScore = child1Score;
        }
      }
      if (child2N < length && this.#score(this.#content[child2N]!) < smallestScore) {
        smallestIdx = child2N;
      }
      if (smallestIdx === idx) break;
      this.#content[idx] = this.#content[smallestIdx]!;
      idx = smallestIdx;
    }
    this.#content[idx] = node;
  }

  push(node: T) {
    this.#content.push(node);
    this.#sinkDown(this.#content.length - 1);
  }

  pop(): T | undefined {
    const result = this.#content[0];
    const end = this.#content.pop();
    if (this.#content.length > 0 && end !== undefined) {
      this.#content[0] = end;
      this.#bubbleUp(0);
    }
    return result;
  }

  size() {
    return this.#content.length;
  }

  rescore(node: T) {
    this.#sinkDown(this.#content.indexOf(node));
  }
}

interface Node {
  f: number;
  g: number;
  h: number;
  closed: boolean;
  visited: boolean;
  parent: Node | null;
  readonly col: number;
  readonly row: number;
  readonly pos: Point;
}

interface Grid {
  readonly row: number;
  readonly col: number;
  readonly data: ReadonlyArray<Node>;
}

interface ElbowData {
  readonly dynamicAABBs: readonly [Bounds, Bounds];
  readonly startDonglePosition: Point;
  readonly startGlobalPoint: Point;
  readonly startHeading: Heading;
  readonly endDonglePosition: Point;
  readonly endGlobalPoint: Point;
  readonly endHeading: Heading;
  readonly commonBounds: Bounds;
}

const headingOf = (end: CanvasElbowEnd, other: Point): Heading =>
  end.side !== undefined && end.box !== undefined
    ? SIDE_HEADING[end.side]
    : vectorToHeading(other[0] - end.x, other[1] - end.y);

function elbowData(start: CanvasElbowEnd, end: CanvasElbowEnd): ElbowData {
  const startGlobalPoint: Point = [start.x, start.y];
  const endGlobalPoint: Point = [end.x, end.y];
  const startHeading = headingOf(start, endGlobalPoint);
  const endHeading = headingOf(end, startGlobalPoint);
  const startBox = start.box === undefined ? undefined : boundsOf(start.box);
  const endBox = end.box === undefined ? undefined : boundsOf(end.box);
  const startPointBounds: Bounds = [start.x - 2, start.y - 2, start.x + 2, start.y + 2];
  const endPointBounds: Bounds = [end.x - 2, end.y - 2, end.x + 2, end.y + 2];
  const startGap = start.head ? BINDING_GAP * 6 : BINDING_GAP * 2;
  const endGap = end.head ? BINDING_GAP * 6 : BINDING_GAP * 2;
  const startElementBounds =
    startBox === undefined
      ? startPointBounds
      : padded(startBox, offsetFromHeading(startHeading, startGap, 1));
  const endElementBounds =
    endBox === undefined
      ? endPointBounds
      : padded(endBox, offsetFromHeading(endHeading, endGap, 1));
  const boundsOverlap =
    pointInsideBounds(
      startGlobalPoint,
      endBox === undefined
        ? endPointBounds
        : padded(endBox, offsetFromHeading(endHeading, BASE_PADDING, BASE_PADDING)),
    ) ||
    pointInsideBounds(
      endGlobalPoint,
      startBox === undefined
        ? startPointBounds
        : padded(startBox, offsetFromHeading(startHeading, BASE_PADDING, BASE_PADDING)),
    );
  const commonBounds = commonAABB(
    boundsOverlap ? [startPointBounds, endPointBounds] : [startElementBounds, endElementBounds],
  );
  const bound = startBox !== undefined || endBox !== undefined;
  const dynamicAABBs = generateDynamicAABBs(
    boundsOverlap ? startPointBounds : startElementBounds,
    boundsOverlap ? endPointBounds : endElementBounds,
    commonBounds,
    boundsOverlap
      ? offsetFromHeading(startHeading, bound ? BASE_PADDING : 0, 0)
      : offsetFromHeading(startHeading, bound ? BASE_PADDING - startGap : 0, BASE_PADDING),
    boundsOverlap
      ? offsetFromHeading(endHeading, bound ? BASE_PADDING : 0, 0)
      : offsetFromHeading(endHeading, bound ? BASE_PADDING - endGap : 0, BASE_PADDING),
    boundsOverlap,
    startBox,
    endBox,
  );
  return {
    dynamicAABBs,
    startDonglePosition: getDonglePosition(dynamicAABBs[0], startHeading, startGlobalPoint),
    startGlobalPoint,
    startHeading,
    endDonglePosition: getDonglePosition(dynamicAABBs[1], endHeading, endGlobalPoint),
    endGlobalPoint,
    endHeading,
    commonBounds,
  };
}

/** Whether an axis-aligned segment passes through `bounds`. */
const segmentCrossesBounds = (a: Point, b: Point, bounds: Bounds) =>
  doBoundsIntersect(
    [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    bounds,
  );

/**
 * The route between two cards with one corner (leaving one and entering the other at a right
 * angle) or two (leaving and entering heading the same way), if it fits clear of both.
 */
function getSimpleRoute(
  start: CanvasElbowEnd,
  end: CanvasElbowEnd,
  { startHeading, endHeading, startGlobalPoint, endGlobalPoint }: ElbowData,
): Point[] | null {
  const oneCorner = headingIsHorizontal(startHeading) !== headingIsHorizontal(endHeading);
  if (
    start.box === undefined ||
    end.box === undefined ||
    start.box === end.box ||
    (!oneCorner && !compareHeading(startHeading, flipHeading(endHeading)))
  ) {
    return null;
  }
  const ahead =
    (endGlobalPoint[0] - startGlobalPoint[0]) * startHeading[0] +
    (endGlobalPoint[1] - startGlobalPoint[1]) * startHeading[1];
  let firstLeg: number;
  let lastLeg: number;
  if (oneCorner) {
    firstLeg = ahead;
    lastLeg =
      (startGlobalPoint[0] - endGlobalPoint[0]) * endHeading[0] +
      (startGlobalPoint[1] - endGlobalPoint[1]) * endHeading[1];
  } else {
    firstLeg = ahead / 2;
    if (start.head !== end.head) {
      const arrowheadLeg = Math.max(
        ahead / 2,
        Math.min(BASE_PADDING, ahead - CANVAS_ELBOW_CORNER_RADIUS * 2),
      );
      firstLeg = start.head ? arrowheadLeg : ahead - arrowheadLeg;
    }
    lastLeg = ahead - firstLeg;
  }
  if (
    firstLeg <= Math.max(CANVAS_ELBOW_CORNER_RADIUS / 2, start.head ? ARROWHEAD_SIZE : 0) ||
    lastLeg <= Math.max(CANVAS_ELBOW_CORNER_RADIUS / 2, end.head ? ARROWHEAD_SIZE : 0)
  ) {
    return null;
  }
  const firstTurn: Point = [
    startGlobalPoint[0] + startHeading[0] * firstLeg,
    startGlobalPoint[1] + startHeading[1] * firstLeg,
  ];
  const lastTurn: Point = [
    endGlobalPoint[0] + endHeading[0] * lastLeg,
    endGlobalPoint[1] + endHeading[1] * lastLeg,
  ];
  const gap = [BINDING_GAP, BINDING_GAP, BINDING_GAP, BINDING_GAP];
  const startBounds = padded(boundsOf(start.box), gap);
  const endBounds = padded(boundsOf(end.box), gap);
  if (
    segmentCrossesBounds(startGlobalPoint, firstTurn, endBounds) ||
    segmentCrossesBounds(firstTurn, lastTurn, startBounds) ||
    segmentCrossesBounds(firstTurn, lastTurn, endBounds) ||
    segmentCrossesBounds(lastTurn, endGlobalPoint, startBounds)
  ) {
    return null;
  }
  return [startGlobalPoint, firstTurn, lastTurn, endGlobalPoint];
}

/** The route on the grid, keeping a padding around the cards it connects, or null if there's none. */
function getElbowArrowGridRoute(
  start: CanvasElbowEnd,
  end: CanvasElbowEnd,
  data: ElbowData,
): Point[] | null {
  const {
    dynamicAABBs,
    startDonglePosition,
    startGlobalPoint,
    startHeading,
    endDonglePosition,
    endGlobalPoint,
    endHeading,
    commonBounds,
  } = data;
  const grid = calculateGrid(
    dynamicAABBs,
    startDonglePosition,
    startHeading,
    endDonglePosition,
    endHeading,
    commonBounds,
    [],
  );
  const startDongle = pointToGridNode(startDonglePosition, grid);
  const endDongle = pointToGridNode(endDonglePosition, grid);
  const endNode = pointToGridNode(endGlobalPoint, grid);
  if (endNode !== null && end.box !== undefined) endNode.closed = true;
  const startNode = pointToGridNode(startGlobalPoint, grid);
  if (startNode !== null && start.box !== undefined) startNode.closed = true;
  const dongleOverlap =
    startDongle !== null &&
    endDongle !== null &&
    (pointInsideBounds(startDongle.pos, dynamicAABBs[1]) ||
      pointInsideBounds(endDongle.pos, dynamicAABBs[0]));
  const from = startDongle ?? startNode;
  const to = endDongle ?? endNode;
  if (from === null || to === null) return null;
  const path = astar(from, to, grid, startHeading, endHeading, dongleOverlap ? [] : dynamicAABBs);
  if (path === null) return null;
  const points = path.map((node) => node.pos);
  if (startDongle !== null) points.unshift(startGlobalPoint);
  if (endDongle !== null) points.push(endGlobalPoint);
  return points;
}

/**
 * Not Excalidraw's: a route that keeps clear of `obstacles` too, on a grid of every box's edges,
 * each card padded alike. Excalidraw's own route only knows the two cards it joins.
 */
function getObstacleRoute(
  start: CanvasElbowEnd,
  end: CanvasElbowEnd,
  { startGlobalPoint, endGlobalPoint, startHeading, endHeading }: ElbowData,
  obstacles: ReadonlyArray<Bounds>,
): Point[] | null {
  const pad = [OBSTACLE_PADDING, OBSTACLE_PADDING, OBSTACLE_PADDING, OBSTACLE_PADDING];
  const ends = [start, end].map((each, at) => {
    const point = at === 0 ? startGlobalPoint : endGlobalPoint;
    const heading = at === 0 ? startHeading : endHeading;
    if (each.box === undefined) return { blocker: null, dongle: point };
    const blocker = padded(boundsOf(each.box), pad);
    const dongle = getDonglePosition(blocker, heading, point);
    return { blocker, dongle };
  });
  const [first, last] = ends as [(typeof ends)[0], (typeof ends)[0]];
  const blockers = [
    ...obstacles.map((box) => padded(box, pad)),
    ...(first.blocker === null ? [] : [first.blocker]),
    ...(last.blocker === null ? [] : [last.blocker]),
  ];
  // A dongle inside a card's room can't leave it: this route isn't for here.
  const blocked = (point: Point) => blockers.some((each) => pointInsideBounds(point, each));
  if (blocked(first.dongle) || blocked(last.dongle)) return null;
  const ring = padded(
    commonAABB([
      ...blockers,
      [first.dongle[0], first.dongle[1], first.dongle[0], first.dongle[1]],
      [last.dongle[0], last.dongle[1], last.dongle[0], last.dongle[1]],
    ]),
    pad,
  );
  const middle: Point = [
    (first.dongle[0] + last.dongle[0]) / 2,
    (first.dongle[1] + last.dongle[1]) / 2,
  ];
  const grid = calculateGrid(blockers, first.dongle, startHeading, last.dongle, endHeading, ring, [
    middle,
  ]);
  const from = pointToGridNode(first.dongle, grid);
  const to = pointToGridNode(last.dongle, grid);
  if (from === null || to === null) return null;
  const path = astar(from, to, grid, startHeading, endHeading, blockers);
  if (path === null) return null;
  const points = path.map((node) => node.pos);
  if (first.blocker !== null) points.unshift(startGlobalPoint);
  if (last.blocker !== null) points.push(endGlobalPoint);
  return points;
}

const crossesAny = (points: ReadonlyArray<Point>, obstacles: ReadonlyArray<Bounds>) => {
  for (let at = 1; at < points.length; at++) {
    for (const box of obstacles) {
      if (segmentCrossesBounds(points[at - 1]!, points[at]!, box)) return true;
    }
  }
  return false;
};

/**
 * An elbow arrow's corners, ends included: with one or two corners if that fits, or on the grid,
 * and stepping round `obstacles`, the other cards near it, when Excalidraw's route would cross one.
 */
export function canvasElbowRoute(
  start: CanvasElbowEnd,
  end: CanvasElbowEnd,
  obstacles: ReadonlyArray<CanvasBounds> = [],
): Array<{ readonly x: number; readonly y: number }> {
  const data = elbowData(start, end);
  const route = getSimpleRoute(start, end, data) ?? getElbowArrowGridRoute(start, end, data) ?? [];
  const boxes = obstacles.map(boundsOf);
  const around =
    boxes.length > 0 && crossesAny(route, boxes) ? getObstacleRoute(start, end, data, boxes) : null;
  const points = getElbowArrowCornerPoints(removeElbowArrowShortSegments(around ?? route));
  if (points.length < 2) return [start, end].map(({ x, y }) => ({ x, y }));
  return points.map(([x, y]) => ({ x, y }));
}

/**
 * Routing based on the A* path search algorithm. A turn is penalised by a constant, and a segment
 * may not go back over the one before it.
 */
function astar(
  start: Node,
  end: Node,
  grid: Grid,
  startHeading: Heading,
  endHeading: Heading,
  aabbs: ReadonlyArray<Bounds>,
): Node[] | null {
  const bendMultiplier = m_dist(start.pos, end.pos);
  const open = new BinaryHeap<Node>((node) => node.f);
  open.push(start);
  while (open.size() > 0) {
    const current = open.pop();
    if (current === undefined || current.closed) continue;
    if (current === end) return pathTo(start, current);
    current.closed = true;
    const neighbors = getNeighbors(current, grid);
    for (let i = 0; i < 4; i++) {
      const neighbor = neighbors[i];
      if (neighbor === null || neighbor === undefined || neighbor.closed) continue;
      const half: Point = [
        (neighbor.pos[0] + current.pos[0]) / 2,
        (neighbor.pos[1] + current.pos[1]) / 2,
      ];
      let inside = false;
      for (const aabb of aabbs) {
        if (pointInsideBounds(half, aabb)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      const neighborHeading = neighborIndexToHeading(i);
      const previousDirection =
        current.parent === null
          ? startHeading
          : vectorToHeading(
              current.pos[0] - current.parent.pos[0],
              current.pos[1] - current.parent.pos[1],
            );
      const reverseHeading = flipHeading(previousDirection);
      if (
        compareHeading(reverseHeading, neighborHeading) ||
        (start.col === neighbor.col &&
          start.row === neighbor.row &&
          compareHeading(neighborHeading, startHeading)) ||
        (end.col === neighbor.col &&
          end.row === neighbor.row &&
          compareHeading(neighborHeading, endHeading))
      ) {
        continue;
      }
      const directionChange = !compareHeading(previousDirection, neighborHeading);
      const gScore =
        current.g +
        m_dist(neighbor.pos, current.pos) +
        (directionChange ? Math.pow(bendMultiplier, 3) : 0);
      const beenVisited = neighbor.visited;
      if (!beenVisited || gScore < neighbor.g) {
        const estBendCount = estimateSegmentCount(neighbor, end, neighborHeading, endHeading);
        neighbor.visited = true;
        neighbor.parent = current;
        neighbor.h = m_dist(end.pos, neighbor.pos) + estBendCount * Math.pow(bendMultiplier, 2);
        neighbor.g = gScore;
        neighbor.f = neighbor.g + neighbor.h;
        if (beenVisited) open.rescore(neighbor);
        else open.push(neighbor);
      }
    }
  }
  return null;
}

function pathTo(start: Node, node: Node) {
  let curr = node;
  const path: Node[] = [];
  while (curr.parent !== null) {
    path.unshift(curr);
    curr = curr.parent;
  }
  path.unshift(start);
  return path;
}

/** Dynamically resizing, always touching boxes, at least as large as the given ones. */
function generateDynamicAABBs(
  a: Bounds,
  b: Bounds,
  common: Bounds,
  startDifference: readonly number[],
  endDifference: readonly number[],
  disableSideHack: boolean,
  startElementBounds: Bounds | undefined,
  endElementBounds: Bounds | undefined,
): readonly [Bounds, Bounds] {
  const startEl = startElementBounds ?? a;
  const endEl = endElementBounds ?? b;
  const [startUp = 0, startRight = 0, startDown = 0, startLeft = 0] = startDifference;
  const [endUp = 0, endRight = 0, endDown = 0, endLeft = 0] = endDifference;

  const first: Bounds = [
    a[0] > b[2]
      ? a[1] > b[3] || a[3] < b[1]
        ? Math.min((startEl[0] + endEl[2]) / 2, a[0] - startLeft)
        : (startEl[0] + endEl[2]) / 2
      : a[0] > b[0]
        ? a[0] - startLeft
        : common[0] - startLeft,
    a[1] > b[3]
      ? a[0] > b[2] || a[2] < b[0]
        ? Math.min((startEl[1] + endEl[3]) / 2, a[1] - startUp)
        : (startEl[1] + endEl[3]) / 2
      : a[1] > b[1]
        ? a[1] - startUp
        : common[1] - startUp,
    a[2] < b[0]
      ? a[1] > b[3] || a[3] < b[1]
        ? Math.max((startEl[2] + endEl[0]) / 2, a[2] + startRight)
        : (startEl[2] + endEl[0]) / 2
      : a[2] < b[2]
        ? a[2] + startRight
        : common[2] + startRight,
    a[3] < b[1]
      ? a[0] > b[2] || a[2] < b[0]
        ? Math.max((startEl[3] + endEl[1]) / 2, a[3] + startDown)
        : (startEl[3] + endEl[1]) / 2
      : a[3] < b[3]
        ? a[3] + startDown
        : common[3] + startDown,
  ];
  const second: Bounds = [
    b[0] > a[2]
      ? b[1] > a[3] || b[3] < a[1]
        ? Math.min((endEl[0] + startEl[2]) / 2, b[0] - endLeft)
        : (endEl[0] + startEl[2]) / 2
      : b[0] > a[0]
        ? b[0] - endLeft
        : common[0] - endLeft,
    b[1] > a[3]
      ? b[0] > a[2] || b[2] < a[0]
        ? Math.min((endEl[1] + startEl[3]) / 2, b[1] - endUp)
        : (endEl[1] + startEl[3]) / 2
      : b[1] > a[1]
        ? b[1] - endUp
        : common[1] - endUp,
    b[2] < a[0]
      ? b[1] > a[3] || b[3] < a[1]
        ? Math.max((endEl[2] + startEl[0]) / 2, b[2] + endRight)
        : (endEl[2] + startEl[0]) / 2
      : b[2] < a[2]
        ? b[2] + endRight
        : common[2] + endRight,
    b[3] < a[1]
      ? b[0] > a[2] || b[2] < a[0]
        ? Math.max((endEl[3] + startEl[1]) / 2, b[3] + endDown)
        : (endEl[3] + startEl[1]) / 2
      : b[3] < a[3]
        ? b[3] + endDown
        : common[3] + endDown,
  ];

  const c = commonAABB([first, second]);
  if (
    !disableSideHack &&
    first[2] - first[0] + second[2] - second[0] > c[2] - c[0] + 0.00000000001 &&
    first[3] - first[1] + second[3] - second[1] > c[3] - c[1] + 0.00000000001
  ) {
    const endCenterX = (second[0] + second[2]) / 2;
    const endCenterY = (second[1] + second[3]) / 2;
    if (b[0] > a[2] && a[1] > b[3]) {
      // Bottom left.
      const cX = first[2] + (second[0] - first[2]) / 2;
      const cY = second[3] + (first[1] - second[3]) / 2;
      if (
        vectorCross(a[2] - endCenterX, a[1] - endCenterY, a[0] - endCenterX, a[3] - endCenterY) > 0
      ) {
        return [
          [first[0], first[1], cX, first[3]],
          [cX, second[1], second[2], second[3]],
        ];
      }
      return [
        [first[0], cY, first[2], first[3]],
        [second[0], second[1], second[2], cY],
      ];
    } else if (a[2] < b[0] && a[3] < b[1]) {
      // Top left.
      const cX = first[2] + (second[0] - first[2]) / 2;
      const cY = first[3] + (second[1] - first[3]) / 2;
      if (
        vectorCross(a[0] - endCenterX, a[1] - endCenterY, a[2] - endCenterX, a[3] - endCenterY) > 0
      ) {
        return [
          [first[0], first[1], first[2], cY],
          [second[0], cY, second[2], second[3]],
        ];
      }
      return [
        [first[0], first[1], cX, first[3]],
        [cX, second[1], second[2], second[3]],
      ];
    } else if (a[0] > b[2] && a[3] < b[1]) {
      // Top right.
      const cX = second[2] + (first[0] - second[2]) / 2;
      const cY = first[3] + (second[1] - first[3]) / 2;
      if (
        vectorCross(a[2] - endCenterX, a[1] - endCenterY, a[0] - endCenterX, a[3] - endCenterY) > 0
      ) {
        return [
          [cX, first[1], first[2], first[3]],
          [second[0], second[1], cX, second[3]],
        ];
      }
      return [
        [first[0], first[1], first[2], cY],
        [second[0], cY, second[2], second[3]],
      ];
    } else if (a[0] > b[2] && a[1] > b[3]) {
      // Bottom right.
      const cX = second[2] + (first[0] - second[2]) / 2;
      const cY = second[3] + (first[1] - second[3]) / 2;
      if (
        vectorCross(a[0] - endCenterX, a[1] - endCenterY, a[2] - endCenterX, a[3] - endCenterY) > 0
      ) {
        return [
          [cX, first[1], first[2], first[3]],
          [second[0], second[1], cX, second[3]],
        ];
      }
      return [
        [first[0], cY, first[2], first[3]],
        [second[0], second[1], second[2], cY],
      ];
    }
  }
  return [first, second];
}

/** The grid A* walks: nodes where the boxes' edges cross, not a uniform grid. */
function calculateGrid(
  aabbs: ReadonlyArray<Bounds>,
  start: Point,
  startHeading: Heading,
  end: Point,
  endHeading: Heading,
  common: Bounds,
  extra: ReadonlyArray<Point>,
): Grid {
  const horizontal = new Set<number>();
  const vertical = new Set<number>();
  if (headingIsHorizontal(startHeading)) vertical.add(start[1]);
  else horizontal.add(start[0]);
  if (headingIsHorizontal(endHeading)) vertical.add(end[1]);
  else horizontal.add(end[0]);
  for (const aabb of aabbs) {
    horizontal.add(aabb[0]);
    horizontal.add(aabb[2]);
    vertical.add(aabb[1]);
    vertical.add(aabb[3]);
  }
  horizontal.add(common[0]);
  horizontal.add(common[2]);
  vertical.add(common[1]);
  vertical.add(common[3]);
  for (const [x, y] of extra) {
    horizontal.add(x);
    vertical.add(y);
  }
  // Not Excalidraw's: a dongle the obstacle route starts from must be a node.
  if (extra.length > 0) {
    horizontal.add(start[0]);
    vertical.add(start[1]);
    horizontal.add(end[0]);
    vertical.add(end[1]);
  }
  const ys = [...vertical].sort((a, b) => a - b);
  const xs = [...horizontal].sort((a, b) => a - b);
  return {
    row: ys.length,
    col: xs.length,
    data: ys.flatMap((y, row) =>
      xs.map((x, col): Node => ({
        f: 0,
        g: 0,
        h: 0,
        closed: false,
        visited: false,
        parent: null,
        col,
        row,
        pos: [x, y],
      })),
    ),
  };
}

function getDonglePosition(bounds: Bounds, heading: Heading, p: Point): Point {
  if (heading === HEADING_UP) return [p[0], bounds[1]];
  if (heading === HEADING_RIGHT) return [bounds[2], p[1]];
  if (heading === HEADING_DOWN) return [p[0], bounds[3]];
  return [bounds[0], p[1]];
}

function estimateSegmentCount(start: Node, end: Node, startHeading: Heading, endHeading: Heading) {
  const [sx, sy] = start.pos;
  const [ex, ey] = end.pos;
  if (endHeading === HEADING_RIGHT) {
    if (startHeading === HEADING_RIGHT) return sx >= ex ? 4 : sy === ey ? 0 : 2;
    if (startHeading === HEADING_UP) return sy > ey && sx < ex ? 1 : 3;
    if (startHeading === HEADING_DOWN) return sy < ey && sx < ex ? 1 : 3;
    return sy === ey ? 4 : 2;
  }
  if (endHeading === HEADING_LEFT) {
    if (startHeading === HEADING_RIGHT) return sy === ey ? 4 : 2;
    if (startHeading === HEADING_UP) return sy > ey && sx > ex ? 1 : 3;
    if (startHeading === HEADING_DOWN) return sy < ey && sx > ex ? 1 : 3;
    return sx <= ex ? 4 : sy === ey ? 0 : 2;
  }
  if (endHeading === HEADING_UP) {
    if (startHeading === HEADING_RIGHT) return sy > ey && sx < ex ? 1 : 3;
    if (startHeading === HEADING_UP) return sy >= ey ? 4 : sx === ex ? 0 : 2;
    if (startHeading === HEADING_DOWN) return sx === ex ? 4 : 2;
    return sy > ey && sx > ex ? 1 : 3;
  }
  if (startHeading === HEADING_RIGHT) return sy < ey && sx < ex ? 1 : 3;
  if (startHeading === HEADING_UP) return sx === ex ? 4 : 2;
  if (startHeading === HEADING_DOWN) return sy <= ey ? 4 : sx === ex ? 0 : 2;
  return sy < ey && sx > ex ? 1 : 3;
}

const gridNodeFromAddr = (col: number, row: number, grid: Grid): Node | null =>
  col < 0 || col >= grid.col || row < 0 || row >= grid.row
    ? null
    : (grid.data[row * grid.col + col] ?? null);

const getNeighbors = ({ col, row }: Node, grid: Grid) => [
  gridNodeFromAddr(col, row - 1, grid),
  gridNodeFromAddr(col + 1, row, grid),
  gridNodeFromAddr(col, row + 1, grid),
  gridNodeFromAddr(col - 1, row, grid),
];

function pointToGridNode(point: Point, grid: Grid): Node | null {
  for (const candidate of grid.data) {
    if (point[0] === candidate.pos[0] && point[1] === candidate.pos[1]) return candidate;
  }
  return null;
}

const neighborIndexToHeading = (idx: number): Heading =>
  idx === 0 ? HEADING_UP : idx === 1 ? HEADING_RIGHT : idx === 2 ? HEADING_DOWN : HEADING_LEFT;

function getElbowArrowCornerPoints(points: ReadonlyArray<Point>): Point[] {
  if (points.length <= 1) return [...points];
  let previousHorizontal =
    Math.abs(points[0]![1] - points[1]![1]) < Math.abs(points[0]![0] - points[1]![0]);
  return points.filter((p, idx) => {
    if (idx === 0 || idx === points.length - 1) return true;
    const next = points[idx + 1]!;
    const nextHorizontal = Math.abs(p[1] - next[1]) < Math.abs(p[0] - next[0]);
    if (previousHorizontal === nextHorizontal) {
      previousHorizontal = nextHorizontal;
      return false;
    }
    previousHorizontal = nextHorizontal;
    return true;
  });
}

function removeElbowArrowShortSegments(points: ReadonlyArray<Point>): Point[] {
  if (points.length < 4) return [...points];
  return points.filter(
    (p, idx) =>
      idx === 0 ||
      idx === points.length - 1 ||
      pointDistance(points[idx - 1]!, p) > DEDUP_THRESHOLD,
  );
}

/** An elbow's line through its corners, each rounded by up to `radius`. */
export function canvasElbowPath(
  route: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  radius: number,
): string {
  const points = route.map(({ x, y }): Point => [x, y]);
  // A jog too short to see is drawn straight: two corners that close draw a knot.
  const isJog = (i: number) => {
    if (i < 2 || i > points.length - 2) return false;
    const [a, b, c, d] = points.slice(i - 2, i + 2) as [Point, Point, Point, Point];
    return (
      pointDistance(b, c) < 1 &&
      pointDistance(a, b) >= 1 &&
      pointDistance(c, d) >= 1 &&
      (b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1]) > 0
    );
  };
  const kept = points.filter((_, i) => !isJog(i) && !isJog(i + 1));
  const [first] = kept;
  if (first === undefined) return "";
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 1; i < kept.length - 1; i++) {
    const prev = kept[i - 1]!;
    const point = kept[i]!;
    const next = kept[i + 1]!;
    const corner = Math.min(radius, pointDistance(point, next) / 2, pointDistance(point, prev) / 2);
    const toward = (other: Point): Point => {
      const horizontal = Math.abs(other[1] - point[1]) < Math.abs(other[0] - point[0]);
      return horizontal
        ? [point[0] + Math.sign(other[0] - point[0]) * corner, point[1]]
        : [point[0], point[1] + Math.sign(other[1] - point[1]) * corner];
    };
    const [inX, inY] = toward(prev);
    const [outX, outY] = toward(next);
    d += `L${inX} ${inY}Q${point[0]} ${point[1]} ${outX} ${outY}`;
  }
  const last = kept.at(-1)!;
  return kept.length === 1 ? d : `${d}L${last[0]} ${last[1]}`;
}
