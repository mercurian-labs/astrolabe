import { interpolateZoom } from "d3-interpolate";
import * as Schema from "effect/Schema";

import type { PlanGraphNode } from "./PlanGraph.logic";

const DisplayMultiplier = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(5),
);

export const DagExplorerDisplaySettings = Schema.Struct({
  layout: Schema.Literals(["sugiyama", "grid", "zherebko"]),
  nodeSize: DisplayMultiplier,
  lineThickness: DisplayMultiplier,
});
export type DagExplorerDisplaySettings = typeof DagExplorerDisplaySettings.Type;

export const DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS: DagExplorerDisplaySettings = {
  layout: "sugiyama",
  nodeSize: 1,
  lineThickness: 1,
};

/** Stored display choices fail closed as one set, never as a half-valid mix. */
export function decodeDagExplorerDisplaySettings(value: unknown): DagExplorerDisplaySettings {
  try {
    return Schema.decodeUnknownSync(DagExplorerDisplaySettings)(value);
  } catch {
    return DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS;
  }
}

export type MapTransform = {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
};

export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

export interface MapViewBox extends MapPoint {
  readonly width: number;
  readonly height: number;
}

export interface MapBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const MAP_MIN_ZOOM = 0.3;
export const MAP_MAX_ZOOM = 3;
export const MAP_GLYPH_ZOOM = 0.65;
export const MAP_FIT_PADDING = 64;
export const MAP_PROXIMITY_FALLOFF = 72;
export const MAP_PROXIMITY_MAX_SCALE = 1.35;
export const MINIMAP_PADDING = 8;
const CAMERA_EPSILON = 0.001;

