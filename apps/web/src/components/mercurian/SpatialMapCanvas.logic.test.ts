import { describe, expect, it } from "vite-plus/test";

import { minimapPointToWorld, minimapProjection } from "./DagExplorer.logic";
import {
  fitSpatialMap,
  spatialMapViewBox,
  spatialMapWheelTransform,
} from "./SpatialMapCanvas.logic";

describe("fitSpatialMap", () => {
  it("fits and centers world bounds in the measured frame", () => {
    expect(
      fitSpatialMap({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, { width: 400, height: 300 }),
    ).toEqual({ x: 64, y: 82, zoom: 1.36 });
  });
});

describe("spatial map minimap projection", () => {
  it("round-trips a world point through the minimap", () => {
    const projection = minimapProjection(
      { minX: -120, minY: -40, maxX: 280, maxY: 160 },
      { width: 200, height: 120 },
    );
    const world = { x: 75, y: 45 };

    const roundTripped = minimapPointToWorld(projection.project(world), projection);
    expect(roundTripped.x).toBeCloseTo(world.x);
    expect(roundTripped.y).toBeCloseTo(world.y);
  });
});

describe("spatialMapWheelTransform", () => {
  it("applies wheel-intent zoom around the pointer", () => {
    const transform = spatialMapWheelTransform({
      event: { ctrlKey: true, metaKey: false, deltaX: 0, deltaY: -100 },
      pointer: { x: 100, y: 50 },
      transform: { x: 0, y: 0, zoom: 1 },
      unitsPerPixel: 1,
      viewBox: spatialMapViewBox({ width: 400, height: 300 }),
    });

    expect(transform.zoom).toBeCloseTo(Math.exp(0.2));
    expect((100 - transform.x) / transform.zoom).toBeCloseTo(100);
    expect((50 - transform.y) / transform.zoom).toBeCloseTo(50);
  });

  it("keeps an ordinary wheel gesture as a pan", () => {
    expect(
      spatialMapWheelTransform({
        event: { ctrlKey: false, metaKey: false, deltaX: 4, deltaY: -6 },
        pointer: { x: 0, y: 0 },
        transform: { x: 10, y: 20, zoom: 1 },
        unitsPerPixel: 2,
        viewBox: spatialMapViewBox({ width: 400, height: 300 }),
      }),
    ).toEqual({ x: 2, y: 32, zoom: 1 });
  });
});
