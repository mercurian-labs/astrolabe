import { describe, expect, it } from "vite-plus/test";
import { centerOn, fitTransform, radiusFor } from "@t3tools/client-runtime/state/plan-map";
import { buildPlanGraph, dagLayout } from "@t3tools/client-runtime/state/plan-graph";
import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { fittedBoundsAreInsideFrame, hitTestNode, shouldShowMinimap } from "./planMap.logic";

const id = (value: string) => MercurianCommitId.make(value);
const commit = (name: string, sequence: number, parents: string[]): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "human",
  text: name,
  createdAt: "2026-08-03T00:00:00.000Z",
});

describe("plan map picking", () => {
  const graph = buildPlanGraph([commit("a", 1, []), commit("b", 2, ["a"])]);
  const layout = dagLayout(graph, { layout: "sugiyama" });
  const transform = { x: 100, y: 80, zoom: 0.3 };
  const first = layout.nodes[0]!;
  const screen = {
    x: first.x * transform.zoom + transform.x,
    y: first.y * transform.zoom + transform.y,
  };

  it("keeps a node with a small drawn disc hittable across a 44pt target", () => {
    expect(radiusFor(graph.byId.get("a")!, { nodeSize: 1 }) * transform.zoom).toBeLessThan(22);
    expect(hitTestNode(graph, layout, transform, { x: screen.x + 22, y: screen.y })).toBe(id("a"));
  });

  it("returns null for empty space at every zoom", () => {
    for (const zoom of [0.3, 1, 3])
      expect(hitTestNode(graph, layout, { x: 0, y: 0, zoom }, { x: 10_000, y: 10_000 })).toBeNull();
  });

  it("resolves overlapping hit targets nearest-first", () => {
    const nearSecond = {
      x: layout.nodes[1]!.x * transform.zoom + transform.x,
      y: layout.nodes[1]!.y * transform.zoom + transform.y - 1,
    };
    expect(hitTestNode(graph, layout, transform, nearSecond)).toBe(id("b"));
  });
});

describe("plan map framing", () => {
  const graph = buildPlanGraph([commit("a", 1, []), commit("b", 2, ["a"]), commit("c", 3, ["b"])]);
  const layout = dagLayout(graph, { layout: "sugiyama" });
  const frame = { x: 0, y: 0, width: 500, height: 700 };

  it("fits the complete layout inside the opening frame padding", () => {
    expect(fittedBoundsAreInsideFrame(layout, frame)).toBe(true);
  });

  it("uses the shared overflow boundary for minimap visibility", () => {
    const fit = fitTransform(layout.bounds, frame);
    expect(shouldShowMinimap(layout, fit, frame, frame)).toBe(false);
    const center = {
      x: (layout.bounds.minX + layout.bounds.maxX) / 2,
      y: (layout.bounds.minY + layout.bounds.maxY) / 2,
    };
    expect(
      shouldShowMinimap(
        layout,
        centerOn(center, { ...fit, zoom: fit.zoom * 2 }, frame),
        frame,
        frame,
      ),
    ).toBe(true);
  });
});
