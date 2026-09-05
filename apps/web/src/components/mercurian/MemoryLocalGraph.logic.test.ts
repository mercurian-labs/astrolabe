import type { MemoryLocalGraph } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { visibleWorldRect, type MapBounds, type MapFrameSize } from "./DagExplorer.logic";
import {
  layoutMemoryLocalGraph,
  MEMORY_GRAPH_FIT,
  MEMORY_GRAPH_MIN_OPENING_ZOOM,
  MEMORY_GRAPH_NODE_SIZE,
  memoryGraphComponents,
  memoryGraphEdgeStatusLabel,
  projectMemoryGraphLayout,
  type MemoryGraphLayout,
} from "./MemoryLocalGraph.logic";
import { MEMORY_FIXTURE_DASHBOARD } from "./MemoryTab.fixtures";
import { memoryGraphStructureKey } from "./MemoryTab.logic";
import {
  fitSpatialMap,
  isAtFit,
  openingSpatialMapTransform,
  spatialMapChromeVisibility,
  spatialMapViewBox,
} from "./SpatialMapCanvas.logic";

const graph: MemoryLocalGraph = MEMORY_FIXTURE_DASHBOARD.graph;

// The Memory right panel at a 390px-wide phone: 48px of gutter leaves a 284px graph frame.
const NARROW_FRAME: MapFrameSize = { width: 284, height: 288 };
const WIDE_FRAME: MapFrameSize = { width: 560, height: 288 };
const LABEL_PX = 12;
const READABLE_PX = 11;

const layoutBounds = (layout: MemoryGraphLayout): MapBounds => ({
  minX: 0,
  minY: 0,
  maxX: layout.width,
  maxY: layout.height,
});

const nodesInView = (layout: MemoryGraphLayout, view: MapBounds, whole: boolean) =>
  layout.nodes.filter((node) => {
    const halfWidth = whole ? MEMORY_GRAPH_NODE_SIZE.width / 2 : 0;
    const halfHeight = whole ? MEMORY_GRAPH_NODE_SIZE.height / 2 : 0;
    return (
      node.x - halfWidth >= view.minX &&
      node.x + halfWidth <= view.maxX &&
      node.y - halfHeight >= view.minY &&
      node.y + halfHeight <= view.maxY
    );
  });

const FOUR_NOTES: MemoryLocalGraph = {
  nodes: [
    { id: "a", name: "Composer" },
    { id: "b", name: "Threads" },
    { id: "c", name: "Isolate" },
    { id: "d", name: "Former" },
  ],
  edges: [
    { from: "a", to: "b", status: "unchanged" },
    { from: "b", to: "a", status: "added" },
    { from: "c", to: "a", status: "removed" },
  ],
  outsideReferences: [],
};

