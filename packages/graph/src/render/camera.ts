/**
 * Camera moves the graph makes on its own: following the agent, fitting the
 * shown notes, and the eased flight between two views. Each is a pure
 * function of views and points; the renderer runs the flight in its loop and
 * cancels it the moment the person touches the camera.
 */
import { Quaternion, Vector3 } from "three";

import { boundsOf, medianNearestNeighbour } from "../layout/forceLayout.ts";

export interface CameraView {
  readonly position: Vector3;
  readonly target: Vector3;
  /** Orthographic zoom; perspective views keep 1. */
  readonly zoom: number;
}

export const FLIGHT_MS = 600;

/** Ease in and out, cubic: a flight starts and lands without a jolt. */
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function viewAt(from: CameraView, to: CameraView, t: number): CameraView {
  const eased = easeInOutCubic(Math.max(0, Math.min(1, t)));
  // Fly around the target, not through it: interpolate the offset's direction
  // and length separately, so a turn keeps its distance.
  const target = from.target.clone().lerp(to.target, eased);
  const fromOffset = from.position.clone().sub(from.target);
  const toOffset = to.position.clone().sub(to.target);
  const length = fromOffset.length() + (toOffset.length() - fromOffset.length()) * eased;
  const turn = new Quaternion().setFromUnitVectors(
    fromOffset.clone().normalize(),
    toOffset.clone().normalize(),
  );
  const direction = fromOffset
    .clone()
    .normalize()
    .applyQuaternion(new Quaternion().slerp(turn, eased));
  return {
    position: target.clone().add(direction.multiplyScalar(length)),
    target,
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
  };
}

/** Within this angle of the camera's direction a risen note already reads as forward. */
export const FOLLOW_CONE = (28 * Math.PI) / 180;
/** The camera stays at least this many times a risen note's distance from the target, so it never ends up behind the camera. */
export const FOLLOW_ROOM = 1.6;

/**
 * Turn the camera about its fixed target just until `points`' mean direction sits within the follow
 * cone. Distance grows only when a note would otherwise pass behind the camera. Null when the
 * points are already forward, so the camera stays put.
 */
export function followView(view: CameraView, points: ReadonlyArray<Vector3>): CameraView | null {
  if (points.length === 0) return null;
  const mean = new Vector3();
  for (const point of points) mean.add(point);
  mean.divideScalar(points.length);
  const toward = mean.clone().sub(view.target);
  const offset = view.position.clone().sub(view.target);
  const distance = offset.length();
  const reach = toward.length();
  // A note at the target is already in front, from any side.
  if (reach < distance * 0.05) return null;
  const camera = offset.clone().normalize();
  const angle = camera.angleTo(toward.clone().normalize());
  const length = Math.max(distance, reach * FOLLOW_ROOM);
  if (angle <= FOLLOW_CONE && length === distance) return null;
  if (angle > FOLLOW_CONE) {
    const turn = new Quaternion().setFromUnitVectors(camera, toward.normalize());
    // Rotate only the part of the angle beyond the cone.
    offset.applyQuaternion(new Quaternion().slerp(turn, (angle - FOLLOW_CONE) / angle));
  }
  return {
    position: view.target.clone().add(offset.setLength(length)),
    target: view.target.clone(),
    zoom: view.zoom,
  };
}

/**
 * The reading density: one link distance spans this many CSS pixels at the
 * camera's target plane. The graph opens at it, Fit returns to it, following
 * holds it, and zoom is free within a quarter to four times it.
 */
export const READING_PIXELS = 96;
export const DENSITY_ZOOM_RANGE = 4;

/** The perspective camera distance at which `linkLength` world units span the reading density. */
export function densityDistance(linkLength: number, viewportHeight: number, fovDegrees: number) {
  const tan = Math.tan((fovDegrees * Math.PI) / 360);
  return (linkLength * viewportHeight) / (READING_PIXELS * 2 * tan);
}