export function zoomAtPoint(
  transform: MapTransform,
  factor: number,
  point: MapPoint,
  _viewBox: MapViewBox,
): MapTransform {
  const zoom = clamp(transform.zoom * factor, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
  if (zoom === transform.zoom) return transform;
  const ratio = zoom / transform.zoom;
  return {
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
    zoom,
  };
}

export function wheelIntent({
  ctrlKey,
  metaKey,
  deltaX,
  deltaY,
}: {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly deltaX: number;
  readonly deltaY: number;
}):
  | { readonly kind: "zoom"; readonly factor: number }
  | { readonly kind: "pan"; readonly dx: number; readonly dy: number } {
  if (ctrlKey || metaKey) {
    return { kind: "zoom", factor: Math.exp(-deltaY * 0.002) };
  }
  return { kind: "pan", dx: deltaX, dy: deltaY };
}

export function fitTransform(bounds: MapBounds, viewBox: MapViewBox): MapTransform {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const availableWidth = Math.max(viewBox.width - MAP_FIT_PADDING * 2, 1);
  const availableHeight = Math.max(viewBox.height - MAP_FIT_PADDING * 2, 1);
  const zoom = clamp(
    Math.min(availableWidth / width, availableHeight / height),
    MAP_MIN_ZOOM,
    MAP_MAX_ZOOM,
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return centerOn({ x: centerX, y: centerY }, { x: 0, y: 0, zoom }, viewBox);
}

export function centerOn(
  point: MapPoint,
  transform: MapTransform,
  viewBox: MapViewBox,
): MapTransform {
  return {
    x: viewBox.x + viewBox.width / 2 - point.x * transform.zoom,
    y: viewBox.y + viewBox.height / 2 - point.y * transform.zoom,
    zoom: transform.zoom,
  };
}

export function cameraTween(
  from: MapTransform,
  to: MapTransform,
  viewBox: MapViewBox,
): (progress: number) => MapTransform {
  const samePosition = Math.hypot(to.x - from.x, to.y - from.y) < CAMERA_EPSILON;
  const sameZoom = Math.abs(to.zoom - from.zoom) < CAMERA_EPSILON;
  if (samePosition || sameZoom || from.zoom <= 0 || to.zoom <= 0) {
    return (progress) => plainTransformInterpolation(from, to, easeOut(progress));
  }

  const screenX = viewBox.x + viewBox.width / 2;
  const screenY = viewBox.y + viewBox.height / 2;
  const interpolate = interpolateZoom(
    [(screenX - from.x) / from.zoom, (screenY - from.y) / from.zoom, viewBox.width / from.zoom],
    [(screenX - to.x) / to.zoom, (screenY - to.y) / to.zoom, viewBox.width / to.zoom],
  );
  return (progress) => {
    if (progress <= 0) return from;
    if (progress >= 1) return to;
    const [centerX, centerY, width] = interpolate(easeOut(progress));
    const zoom = viewBox.width / width;
    return {
      x: screenX - centerX * zoom,
      y: screenY - centerY * zoom,
      zoom,
    };
  };
}

export type MapDetail = "dot" | "glyph";

export function detailFor(zoom: number): MapDetail {
  if (zoom < MAP_GLYPH_ZOOM) return "dot";
  return "glyph";
}

export function radiusFor(
  node: Pick<PlanGraphNode, "parents" | "childrenIds">,
  settings: Pick<DagExplorerDisplaySettings, "nodeSize">,
): number {
  const degreeFactor = clamp(Math.sqrt(node.parents.length + node.childrenIds.length), 1, 1.6);
  return 10 * settings.nodeSize * degreeFactor;
}

export function edgeWidthFor(
  isCurrentPath: boolean,
  settings: Pick<DagExplorerDisplaySettings, "lineThickness">,
): number {
  return (isCurrentPath ? 2 : 1.25) * settings.lineThickness;
}

/** A finite cursor response: settled at one outside the nearby falloff. */
export function proximityScale(distance: number): number {
  const nearness = 1 - clamp(distance / MAP_PROXIMITY_FALLOFF, 0, 1);
  const eased = nearness * nearness * (3 - 2 * nearness);
  return 1 + (MAP_PROXIMITY_MAX_SCALE - 1) * eased;
}

export interface MinimapSize {
  readonly width: number;
  readonly height: number;
}

/** Keep the overview proportional to its canvas while bounding its footprint. */
export function minimapSize(canvasWidth: number, canvasHeight: number): MinimapSize {
  if (
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return { width: 160, height: 110 };
  }

  const width = clamp(canvasWidth * 0.2, 140, 260);
  return {
    width,
    height: clamp(width * (canvasHeight / canvasWidth), 90, 200),
  };
}

export interface MinimapProjection {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly project: (point: MapPoint) => MapPoint;
}

/** One padded scale for both axes: the overview never stretches the graph. */
export function minimapProjection(bounds: MapBounds, size: MinimapSize): MinimapProjection {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const availableWidth = Math.max(size.width - MINIMAP_PADDING * 2, 1);
  const availableHeight = Math.max(size.height - MINIMAP_PADDING * 2, 1);
  const scale = Math.min(
    availableWidth / Math.max(width, 1),
    availableHeight / Math.max(height, 1),
  );
  const offsetX = (size.width - width * scale) / 2 - bounds.minX * scale;
  const offsetY = (size.height - height * scale) / 2 - bounds.minY * scale;
  return {
    scale,
    offsetX,
    offsetY,
    project: ({ x, y }) => ({ x: x * scale + offsetX, y: y * scale + offsetY }),
  };
}

/** The graph-space rectangle currently visible through the SVG frame. */
export function visibleWorldRect(transform: MapTransform, viewBox: MapViewBox): MapBounds {
  return {
    minX: (viewBox.x - transform.x) / transform.zoom,
    minY: (viewBox.y - transform.y) / transform.zoom,
    maxX: (viewBox.x + viewBox.width - transform.x) / transform.zoom,
    maxY: (viewBox.y + viewBox.height - transform.y) / transform.zoom,
  };
}

export function minimapPointToWorld(point: MapPoint, projection: MinimapProjection): MapPoint {
  return {
    x: (point.x - projection.offsetX) / projection.scale,
    y: (point.y - projection.offsetY) / projection.scale,
  };
}

/** True only while at least one graph extremity lies beyond the frame. */
export function mapOverflows(
  bounds: MapBounds,
  transform: MapTransform,
  viewBox: MapViewBox,
): boolean {
  const visible = visibleWorldRect(transform, viewBox);
  return (
    bounds.minX < visible.minX - CAMERA_EPSILON ||
    bounds.minY < visible.minY - CAMERA_EPSILON ||
    bounds.maxX > visible.maxX + CAMERA_EPSILON ||
    bounds.maxY > visible.maxY + CAMERA_EPSILON
  );
}

const plainTransformInterpolation = (
  from: MapTransform,
  to: MapTransform,
  progress: number,
): MapTransform => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
  zoom: from.zoom + (to.zoom - from.zoom) * progress,
});

const easeOut = (progress: number) => 1 - (1 - clamp(progress, 0, 1)) ** 3;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));
