import { describe, expect, it } from "vite-plus/test";

import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  cameraTween,
  centerOn,
  DagExplorerDisplaySettings,
  decodeDagExplorerDisplaySettings,
  DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS,
  detailFor,
  detailOverlayPosition,
  edgeWidthFor,
  fitTransform,
  mapOverflows,
  MAP_FIT_PADDING,
  MAP_GLYPH_ZOOM,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_PROXIMITY_FALLOFF,
  MAP_PROXIMITY_MAX_SCALE,
  minimapPointToWorld,
  minimapProjection,
  minimapSize,
  proximityScale,
  radiusFor,
  visibleWorldRect,
  wheelIntent,
  zoomAtPoint,
} from "./DagExplorer.logic";
import { buildPlanGraph } from "./PlanGraph.logic";

const id = (value: string) => MercurianCommitId.make(value);

const commit = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "human",
  text: name,
  createdAt: "2026-08-03T00:00:00.000Z",
});

/**
 *      a
 *     / \
 *    l   r
 *     \ /
 *      m
 */
const timeline: ReadonlyArray<PlanTimelineItem> = [
  commit("a", 1, []),
  commit("l", 2, ["a"]),
  commit("r", 3, ["a"]),
  commit("m", 4, ["l", "r"]),
];

const viewBox = { x: -100, y: -50, width: 400, height: 300 };

describe("zoomAtPoint", () => {
  it("keeps the world point under the cursor fixed", () => {
    const transform = { x: 20, y: -10, zoom: 1.25 };
    const point = { x: 150, y: 80 };
    const before = {
      x: (point.x - transform.x) / transform.zoom,
      y: (point.y - transform.y) / transform.zoom,
    };
    const after = zoomAtPoint(transform, 1.4, point, viewBox);

    expect((point.x - after.x) / after.zoom).toBeCloseTo(before.x, 10);
    expect((point.y - after.y) / after.zoom).toBeCloseTo(before.y, 10);
  });

  it("clamps at both zoom bounds", () => {
    expect(zoomAtPoint({ x: 0, y: 0, zoom: 1 }, 100, { x: 0, y: 0 }, viewBox).zoom).toBe(
      MAP_MAX_ZOOM,
    );
    expect(zoomAtPoint({ x: 0, y: 0, zoom: 1 }, 0.001, { x: 0, y: 0 }, viewBox).zoom).toBe(
      MAP_MIN_ZOOM,
    );
  });

  it("is identity at factor one", () => {
    const transform = { x: 12, y: 34, zoom: 1.5 };
    expect(zoomAtPoint(transform, 1, { x: 100, y: 90 }, viewBox)).toBe(transform);
  });
});

describe("wheelIntent", () => {
  it("maps plain wheel deltas to canvas translation", () => {
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 12, deltaY: -8 })).toEqual({
      kind: "pan",
      dx: 12,
      dy: -8,
    });
  });

  it("maps control- and command-wheel to zoom in the delta direction", () => {
    const controlIn = wheelIntent({ ctrlKey: true, metaKey: false, deltaX: 0, deltaY: -20 });
    const commandOut = wheelIntent({ ctrlKey: false, metaKey: true, deltaX: 0, deltaY: 20 });
    expect(controlIn.kind).toBe("zoom");
    expect(controlIn.kind === "zoom" && controlIn.factor).toBeGreaterThan(1);
    expect(commandOut.kind).toBe("zoom");
    expect(commandOut.kind === "zoom" && commandOut.factor).toBeLessThan(1);
  });
});

describe("camera targets", () => {
  it("fits the whole graph inside the frame padding", () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    const target = fitTransform(bounds, { x: 0, y: 0, width: 400, height: 300 });
    const left = target.x + bounds.minX * target.zoom;
    const right = target.x + bounds.maxX * target.zoom;
    const top = target.y + bounds.minY * target.zoom;
    const bottom = target.y + bounds.maxY * target.zoom;

    expect(left).toBeGreaterThanOrEqual(MAP_FIT_PADDING);
    expect(right).toBeLessThanOrEqual(400 - MAP_FIT_PADDING);
    expect(top).toBeGreaterThanOrEqual(MAP_FIT_PADDING);
    expect(bottom).toBeLessThanOrEqual(300 - MAP_FIT_PADDING);
  });

  it("centers a point without changing zoom", () => {
    const target = centerOn({ x: 40, y: 25 }, { x: 9, y: 7, zoom: 2 }, viewBox);
    expect(target.x + 40 * target.zoom).toBe(viewBox.x + viewBox.width / 2);
    expect(target.y + 25 * target.zoom).toBe(viewBox.y + viewBox.height / 2);
    expect(target.zoom).toBe(2);
  });
});