/** The orthographic zoom at which `linkLength` world units span the reading density. */
export function densityZoom(linkLength: number, viewportHeight: number, frustumHeight: number) {
  return (frustumHeight * READING_PIXELS) / (viewportHeight * linkLength);
}

export interface ZoomLimits {
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

/**
 * Zoom is free within a quarter to four times the reading density. When the whole reading only fits
 * further out, the far limit (and the orthographic least zoom) extends to the fit, so clamping
 * never pulls a framed note back out of view. The near limits stay the density's.
 */
export function zoomLimits(input: {
  readonly densityDistance: number;
  readonly densityZoom: number;
  readonly fitDistance: number;
  readonly fitZoom: number;
}): ZoomLimits {
  return {
    minDistance: input.densityDistance / DENSITY_ZOOM_RANGE,
    maxDistance: Math.max(input.densityDistance * DENSITY_ZOOM_RANGE, input.fitDistance),
    minZoom: Math.min(input.densityZoom / DENSITY_ZOOM_RANGE, input.fitZoom),
    maxZoom: input.densityZoom * DENSITY_ZOOM_RANGE,
  };
}

/**
 * The view pulled back inside the zoom limits: a perspective camera keeps its
 * direction and moves to the nearest allowed distance; an orthographic one
 * clamps its zoom. Returns null when the view is already inside them.
 */
export function clampView(
  view: CameraView,
  limits: ZoomLimits,
  orthographic: boolean,
): CameraView | null {
  if (orthographic) {
    const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, view.zoom));
    return zoom === view.zoom ? null : { ...view, zoom };
  }
  const offset = view.position.clone().sub(view.target);
  const distance = offset.length();
  const clamped = Math.min(limits.maxDistance, Math.max(limits.minDistance, distance));
  if (clamped === distance || distance === 0) return null;
  return {
    position: view.target.clone().add(offset.setLength(clamped)),
    target: view.target.clone(),
    zoom: view.zoom,
  };
}

/** Room left around a framed reading, as a share of how far it reaches. */
export const FIT_MARGIN = 1.1;

export interface ReadingFrame {
  /** The reading's bounding centre: where the camera looks. */
  readonly target: Vector3;
  /** How far the reading reaches from its centre, rims included. */
  readonly extent: number;
  /** How far apart its notes sit (the median nearest-neighbour distance), or 0 for one note. */
  readonly span: number;
}

/**
 * How to frame a gathered reading, measured from where its notes settle in
 * the cluster (never from where they stood before gathering): the camera
 * looks at its centre, stands back far enough for all of it, and takes the
 * reading density from its spacing.
 */
export function readingFrame(
  places: ReadonlyArray<readonly [number, number, number]>,
  radius: (slot: number) => number,
): ReadingFrame | null {
  if (places.length === 0) return null;
  const positions = new Float32Array(places.flat());
  const { center } = boundsOf(positions);
  let extent = 0;
  places.forEach((place, slot) => {
    const reach = Math.hypot(place[0] - center[0], place[1] - center[1], place[2] - center[2]);
    extent = Math.max(extent, reach + radius(slot));
  });
  return {
    target: new Vector3(center[0], center[1], center[2]),
    extent,
    span: medianNearestNeighbour(positions),
  };
}

/** The perspective camera distance at which a sphere of radius `extent` fits the viewport, with margin. */
export function fitDistance(extent: number, width: number, height: number, fovDegrees: number) {
  const vertical = (fovDegrees * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * (width / Math.max(height, 1)));
  return (extent * FIT_MARGIN) / Math.sin(Math.min(vertical, horizontal));
}

/** The orthographic zoom at which a disc of radius `extent` fits a frustum this size, with margin. */
export function fitZoom(extent: number, frustumWidth: number, frustumHeight: number) {
  if (extent <= 0) return Infinity;
  return Math.min(frustumWidth, frustumHeight) / (2 * extent * FIT_MARGIN);
}

