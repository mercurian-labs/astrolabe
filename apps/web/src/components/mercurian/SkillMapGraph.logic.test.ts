import { describe, expect, it } from "vite-plus/test";
import { graphStratify } from "d3-dag";

import type { MemoryMap } from "@t3tools/contracts";

import { layoutSkillMapGraph, prepareSkillMapGraph } from "./SkillMapGraph.logic";

const map = (edges: MemoryMap["edges"]): MemoryMap => ({
  file: "System.skillmap.md",
  name: "System",
  purpose: "Relationships",
  types: [{ name: "relates", meaning: "The notes are related." }],
  edges,
  body: "",
});

describe("prepareSkillMapGraph", () => {
  it("removes DFS feedback edges so d3-dag accepts the acyclic remainder", () => {
    const prepared = prepareSkillMapGraph(
      map([
        { from: "A", type: "relates", to: "B" },
        { from: "B", type: "relates", to: "C" },
        { from: "C", type: "relates", to: "A" },
        { from: "C", type: "relates", to: "D" },
      ]),
    );
    expect(prepared.feedbackEdges).toEqual([{ from: "C", type: "relates", to: "A" }]);
    expect(() =>
      graphStratify()
        .id((node: (typeof prepared.nodes)[number]) => node.name)
        .parentIds((node: (typeof prepared.nodes)[number]) => node.parents)(prepared.nodes),
    ).not.toThrow();
  });

  it("treats a self edge as feedback and retains ordinary repeated edges", () => {
    const prepared = prepareSkillMapGraph(
      map([
        { from: "A", type: "relates", to: "A" },
        { from: "A", type: "relates", to: "B" },
        { from: "A", type: "relates", to: "B" },
      ]),
    );
    expect(prepared.feedbackEdges).toEqual([{ from: "A", type: "relates", to: "A" }]);
    expect(prepared.layoutEdges).toHaveLength(2);
    expect(layoutSkillMapGraph(map(prepared.layoutEdges)).nodes).toHaveLength(2);
  });
});
