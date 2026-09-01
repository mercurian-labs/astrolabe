import {
  fitTransform,
  wheelIntent,
  zoomAtPoint,
  type MapBounds,
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

export function fitSpatialMap(bounds: MapBounds, frame: MapFrameSize): MapTransform {
  return fitTransform(bounds, spatialMapViewBox(frame));
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
