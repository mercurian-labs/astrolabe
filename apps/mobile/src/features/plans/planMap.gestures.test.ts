import { describe, expect, it } from "vite-plus/test";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, zoomAtPoint } from "@t3tools/client-runtime/state/plan-map";

import { panBy, pinchAround } from "./planMap.gestures";

describe("plan map gestures", () => {
  const viewBox = { x: 0, y: 0, width: 400, height: 300 };

  it("translates from the gesture-start transform", () => {
    expect(panBy({ x: 10, y: -5, zoom: 2 }, { x: 18, y: 7 })).toEqual({ x: 28, y: 2, zoom: 2 });
  });

  it("agrees with the shared focal zoom formula including both clamps", () => {
    const start = { x: 20, y: -10, zoom: 1.25 };
    const focal = { x: 150, y: 80 };
    for (const scale of [0.001, 0.8, 1, 1.4, 100]) {
      expect(pinchAround(start, scale, focal)).toEqual(zoomAtPoint(start, scale, focal, viewBox));
    }
    expect(pinchAround(start, 0.001, focal).zoom).toBe(MAP_MIN_ZOOM);
    expect(pinchAround(start, 100, focal).zoom).toBe(MAP_MAX_ZOOM);
  });

  it("keeps the focal world point invariant", () => {
    const start = { x: -30, y: 12, zoom: 0.9 };
    const focal = { x: 88, y: 144 };
    const next = pinchAround(start, 2, focal);
    expect((focal.x - next.x) / next.zoom).toBeCloseTo((focal.x - start.x) / start.zoom, 10);
    expect((focal.y - next.y) / next.zoom).toBeCloseTo((focal.y - start.y) / start.zoom, 10);
  });
});
