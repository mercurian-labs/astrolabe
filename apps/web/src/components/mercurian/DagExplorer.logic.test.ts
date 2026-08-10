import { describe, expect, it } from "vite-plus/test";

import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import {
  cameraTween,
  centerOn,
  detailFor,
  edgeRibbon,
  fitTransform,
  labelVisible,
  MAP_FIT_PADDING,
  MAP_GLYPH_ZOOM,
  MAP_LABEL_ZOOM,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  radiusFor,
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
    const tween = cameraTween(from, to);
    expect(tween(0)).toBe(from);
    expect(tween(1)).toBe(to);
  });

  it("handles a stationary camera and a zoom-only flight", () => {
    const same = { x: 12, y: 14, zoom: 1.5 };
    expect(cameraTween(same, same)(0.5)).toEqual(same);

    const zoomed = { x: 12, y: 14, zoom: 2.5 };
    const tween = cameraTween(same, zoomed);
    expect(tween(0)).toEqual(same);
    expect(tween(1)).toEqual(zoomed);
    expect(tween(0.5).x).toBe(12);
    expect(tween(0.5).y).toBe(14);
  });
});

describe("map detail", () => {
  const graph = buildPlanGraph(timeline);
  const ordinary = graph.byId.get("l")!;
  const branch = graph.byId.get("a")!;
  const merge = graph.byId.get("m")!;

  it("moves through monotone detail tiers", () => {
    expect(detailFor(MAP_GLYPH_ZOOM - 0.01)).toBe("dot");
    expect(detailFor(MAP_GLYPH_ZOOM)).toBe("glyph");
    expect(detailFor(MAP_LABEL_ZOOM)).toBe("labeled");
  });

  it("labels junctions and the current commit one tier earlier", () => {
    const middleTier = (MAP_GLYPH_ZOOM + MAP_LABEL_ZOOM) / 2;
    expect(labelVisible(middleTier, ordinary, false)).toBe(false);
    expect(labelVisible(middleTier, branch, false)).toBe(true);
    expect(labelVisible(middleTier, merge, false)).toBe(true);
    expect(labelVisible(middleTier, ordinary, true)).toBe(true);
    expect(labelVisible(MAP_LABEL_ZOOM, ordinary, false)).toBe(true);
  });

  it("gives branch points and merges larger badges", () => {
    expect(radiusFor(ordinary)).toBe(10);
    expect(radiusFor(branch)).toBe(12);
    expect(radiusFor(merge)).toBe(12);
  });
});

describe("edgeRibbon", () => {
  it("tapers from the parent width to the child width around the endpoints", () => {
    const path = edgeRibbon(10, 20, 100, 200, 4, 2);
    const values = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(([value]) => Number(value));

    const [startLeftX, startLeftY] = values;
    const endLeftX = values[6];
    const endLeftY = values[7];
    const endRightX = values[8];
    const endRightY = values[9];
    const startRightX = values[14];
    const startRightY = values[15];

    expect(((startLeftX ?? 0) + (startRightX ?? 0)) / 2).toBe(10);
    expect(startLeftY).toBe(20);
    expect(startRightY).toBe(20);
    expect((startRightX ?? 0) - (startLeftX ?? 0)).toBe(4);
    expect(((endLeftX ?? 0) + (endRightX ?? 0)) / 2).toBe(100);
    expect(endLeftY).toBe(200);
    expect(endRightY).toBe(200);
    expect((endRightX ?? 0) - (endLeftX ?? 0)).toBe(2);
    expect(path.endsWith("Z")).toBe(true);
  });
});