describe("cameraTween", () => {
  it("lands exactly on both endpoints", () => {
    const from = { x: 0, y: 20, zoom: 1 };
    const to = { x: 120, y: -60, zoom: 2 };
    const tween = cameraTween(from, to, viewBox);
    expect(tween(0)).toBe(from);
    expect(tween(1)).toBe(to);
  });

  it("handles a stationary camera and a zoom-only flight", () => {
    const same = { x: 12, y: 14, zoom: 1.5 };
    expect(cameraTween(same, same, viewBox)(0.5)).toEqual(same);

    const zoomed = { x: 12, y: 14, zoom: 2.5 };
    const tween = cameraTween(same, zoomed, viewBox);
    expect(tween(0)).toEqual(same);
    expect(tween(1)).toEqual(zoomed);
    expect(tween(0.5).x).toBe(12);
    expect(tween(0.5).y).toBe(14);
  });

  it("keeps zoom fixed throughout an equal-zoom pan", () => {
    const from = { x: -400, y: 300, zoom: 1.25 };
    const to = { x: 500, y: -250, zoom: 1.25 };
    const tween = cameraTween(from, to, viewBox);

    for (const progress of [0.25, 0.5, 0.75]) {
      expect(tween(progress).zoom).toBe(from.zoom);
    }
  });

  it("keeps zoom-changing flights within a sane intermediate range", () => {
    const from = { x: 0, y: 20, zoom: 1 };
    const to = { x: 120, y: -60, zoom: 2 };
    const tween = cameraTween(from, to, viewBox);
    const minimumZoom = Math.min(from.zoom, to.zoom) / 4;

    for (const progress of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(tween(progress).zoom).toBeGreaterThanOrEqual(minimumZoom);
    }
  });
});

describe("map detail", () => {
  it("switches once from dots to glyphs", () => {
    expect(detailFor(MAP_GLYPH_ZOOM - 0.01)).toBe("dot");
    expect(detailFor(MAP_GLYPH_ZOOM)).toBe("glyph");
    expect(detailFor(MAP_MAX_ZOOM)).toBe("glyph");
  });
});

describe("detail overlay placement", () => {
  const frame = {
    width: 120,
    height: 60,
    containerWidth: 400,
    containerHeight: 300,
    inset: 8,
    gap: 12,
  };

  it("offsets a cursor-tracked overlay below and to the right", () => {
    expect(
      detailOverlayPosition({ ...frame, anchor: { x: 100, y: 80 }, tracksCursor: true }),
    ).toEqual({ x: 112, y: 92 });
  });

  it("flips away from the right and bottom edges", () => {
    expect(
      detailOverlayPosition({ ...frame, anchor: { x: 390, y: 290 }, tracksCursor: true }),
    ).toEqual({ x: 258, y: 218 });
  });

  it("clamps both axes fully inside the container", () => {
    expect(
      detailOverlayPosition({ ...frame, anchor: { x: -20, y: -20 }, tracksCursor: true }),
    ).toEqual({ x: 8, y: 8 });
  });

  it("keeps the node-anchored vertical fallback for keyboard focus", () => {
    expect(
      detailOverlayPosition({ ...frame, anchor: { x: 100, y: 80 }, tracksCursor: false }),
    ).toEqual({ x: 112, y: 68 });
    expect(
      detailOverlayPosition({ ...frame, anchor: { x: 390, y: 290 }, tracksCursor: false }),
    ).toEqual({ x: 258, y: 232 });
  });
});

describe("display settings", () => {
  const graph = buildPlanGraph(timeline);

  it("round-trips a valid persisted value", () => {
    const settings = { layout: "grid", nodeSize: 2.25, lineThickness: 0.75 } as const;
    const encoded = Schema.encodeSync(DagExplorerDisplaySettings)(settings);
    expect(Schema.decodeUnknownSync(DagExplorerDisplaySettings)(encoded)).toEqual(settings);
  });

  it("falls back as a whole for malformed or out-of-range values", () => {
    expect(
      decodeDagExplorerDisplaySettings({ layout: "force", nodeSize: 1, lineThickness: 1 }),
    ).toBe(DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS);
    expect(
      decodeDagExplorerDisplaySettings({ layout: "grid", nodeSize: 5.01, lineThickness: 1 }),
    ).toBe(DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS);
    expect(
      decodeDagExplorerDisplaySettings({ layout: "grid", nodeSize: 1, lineThickness: -0.01 }),
    ).toBe(DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS);
  });

  it("honors zero-sized nodes and zero-width lines", () => {
    expect(radiusFor(graph.byId.get("a")!, { nodeSize: 0 })).toBe(0);
    expect(edgeWidthFor(false, { lineThickness: 0 })).toBe(0);
    expect(edgeWidthFor(true, { lineThickness: 0 })).toBe(0);
  });
});

