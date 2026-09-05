import { describe, expect, it } from "vite-plus/test";

import { minimapPointToWorld, minimapProjection } from "./DagExplorer.logic";
import {
  fitSpatialMap,
  isAtFit,
  pointWithinBounds,
  spatialMapChromeVisibility,
  spatialMapViewBox,
  spatialMapWheelTransform,
} from "./SpatialMapCanvas.logic";

const fitBounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 } as const;
const fitFrame = { width: 400, height: 300 } as const;

describe("fitSpatialMap", () => {
  it("fits and centers world bounds in the measured frame", () => {
    expect(
      fitSpatialMap({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, { width: 400, height: 300 }),
    ).toEqual({ x: 64, y: 82, zoom: 1.36 });
  });

  it("scales a small map up to fill the frame padding", () => {
    const transform = fitSpatialMap(
      { minX: 0, minY: 0, maxX: 144, maxY: 40 },
      { width: 600, height: 400 },
    );

    expect(transform.zoom).toBeGreaterThan(1);
  });
});

describe("fit options for small labelled graphs", () => {
  // Four compact memory nodes in a right panel about 360px wide.
  const graphBounds = { minX: 0, minY: 0, maxX: 330, maxY: 250 } as const;
  const panelFrame = { width: 360, height: 288 } as const;

  it("spends the frame on the graph instead of DAG padding, so labels stay readable", () => {
    const stock = fitSpatialMap(graphBounds, panelFrame);
    const compact = fitSpatialMap(graphBounds, panelFrame, { padding: 12, maxZoom: 1.25 });
    expect(stock.zoom).toBeLessThan(0.75);
    expect(compact.zoom).toBeGreaterThanOrEqual(0.95);
    // A 12px label rendered at the compact fit stays at or above 11px.
    expect(12 * compact.zoom).toBeGreaterThanOrEqual(11);
  });

  it("caps a lone node at the readable ceiling instead of the map maximum", () => {
    const lone = fitSpatialMap({ minX: 0, minY: 0, maxX: 128, maxY: 40 }, panelFrame, {
      padding: 12,
      maxZoom: 1.25,
    });
    expect(lone.zoom).toBe(1.25);
    expect(
      fitSpatialMap({ minX: 0, minY: 0, maxX: 128, maxY: 40 }, panelFrame).zoom,
    ).toBeGreaterThan(1.25);
  });

  it("keeps the fitted state and hides the minimap when a surface opts out", () => {
    const fit = { padding: 12, maxZoom: 1.25 } as const;
    const fitted = fitSpatialMap(graphBounds, panelFrame, fit);
    expect(isAtFit(fitted, graphBounds, panelFrame, 0.001, fit)).toBe(true);
    expect(isAtFit(fitted, graphBounds, panelFrame)).toBe(false);
    const narrow = { width: 358, height: 288 } as const;
    const zoomedOut = fitSpatialMap({ minX: 0, minY: 0, maxX: 900, maxY: 700 }, narrow, fit);
    expect(
      spatialMapChromeVisibility(
        zoomedOut,
        { minX: 0, minY: 0, maxX: 900, maxY: 700 },
        narrow,
        0.001,
        fit,
      ).minimap,
    ).toBe(true);
    expect(
      spatialMapChromeVisibility(
        zoomedOut,
        { minX: 0, minY: 0, maxX: 900, maxY: 700 },
        narrow,
        0.001,
        { ...fit, minimap: false },
      ),
    ).toEqual({ fitButton: false, minimap: false });
  });

  it("knows when a focused point is already visible", () => {
    expect(pointWithinBounds({ x: 10, y: 10 }, graphBounds)).toBe(true);
    expect(pointWithinBounds({ x: 331, y: 10 }, graphBounds)).toBe(false);
  });
});

describe("isAtFit", () => {
  const fitted = fitSpatialMap(fitBounds, fitFrame);

  it("recognizes the fitted transform", () => {
    expect(isAtFit(fitted, fitBounds, fitFrame)).toBe(true);
  });

  it("rejects a panned transform", () => {
    expect(isAtFit({ ...fitted, x: fitted.x + 2 }, fitBounds, fitFrame)).toBe(false);
  });

  it("rejects a zoomed transform", () => {
    expect(isAtFit({ ...fitted, zoom: fitted.zoom + 0.1 }, fitBounds, fitFrame)).toBe(false);
  });

  it("tolerates drift within epsilon", () => {
    expect(
      isAtFit(
        { x: fitted.x + 0.0005, y: fitted.y - 0.0005, zoom: fitted.zoom + 0.0005 },
        fitBounds,
        fitFrame,
      ),
    ).toBe(true);
  });
});

describe("spatialMapChromeVisibility", () => {
  const fitted = fitSpatialMap(fitBounds, fitFrame);

  it("hides both controls when a legible map is fitted", () => {
    expect(spatialMapChromeVisibility(fitted, fitBounds, fitFrame)).toEqual({
      fitButton: false,
      minimap: false,
    });
  });

  it("keeps only the minimap when the fitted map is too zoomed out for detail", () => {
    const bounds = { minX: 0, minY: 0, maxX: 2_000, maxY: 1_000 };
    const frame = { width: 400, height: 300 };

    expect(spatialMapChromeVisibility(fitSpatialMap(bounds, frame), bounds, frame)).toEqual({
      fitButton: false,
      minimap: true,
    });
  });

  it("shows both controls away from fit", () => {
    expect(spatialMapChromeVisibility({ ...fitted, x: fitted.x + 2 }, fitBounds, fitFrame)).toEqual(
      { fitButton: true, minimap: true },
    );
  });

  it("hides both controls for within-epsilon drift at a legible fit", () => {
    expect(
      spatialMapChromeVisibility(
        { x: fitted.x + 0.0005, y: fitted.y - 0.0005, zoom: fitted.zoom + 0.0005 },
        fitBounds,
        fitFrame,
      ),
    ).toEqual({ fitButton: false, minimap: false });
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
