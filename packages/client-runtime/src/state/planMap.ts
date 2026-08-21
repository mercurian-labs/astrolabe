import { interpolateZoom } from "d3-interpolate";

import type { PlanGraphNode, SpatialLayout, SpatialNode, SpatialPoint } from "./planGraph.ts";

export type MapTransform = { readonly x: number; readonly y: number; readonly zoom: number };
export interface MapPoint {
  readonly x: number;
  readonly y: number;
}
export interface MapViewBox extends MapPoint {
  readonly width: number;
  readonly height: number;
}
export interface MapFrameSize {
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
export const MINIMAP_PADDING = 8;
const CAMERA_EPSILON = 0.001;

export type MapDetail = "dot" | "glyph";
export const detailFor = (zoom: number): MapDetail => (zoom < MAP_GLYPH_ZOOM ? "dot" : "glyph");

/** Status marks keep their semantic order when several share one graph node. */
export function planNodeStatusDots(input: {
  readonly ready: boolean;
  readonly staleSpec: boolean;
  readonly stalePlan: boolean;
}): ReadonlyArray<{ readonly key: string; readonly fillClass: string }> {
  return [
    ...(input.ready ? [{ key: "ready", fillClass: "fill-emerald-500" }] : []),
    ...(input.staleSpec ? [{ key: "stale-spec", fillClass: "fill-amber-500" }] : []),
    ...(input.stalePlan ? [{ key: "stale-plan", fillClass: "fill-orange-500" }] : []),
  ];
}

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
  return centerOn(
    { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    { x: 0, y: 0, zoom },
    viewBox,
  );
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
    return { x: screenX - centerX * zoom, y: screenY - centerY * zoom, zoom };
  };
}

export function radiusFor(
  node: Pick<PlanGraphNode, "parents" | "childrenIds">,
  settings: { readonly nodeSize: number },
): number {
  const degreeFactor = clamp(Math.sqrt(node.parents.length + node.childrenIds.length), 1, 1.6);
  return 10 * settings.nodeSize * degreeFactor;
}

export function edgeWidthFor(
  isCurrentPath: boolean,
  settings: { readonly lineThickness: number },
): number {
  return (isCurrentPath ? 2 : 1.25) * settings.lineThickness;
}

export interface MinimapSize {
  readonly width: number;
  readonly height: number;
}

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
  return { width, height: clamp(width * (canvasHeight / canvasWidth), 90, 200) };
}

export interface MinimapProjection {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly project: (point: MapPoint) => MapPoint;
}

export function minimapProjection(bounds: MapBounds, size: MinimapSize): MinimapProjection {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const scale = Math.min(
    Math.max(size.width - MINIMAP_PADDING * 2, 1) / Math.max(width, 1),
    Math.max(size.height - MINIMAP_PADDING * 2, 1) / Math.max(height, 1),
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

export function visibleWorldRect(
  transform: MapTransform,
  viewBox: MapViewBox,
  frame: MapFrameSize,
): MapBounds {
  const frameWidth = Number.isFinite(frame.width) && frame.width > 0 ? frame.width : viewBox.width;
  const frameHeight =
    Number.isFinite(frame.height) && frame.height > 0 ? frame.height : viewBox.height;
  const scale = Math.max(viewBox.width / frameWidth, viewBox.height / frameHeight);
  const renderedWidth = frameWidth * scale;
  const renderedHeight = frameHeight * scale;
  const minX = viewBox.x + (viewBox.width - renderedWidth) / 2;
  const minY = viewBox.y + (viewBox.height - renderedHeight) / 2;
  return {
    minX: (minX - transform.x) / transform.zoom,
    minY: (minY - transform.y) / transform.zoom,
    maxX: (minX + renderedWidth - transform.x) / transform.zoom,
    maxY: (minY + renderedHeight - transform.y) / transform.zoom,
  };
}

export function minimapPointToWorld(point: MapPoint, projection: MinimapProjection): MapPoint {
  return {
    x: (point.x - projection.offsetX) / projection.scale,
    y: (point.y - projection.offsetY) / projection.scale,
  };
}

export function mapOverflows(
  bounds: MapBounds,
  transform: MapTransform,
  viewBox: MapViewBox,
  frame: MapFrameSize,
): boolean {
  const visible = visibleWorldRect(transform, viewBox, frame);
  return (
    bounds.minX < visible.minX - CAMERA_EPSILON ||
    bounds.minY < visible.minY - CAMERA_EPSILON ||
    bounds.maxX > visible.maxX + CAMERA_EPSILON ||
    bounds.maxY > visible.maxY + CAMERA_EPSILON
  );
}

export type AnimatedSpatialNode = SpatialNode & {
  readonly opacity: number;
  readonly scale: number;
};
export type AnimatedSpatialLayout = Omit<SpatialLayout, "nodes"> & {
  readonly nodes: ReadonlyArray<AnimatedSpatialNode>;
};

export function settledSpatialLayout(layout: SpatialLayout): AnimatedSpatialLayout {
  return { ...layout, nodes: layout.nodes.map((node) => ({ ...node, opacity: 1, scale: 1 })) };
}

export function interpolateSpatialLayout(
  from: AnimatedSpatialLayout,
  to: SpatialLayout,
  progress: number,
): AnimatedSpatialLayout {
  if (progress >= 1) return settledSpatialLayout(to);
  const eased = 1 - (1 - progress) ** 3;
  const fromById = new Map(from.nodes.map((node) => [node.commitId as string, node]));
  const positions = new Map<string, SpatialPoint>();
  const nodes = to.nodes.map((node): AnimatedSpatialNode => {
    const previous = fromById.get(node.commitId);
    const x = previous === undefined ? node.x : previous.x + (node.x - previous.x) * eased;
    const y = previous === undefined ? node.y : previous.y + (node.y - previous.y) * eased;
    positions.set(node.commitId, { x, y });
    return {
      ...node,
      x,
      y,
      opacity: previous === undefined ? eased : previous.opacity + (1 - previous.opacity) * eased,
      scale: previous === undefined ? eased : previous.scale + (1 - previous.scale) * eased,
    };
  });
  const fromEdgesById = new Map(
    from.edges.map((edge) => [`${edge.fromCommitId}\0${edge.toCommitId}`, edge]),
  );
  const edges = to.edges.map((edge) => {
    const fromPoint = positions.get(edge.fromCommitId)!;
    const toPoint = positions.get(edge.toCommitId)!;
    const previous = fromEdgesById.get(`${edge.fromCommitId}\0${edge.toCommitId}`);
    const points =
      previous !== undefined && previous.points.length === edge.points.length
        ? edge.points.map((point, index) => {
            if (index === 0) return fromPoint;
            if (index === edge.points.length - 1) return toPoint;
            const oldPoint = previous.points[index]!;
            return {
              x: oldPoint.x + (point.x - oldPoint.x) * eased,
              y: oldPoint.y + (point.y - oldPoint.y) * eased,
            };
          })
        : [fromPoint, toPoint];
    return { ...edge, points };
  });
  return { ...to, edges, nodes, positions };
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
