import {
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  type MapPoint,
  type MapTransform,
} from "@t3tools/client-runtime/state/plan-map";

export function panBy(start: MapTransform, translation: MapPoint): MapTransform {
  "worklet";
  return { ...start, x: start.x + translation.x, y: start.y + translation.y };
}

export function pinchAround(start: MapTransform, scale: number, focal: MapPoint): MapTransform {
  "worklet";
  const zoom = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, start.zoom * scale));
  if (zoom === start.zoom) return start;
  const ratio = zoom / start.zoom;
  return {
    x: focal.x - (focal.x - start.x) * ratio,
    y: focal.y - (focal.y - start.y) * ratio,
    zoom,
  };
}