describe("layoutMemoryLocalGraph", () => {
  it("places every node, including isolates and a self-link, inside finite bounds", () => {
    const layout = layoutMemoryLocalGraph(graph);
    expect(layout.nodes.map(({ id }) => id).toSorted()).toEqual(
      graph.nodes.map(({ id }) => id).toSorted(),
    );
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(MEMORY_GRAPH_NODE_SIZE.width / 2);
      expect(node.y).toBeGreaterThanOrEqual(MEMORY_GRAPH_NODE_SIZE.height / 2);
      expect(node.x).toBeLessThanOrEqual(layout.width);
      expect(node.y).toBeLessThanOrEqual(layout.height);
    }
    expect(layout.edges.map(({ id }) => id)).toEqual([
      "doc-composer>doc-drafts",
      "doc-drafts>doc-composer",
      "doc-glossary>doc-composer",
      "doc-plans>doc-plans",
    ]);
    const selfLink = layout.edges.find((edge) => edge.from === edge.to)!;
    expect(selfLink.path.startsWith("M ")).toBe(true);
  });

  it("opens four notes at label size in the narrow panel instead of shrinking the whole graph", () => {
    const layout = layoutMemoryLocalGraph(FOUR_NOTES);
    const bounds = layoutBounds(layout);
    // Fitting the whole graph into 284px would render the 12px label below reading size.
    const fitted = fitSpatialMap(bounds, NARROW_FRAME, MEMORY_GRAPH_FIT);
    expect(LABEL_PX * fitted.zoom).toBeLessThan(READABLE_PX);

    const opening = openingSpatialMapTransform(
      bounds,
      NARROW_FRAME,
      MEMORY_GRAPH_FIT,
      MEMORY_GRAPH_MIN_OPENING_ZOOM,
    );
    expect(LABEL_PX * opening.zoom).toBeGreaterThanOrEqual(READABLE_PX);
    const view = visibleWorldRect(opening, spatialMapViewBox(NARROW_FRAME), NARROW_FRAME);
    // Every note's label centre is on screen and at least two notes show whole.
    expect(nodesInView(layout, view, false)).toHaveLength(layout.nodes.length);
    expect(nodesInView(layout, view, true).length).toBeGreaterThanOrEqual(2);
  });

  it("still offers the whole-graph overview through Fit from the narrow opening view", () => {
    const layout = layoutMemoryLocalGraph(FOUR_NOTES);
    const bounds = layoutBounds(layout);
    const opening = openingSpatialMapTransform(
      bounds,
      NARROW_FRAME,
      MEMORY_GRAPH_FIT,
      MEMORY_GRAPH_MIN_OPENING_ZOOM,
    );
    expect(isAtFit(opening, bounds, NARROW_FRAME, 0.001, MEMORY_GRAPH_FIT)).toBe(false);
    expect(
      spatialMapChromeVisibility(opening, bounds, NARROW_FRAME, 0.001, {
        ...MEMORY_GRAPH_FIT,
        minimap: false,
      }),
    ).toEqual({ fitButton: true, minimap: false });
    const fitted = fitSpatialMap(bounds, NARROW_FRAME, MEMORY_GRAPH_FIT);
    const overview = visibleWorldRect(fitted, spatialMapViewBox(NARROW_FRAME), NARROW_FRAME);
    expect(nodesInView(layout, overview, true)).toHaveLength(layout.nodes.length);
  });

  it("keeps the wide-panel opening view as the plain readable fit", () => {
    const layout = layoutMemoryLocalGraph(FOUR_NOTES);
    const bounds = layoutBounds(layout);
    const fitted = fitSpatialMap(bounds, WIDE_FRAME, MEMORY_GRAPH_FIT);
    expect(LABEL_PX * fitted.zoom).toBeGreaterThanOrEqual(READABLE_PX);
    expect(
      openingSpatialMapTransform(
        bounds,
        WIDE_FRAME,
        MEMORY_GRAPH_FIT,
        MEMORY_GRAPH_MIN_OPENING_ZOOM,
      ),
    ).toEqual(fitted);
  });

  it("is deterministic for the same structure and separates overlapping nodes", () => {
    const first = layoutMemoryLocalGraph(graph);
    const second = layoutMemoryLocalGraph(graph);
    expect(second.nodes).toEqual(first.nodes);
    for (const left of first.nodes) {
      for (const right of first.nodes) {
        if (left.id === right.id) continue;
        expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThan(
          MEMORY_GRAPH_NODE_SIZE.height,
        );
      }
    }
  });

  it("keeps edge status as a spoken label and drops edges to unknown nodes", () => {
    expect(memoryGraphEdgeStatusLabel("added")).toBe("link added");
    expect(memoryGraphEdgeStatusLabel("removed")).toBe("link removed");
    const layout = layoutMemoryLocalGraph({
      nodes: [{ id: "a", name: "A" }],
      edges: [{ from: "a", to: "missing", status: "added" }],
      outsideReferences: [],
    });
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toEqual([]);
    expect(layoutMemoryLocalGraph({ nodes: [], edges: [], outsideReferences: [] })).toEqual({
      width: 0,
      height: 0,
      nodes: [],
      edges: [],
    });
  });
});

describe("projectMemoryGraphLayout", () => {
  it("keeps cached coordinates while taking current names and link statuses", () => {
    const geometry = layoutMemoryLocalGraph(graph);
    const refreshed: MemoryLocalGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === "doc-composer" ? { ...node, name: "Composer (renamed)" } : node,
      ),
      edges: graph.edges.map((edge) =>
        edge.from === "doc-composer" && edge.to === "doc-drafts"
          ? { ...edge, status: "removed" }
          : edge,
      ),
    };
    expect(memoryGraphStructureKey(refreshed)).toBe(memoryGraphStructureKey(graph));

    const projected = projectMemoryGraphLayout(geometry, refreshed);
    expect(projected.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      geometry.nodes.map(({ id, x, y }) => ({ id, x, y })),
    );
    expect(projected.nodes.find(({ id }) => id === "doc-composer")?.name).toBe(
      "Composer (renamed)",
    );
    expect(projected.edges.map(({ id, path }) => ({ id, path }))).toEqual(
      geometry.edges.map(({ id, path }) => ({ id, path })),
    );
    expect(projected.edges.find(({ id }) => id === "doc-composer>doc-drafts")?.status).toBe(
      "removed",
    );
    expect(projected.edges.find(({ id }) => id === "doc-drafts>doc-composer")?.status).toBe(
      "unchanged",
    );
    // Untouched entries keep their identity, so memoized render nodes stay stable.
    expect(projected.nodes.find(({ id }) => id === "doc-plans")).toBe(
      geometry.nodes.find(({ id }) => id === "doc-plans"),
    );
  });
});

describe("memoryGraphComponents", () => {
  it("lists disconnected components and cycles without losing isolates", () => {
    expect(memoryGraphComponents(graph)).toEqual([
      ["doc-composer", "doc-drafts", "doc-glossary"],
      ["doc-plans"],
      ["doc-workspaces"],
    ]);
  });
});