/** A view at the reading density on `target`, looking along `direction` (perspective). */
export function densityView(target: Vector3, direction: Vector3, distance: number): CameraView {
  const along = direction.lengthSq() < 1e-9 ? new Vector3(0, 0.28, 1) : direction.clone();
  return {
    position: target.clone().add(along.normalize().multiplyScalar(distance)),
    target: target.clone(),
    zoom: 1,
  };
}

/**
 * Following on the flat reading: there is no turning, so the view pans just
 * enough to bring the points' mean within `reach` world units of its center.
 */
export function followFlatView(
  view: CameraView,
  points: ReadonlyArray<Vector3>,
  reach: number,
): CameraView | null {
  if (points.length === 0) return null;
  const mean = new Vector3();
  for (const point of points) mean.add(point);
  mean.divideScalar(points.length);
  const shift = new Vector3(mean.x - view.target.x, mean.y - view.target.y, 0);
  const distance = shift.length();
  if (distance <= reach) return null;
  shift.multiplyScalar((distance - reach) / distance);
  return {
    position: view.position.clone().add(shift),
    target: view.target.clone().add(shift),
    zoom: view.zoom,
  };
}

/** A flat view: the world point at the canvas centre and CSS pixels per world unit (y up). */
export interface FlatCamera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** CSS pixels per world unit of an orthographic camera at `zoom` with a frustum `frustumHeight` tall. */
export const orthoScale = (zoom: number, frustumHeight: number, viewportHeight: number) =>
  (zoom * viewportHeight) / frustumHeight;

/** The orthographic zoom that spans `scale` CSS pixels per world unit. */
export const orthoZoomFor = (scale: number, frustumHeight: number, viewportHeight: number) =>
  (scale * frustumHeight) / viewportHeight;

/** Where world point (x, y) lands on a `width` × `height` canvas under a flat view, in CSS pixels, y down. */
export function flatToScreen(
  view: FlatCamera,
  width: number,
  height: number,
  x: number,
  y: number,
): readonly [number, number] {
  return [width / 2 + (x - view.x) * view.scale, height / 2 - (y - view.y) * view.scale];
}

/** The world point under canvas pixel (sx, sy). */
export function flatToWorld(
  view: FlatCamera,
  width: number,
  height: number,
  sx: number,
  sy: number,
): readonly [number, number] {
  return [view.x + (sx - width / 2) / view.scale, view.y - (sy - height / 2) / view.scale];
}

/** A flat view zoomed by `factor` about canvas pixel (sx, sy), which stays over the same world point. */
export function zoomFlatAt(
  view: FlatCamera,
  width: number,
  height: number,
  sx: number,
  sy: number,
  scale: number,
): FlatCamera {
  const [wx, wy] = flatToWorld(view, width, height, sx, sy);
  return { x: wx - (sx - width / 2) / scale, y: wy + (sy - height / 2) / scale, scale };
}

/** The flat view `t` of the way from `from` to `to`, eased; scale moves geometrically so a zoom feels even. */
export function flatViewAt(from: FlatCamera, to: FlatCamera, t: number): FlatCamera {
  const eased = easeInOutCubic(Math.max(0, Math.min(1, t)));
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    scale: from.scale * (to.scale / from.scale) ** eased,
  };
}

/**
 * The story notes' centroid, or when they spread further than `reach` (half a frame at reading
 * density), the centroid of the note with the most others within `reach` and those others; the rest
 * is reached by panning. Null for no notes.
 */
export function storyCentre(points: ReadonlyArray<Vector3>, reach: number): Vector3 | null {
  if (points.length === 0) return null;
  const centroid = (group: ReadonlyArray<Vector3>) =>
    group.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(group.length);
  const all = centroid(points);
  if (points.every((point) => point.distanceTo(all) <= reach)) return all;
  let best: Array<Vector3> = [];
  for (const point of points) {
    const near = points.filter((other) => other.distanceTo(point) <= reach);
    if (near.length > best.length) best = near;
  }
  return centroid(best);
}
