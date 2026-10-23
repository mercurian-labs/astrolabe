/**
 * CPU-side picking. Nodes are projected to the screen and the nearest one
 * within 1.3× its drawn radius wins; when several qualify, the one nearer the
 * camera wins, since it is drawn on top. No raycaster and no GPU readback.
 */
import { Vector3, type Camera } from "three";

export const PICK_SLOP = 1.3;

export interface ScreenNode {
  readonly x: number;
  readonly y: number;
  /** Drawn radius in CSS pixels. */
  readonly radius: number;
  /** Normalized device depth, -1 near to 1 far. */
  readonly depth: number;
}

/** The index of the node under the pointer, or -1. `nodes` entries may be null when hidden. */
export function pickNearest(
  nodes: ReadonlyArray<ScreenNode | null>,
  pointerX: number,
  pointerY: number,
): number {
  let best = -1;
  let bestDepth = Infinity;
  let bestDistance = Infinity;
  nodes.forEach((node, index) => {
    if (node === null) return;
    const distance = Math.hypot(node.x - pointerX, node.y - pointerY);
    if (distance > node.radius * PICK_SLOP) return;
    // Nearer the camera wins; between equals, nearer the pointer.
    if (
      node.depth < bestDepth - 1e-6 ||
      (Math.abs(node.depth - bestDepth) <= 1e-6 && distance < bestDistance)
    ) {
      best = index;
      bestDepth = node.depth;
      bestDistance = distance;
    }
  });
  return best;
}

const scratch = new Vector3();
const offset = new Vector3();

/**
 * Where a world point with a world radius lands on a `width` × `height`
 * canvas. The radius is measured by projecting a point one radius along the
 * camera's up vector, so it holds for perspective and orthographic cameras.
 * Returns null behind the camera.
 */
export function projectNode(
  camera: Camera,
  x: number,
  y: number,
  z: number,
  worldRadius: number,
  width: number,
  height: number,
): ScreenNode | null {
  scratch.set(x, y, z).project(camera);
  if (scratch.z < -1 || scratch.z > 1) return null;
  const sx = (scratch.x * 0.5 + 0.5) * width;
  const sy = (-scratch.y * 0.5 + 0.5) * height;
  const depth = scratch.z;
  offset.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(worldRadius);
  scratch.set(x + offset.x, y + offset.y, z + offset.z).project(camera);
  const ry = (-scratch.y * 0.5 + 0.5) * height;
  return { x: sx, y: sy, radius: Math.abs(sy - ry), depth };
}

/**
 * Every node's place on screen, reused from pick to pick, so hovering a web
 * of any size allocates nothing per node.
 */
export class ScreenNodes {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly radius: Float32Array;
  readonly depth: Float32Array;
  /** 1 where the node can be picked. */
  readonly shown: Uint8Array;

  constructor(count: number) {
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.radius = new Float32Array(count);
    this.depth = new Float32Array(count);
    this.shown = new Uint8Array(count);
  }

  set(index: number, x: number, y: number, radius: number, depth: number): void {
    this.x[index] = x;
    this.y[index] = y;
    this.radius[index] = radius;
    this.depth[index] = depth;
    this.shown[index] = 1;
  }
}

/** `projectNode` into a `ScreenNodes` slot, allocating nothing; a node behind the camera is not shown. */
export function projectInto(
  out: ScreenNodes,
  index: number,
  camera: Camera,
  x: number,
  y: number,
  z: number,
  worldRadius: number,
  width: number,
  height: number,
): void {
  scratch.set(x, y, z).project(camera);
  if (scratch.z < -1 || scratch.z > 1) {
    out.shown[index] = 0;
    return;
  }
  const sx = (scratch.x * 0.5 + 0.5) * width;
  const sy = (-scratch.y * 0.5 + 0.5) * height;
  const depth = scratch.z;
  offset.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(worldRadius);
  scratch.set(x + offset.x, y + offset.y, z + offset.z).project(camera);
  out.set(index, sx, sy, Math.abs(sy - (-scratch.y * 0.5 + 0.5) * height), depth);
}

/** `pickNearest` over a `ScreenNodes`: the index of the node under the pointer, or -1. */
export function pickNearestIn(nodes: ScreenNodes, pointerX: number, pointerY: number): number {
  let best = -1;
  let bestDepth = Infinity;
  let bestDistance = Infinity;
  for (let index = 0; index < nodes.shown.length; index += 1) {
    if (nodes.shown[index] !== 1) continue;
    const distance = Math.hypot((nodes.x[index] ?? 0) - pointerX, (nodes.y[index] ?? 0) - pointerY);
    if (distance > (nodes.radius[index] ?? 0) * PICK_SLOP) continue;
    const depth = nodes.depth[index] ?? 0;
    if (
      depth < bestDepth - 1e-6 ||
      (Math.abs(depth - bestDepth) <= 1e-6 && distance < bestDistance)
    ) {
      best = index;
      bestDepth = depth;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Whether the pointer really moved. A hover is the person's: it changes only
 * when the pointer moves, never because a note glided under a still pointer,
 * so a pointer event at the same place as the last one is not a move.
 */
export class PointerTracker {
  #x = Number.NaN;
  #y = Number.NaN;

  /** Record a pointer event at (x, y) in client pixels; true when it moved from the last one. */
  moved(x: number, y: number): boolean {
    if (x === this.#x && y === this.#y) return false;
    this.#x = x;
    this.#y = y;
    return true;
  }

  /** The pointer left: its next event counts as a move. */
  reset(): void {
    this.#x = Number.NaN;
    this.#y = Number.NaN;
  }
}

/** Distance in pixels from a point to a segment. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
