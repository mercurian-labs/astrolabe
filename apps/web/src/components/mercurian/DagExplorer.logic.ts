import { interpolateZoom } from "d3-interpolate";

import type { PlanGraphNode } from "./PlanGraph.logic";

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
export const MAP_LABEL_ZOOM = 1.15;
export const MAP_FIT_PADDING = 64;

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
): (progress: number) => MapTransform {
  const samePosition = Math.hypot(to.x - from.x, to.y - from.y) < 0.001;
  if (samePosition || from.zoom <= 0 || to.zoom <= 0) {
    return (progress) => plainTransformInterpolation(from, to, easeOut(progress));
  }

  const interpolate = interpolateZoom([from.x, from.y, 1 / from.zoom], [to.x, to.y, 1 / to.zoom]);
  return (progress) => {
    if (progress <= 0) return from;
    if (progress >= 1) return to;
    const [x, y, inverseZoom] = interpolate(easeOut(progress));
    return { x, y, zoom: 1 / inverseZoom };
  };
}

export type MapDetail = "dot" | "glyph" | "labeled";

export function detailFor(zoom: number): MapDetail {
  if (zoom < MAP_GLYPH_ZOOM) return "dot";
  if (zoom < MAP_LABEL_ZOOM) return "glyph";
  return "labeled";
}

export function labelVisible(
  zoom: number,
  node: Pick<PlanGraphNode, "isBranchPoint" | "isMerge">,
  isCurrent: boolean,
): boolean {
  const threshold =
    node.isBranchPoint || node.isMerge || isCurrent ? MAP_GLYPH_ZOOM : MAP_LABEL_ZOOM;
  return zoom >= threshold;
}

export function radiusFor(node: Pick<PlanGraphNode, "isBranchPoint" | "isMerge">): number {
  return node.isBranchPoint || node.isMerge ? 12 : 10;
}

export function edgeRibbon(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  fromWidth: number,
  toWidth: number,
): string {
  const midY = (fromY + toY) / 2;
  const fromHalf = fromWidth / 2;
  const toHalf = toWidth / 2;
  return [
    `M ${fromX - fromHalf} ${fromY}`,
    `C ${fromX - fromHalf} ${midY}, ${toX - toHalf} ${midY}, ${toX - toHalf} ${toY}`,
    `L ${toX + toHalf} ${toY}`,
    `C ${toX + toHalf} ${midY}, ${fromX + fromHalf} ${midY}, ${fromX + fromHalf} ${fromY}`,
    "Z",
  ].join(" ");
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
