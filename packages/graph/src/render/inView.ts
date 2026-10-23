/**
 * The draw budget: which nodes are in view. A node is in view when its drawn
 * disc intersects the camera's frustum, widened by a margin, and it lies
 * nearer than the fade-far plane. Only nodes in view get label updates and
 * are candidates for picking; the rest cost nothing per frame.
 */
import { Vector3, type Camera } from "three";

export const VIEW_MARGIN = 0.1;

const at = new Vector3();

/**
 * Classify `count` nodes into `out` (1 in view, 0 not) and return how many
 * are in view. `visible` skips nodes the view hides; `radius` is the drawn
 * radius in world units; `fadeFar` is the cut, for every node or per node
 * (the story's notes have none).
 */
export function classifyInView(
  camera: Camera,
  count: number,
  position: (index: number, out: Vector3) => Vector3,
  radius: (index: number) => number,
  visible: (index: number) => boolean,
  fadeFar: number | ((index: number) => number),
  out: Uint8Array,
  margin = VIEW_MARGIN,
): number {
  camera.updateMatrixWorld();
  const projection = camera.projectionMatrix.elements;
  // A perspective projection divides by depth; an orthographic one does not.
  const perspective = projection[15] === 0;
  const scaleX = projection[0] ?? 1;
  const scaleY = projection[5] ?? 1;
  const limit = 1 + margin;
  let inView = 0;
  for (let index = 0; index < count; index += 1) {
    out[index] = 0;
    if (!visible(index)) continue;
    position(index, at).applyMatrix4(camera.matrixWorldInverse);
    const depth = -at.z;
    const r = radius(index);
    // Behind the camera, or past the fade-far plane.
    const cut = typeof fadeFar === "number" ? fadeFar : fadeFar(index);
    if (depth + r <= 0 || depth - r > cut) continue;
    const w = perspective ? Math.max(depth, 1e-6) : 1;
    const x = (scaleX * at.x) / w;
    const y = (scaleY * at.y) / w;
    const rx = (scaleX * r) / w;
    const ry = (scaleY * r) / w;
    if (Math.abs(x) - rx > limit || Math.abs(y) - ry > limit) continue;
    out[index] = 1;
    inView += 1;
  }
  return inView;
}

/** A world-space rectangle: what a flat renderer's canvas shows. */
export interface ViewRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * The flat renderers' draw budget: a node is in view when its disc meets the
 * rectangle the canvas shows, widened by `margin` of its half-size on each
 * side. There is no depth, so there is no cut.
 */
export function classifyInViewRect(
  count: number,
  position: (index: number, out: Vector3) => Vector3,
  radius: (index: number) => number,
  visible: (index: number) => boolean,
  rect: ViewRect,
  out: Uint8Array,
  margin = VIEW_MARGIN,
): number {
  const padX = ((rect.maxX - rect.minX) / 2) * margin;
  const padY = ((rect.maxY - rect.minY) / 2) * margin;
  let inView = 0;
  for (let index = 0; index < count; index += 1) {
    out[index] = 0;
    if (!visible(index)) continue;
    position(index, at);
    const r = radius(index);
    if (at.x + r < rect.minX - padX || at.x - r > rect.maxX + padX) continue;
    if (at.y + r < rect.minY - padY || at.y - r > rect.maxY + padY) continue;
    out[index] = 1;
    inView += 1;
  }
  return inView;
}

/** The world rectangle a flat view shows on a `width` × `height` canvas. */
export function flatViewRect(
  view: { readonly x: number; readonly y: number; readonly scale: number },
  width: number,
  height: number,
): ViewRect {
  const halfWidth = width / 2 / view.scale;
  const halfHeight = height / 2 / view.scale;
  return {
    minX: view.x - halfWidth,
    maxX: view.x + halfWidth,
    minY: view.y - halfHeight,
    maxY: view.y + halfHeight,
  };
}
