import {
  fitTransform,
  MAP_GLYPH_ZOOM,
  wheelIntent,
  zoomAtPoint,
  type MapBounds,
  type MapFitOptions,
  type MapFrameSize,
  type MapPoint,
  type MapTransform,
  type MapViewBox,
} from "./DagExplorer.logic";

export interface SpatialMapWheelEvent {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly deltaX: number;
  readonly deltaY: number;
}

export function spatialMapViewBox(frame: MapFrameSize): MapViewBox {
  return {
    x: 0,
    y: 0,
    width: Math.max(frame.width, 1),
    height: Math.max(frame.height, 1),
  };
}

export function fitSpatialMap(
  bounds: MapBounds,
  frame: MapFrameSize,
  fit: MapFitOptions = {},
): MapTransform {
  return fitTransform(bounds, spatialMapViewBox(frame), fit);
}

export function isAtFit(
  transform: MapTransform,
  bounds: MapBounds,
  frame: MapFrameSize,
  epsilon = 0.001,
  fit: MapFitOptions = {},
): boolean {
  return transformsWithin(transform, fitSpatialMap(bounds, frame, fit), epsilon);
}

export function spatialMapChromeVisibility(
  transform: MapTransform,
  bounds: MapBounds,
  frame: MapFrameSize,
  epsilon = 0.001,
  options: MapFitOptions & { readonly minimap?: boolean } = {},
): { readonly fitButton: boolean; readonly minimap: boolean } {
  const fitted = fitSpatialMap(bounds, frame, options);
  const awayFromFit = !transformsWithin(transform, fitted, epsilon);
  return {
    fitButton: awayFromFit,
    minimap: options.minimap !== false && (awayFromFit || fitted.zoom <= MAP_GLYPH_ZOOM),
  };
}

/** True when a world point sits inside the visible rectangle, so a focus need not move the camera. */
export function pointWithinBounds(point: MapPoint, bounds: MapBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function transformsWithin(left: MapTransform, right: MapTransform, epsilon: number): boolean {
  return (
    Math.abs(left.x - right.x) <= epsilon &&
    Math.abs(left.y - right.y) <= epsilon &&
    Math.abs(left.zoom - right.zoom) <= epsilon
  );
}

export function spatialMapWheelTransform({
  event,
  pointer,
  transform,
  unitsPerPixel,
  viewBox,
}: {
  readonly event: SpatialMapWheelEvent;
  readonly pointer: MapPoint;
  readonly transform: MapTransform;
  readonly unitsPerPixel: number;
  readonly viewBox: MapViewBox;
}): MapTransform {
  const intent = wheelIntent(event);
  if (intent.kind === "zoom") return zoomAtPoint(transform, intent.factor, pointer, viewBox);
  return {
    ...transform,
    x: transform.x - intent.dx * unitsPerPixel,
    y: transform.y - intent.dy * unitsPerPixel,
  };
}
