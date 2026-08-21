import {
  MAP_FIT_PADDING,
  fitTransform,
  mapOverflows,
  radiusFor,
  type MapFrameSize,
  type MapPoint,
  type MapTransform,
  type MapViewBox,
} from "@t3tools/client-runtime/state/plan-map";
import type { PlanGraph, SpatialLayout } from "@t3tools/client-runtime/state/plan-graph";
import type { MercurianCommitId } from "@t3tools/contracts";

export function hitTestNode(
  graph: PlanGraph,
  layout: SpatialLayout,
  transform: MapTransform,
  point: MapPoint,
): MercurianCommitId | null {
  let hit: { readonly commitId: MercurianCommitId; readonly distance: number } | null = null;
  for (const node of layout.nodes) {
    const graphNode = graph.byId.get(node.commitId);
    if (graphNode === undefined) continue;
    const screenX = node.x * transform.zoom + transform.x;
    const screenY = node.y * transform.zoom + transform.y;
    const distance = Math.hypot(point.x - screenX, point.y - screenY);
    const hitRadius = Math.max(radiusFor(graphNode, { nodeSize: 1 }) * transform.zoom, 22);
    if (distance <= hitRadius && (hit === null || distance < hit.distance)) {
      hit = { commitId: node.commitId, distance };
    }
  }
  return hit?.commitId ?? null;
}

export function initialMapTransform(layout: SpatialLayout, frame: MapViewBox): MapTransform {
  return fitTransform(layout.bounds, frame);
}

export function fittedBoundsAreInsideFrame(layout: SpatialLayout, frame: MapViewBox): boolean {
  const transform = initialMapTransform(layout, frame);
  return (
    transform.x + layout.bounds.minX * transform.zoom >= frame.x + MAP_FIT_PADDING &&
    transform.y + layout.bounds.minY * transform.zoom >= frame.y + MAP_FIT_PADDING &&
    transform.x + layout.bounds.maxX * transform.zoom <= frame.x + frame.width - MAP_FIT_PADDING &&
    transform.y + layout.bounds.maxY * transform.zoom <= frame.y + frame.height - MAP_FIT_PADDING
  );
}

export const shouldShowMinimap = (
  layout: SpatialLayout,
  transform: MapTransform,
  viewBox: MapViewBox,
  frame: MapFrameSize,
) => mapOverflows(layout.bounds, transform, viewBox, frame);
