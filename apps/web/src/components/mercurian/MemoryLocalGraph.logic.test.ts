import type { MemoryLocalGraph } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  layoutMemoryLocalGraph,
  MEMORY_GRAPH_NODE_SIZE,
  memoryGraphComponents,
  memoryGraphEdgeStatusLabel,
  projectMemoryGraphLayout,
} from "./MemoryLocalGraph.logic";
import { MEMORY_FIXTURE_DASHBOARD } from "./MemoryTab.fixtures";
import { memoryGraphStructureKey } from "./MemoryTab.logic";

const graph: MemoryLocalGraph = MEMORY_FIXTURE_DASHBOARD.graph;

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