describe("map sizing", () => {
  const graph = buildPlanGraph(timeline);

  it("grows monotonically with connected degree", () => {
    const leaf = buildPlanGraph([commit("leaf", 1, [])]).byId.get("leaf")!;
    const oneConnection = buildPlanGraph([commit("a", 1, []), commit("b", 2, ["a"])]).byId.get(
      "a",
    )!;
    const twoConnections = graph.byId.get("l")!;
    const threeConnections = buildPlanGraph([
      commit("root", 1, []),
      commit("left", 2, ["root"]),
      commit("middle", 3, ["root"]),
      commit("right", 4, ["root"]),
    ]).byId.get("root")!;
    const radii = [leaf, oneConnection, twoConnections, threeConnections].map((node) =>
      radiusFor(node, { nodeSize: 1 }),
    );

    expect(radii[0]).toBeLessThanOrEqual(radii[1]!);
    expect(radii[1]).toBeLessThan(radii[2]!);
    expect(radii[2]).toBeLessThan(radii[3]!);
  });

  it("is linear in the node-size setting", () => {
    const node = graph.byId.get("a")!;
    expect(radiusFor(node, { nodeSize: 2.5 })).toBeCloseTo(
      radiusFor(node, { nodeSize: 1 }) * 2.5,
      10,
    );
  });

  it("eases monotonically from its maximum to one at the falloff", () => {
    expect(proximityScale(0)).toBe(MAP_PROXIMITY_MAX_SCALE);
    expect(proximityScale(MAP_PROXIMITY_FALLOFF)).toBe(1);
    expect(proximityScale(MAP_PROXIMITY_FALLOFF * 2)).toBe(1);

    const samples = [0, 12, 24, 36, 48, 60, 72].map(proximityScale);
    for (const [index, scale] of samples.entries()) {
      if (index === 0) continue;
      expect(scale).toBeLessThanOrEqual(samples[index - 1]!);
    }
  });
});

describe("minimap geometry", () => {
  const bounds = { minX: -200, minY: 50, maxX: 600, maxY: 250 };
  const mapViewBox = { x: 0, y: 0, width: 400, height: 300 };
  const matchingFrame = { width: 400, height: 300 };

  it("follows the canvas aspect ratio", () => {
    expect(minimapSize(1_000, 500)).toEqual({ width: 200, height: 100 });
  });

  it("clamps its width at both ends", () => {
    expect(minimapSize(500, 500).width).toBe(140);
    expect(minimapSize(2_000, 1_000).width).toBe(260);
  });

  it("falls back for degenerate canvas dimensions", () => {
    expect(minimapSize(0, 500)).toEqual({ width: 160, height: 110 });
    expect(minimapSize(500, -1)).toEqual({ width: 160, height: 110 });
  });

  it("round-trips points through an aspect-preserving projection", () => {
    const projection = minimapProjection(bounds, { width: 160, height: 110 });
    const world = { x: 173, y: 121 };
    const roundTripped = minimapPointToWorld(projection.project(world), projection);
    expect(roundTripped.x).toBeCloseTo(world.x, 12);
    expect(roundTripped.y).toBeCloseTo(world.y, 12);

    const projectedMin = projection.project({ x: bounds.minX, y: bounds.minY });
    const projectedX = projection.project({ x: bounds.maxX, y: bounds.minY });
    const projectedY = projection.project({ x: bounds.minX, y: bounds.maxY });
    const xScale = (projectedX.x - projectedMin.x) / (bounds.maxX - bounds.minX);
    const yScale = (projectedY.y - projectedMin.y) / (bounds.maxY - bounds.minY);
    expect(xScale).toBeCloseTo(yScale, 12);
  });

  it("matches the rendered frame aspect through letterboxing", () => {
    const renderedFrame = { width: 800, height: 300 };
    const visible = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, mapViewBox, renderedFrame);
    const visibleWidth = visible.maxX - visible.minX;
    const visibleHeight = visible.maxY - visible.minY;
    expect(visibleWidth / visibleHeight).toBeCloseTo(
      renderedFrame.width / renderedFrame.height,
      12,
    );
  });

  it("halves the visible world span when zoom doubles", () => {
    const renderedFrame = { width: 800, height: 300 };
    const once = visibleWorldRect({ x: 20, y: -10, zoom: 1 }, mapViewBox, renderedFrame);
    const twice = visibleWorldRect({ x: 20, y: -10, zoom: 2 }, mapViewBox, renderedFrame);
    expect(twice.maxX - twice.minX).toBeCloseTo((once.maxX - once.minX) / 2, 12);
    expect(twice.maxY - twice.minY).toBeCloseTo((once.maxY - once.minY) / 2, 12);
  });

  it("shows that a fit camera covers all bounds without overflowing", () => {
    const fit = fitTransform(bounds, mapViewBox);
    const visible = visibleWorldRect(fit, mapViewBox, matchingFrame);
    expect(visible.minX).toBeLessThanOrEqual(bounds.minX);
    expect(visible.minY).toBeLessThanOrEqual(bounds.minY);
    expect(visible.maxX).toBeGreaterThanOrEqual(bounds.maxX);
    expect(visible.maxY).toBeGreaterThanOrEqual(bounds.maxY);
    expect(mapOverflows(bounds, fit, mapViewBox, matchingFrame)).toBe(false);
  });

  it("overflows once the fitted camera zooms in past the graph", () => {
    const fit = fitTransform(bounds, mapViewBox);
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const zoomed = centerOn(center, { ...fit, zoom: fit.zoom * 2 }, mapViewBox);
    expect(mapOverflows(bounds, zoomed, mapViewBox, matchingFrame)).toBe(true);
  });
});
