import { describe, expect, it } from "vite-plus/test";

import type { MemoryMap } from "@t3tools/contracts";

import { layoutSkillMapFlow, layoutSkillMapWeb } from "./SkillMapGraph.logic";

const map = (edges: MemoryMap["edges"]): MemoryMap => ({
  file: "System.skillmap.md",
  name: "System",
  purpose: "Relationships",
  types: [{ name: "relates", meaning: "The notes are related." }],
  edges,
  body: "",
});

describe("layoutSkillMapFlow", () => {
  it("lays out an acyclic graph directly with every edge retained", () => {
    const skillMap = map([
      { from: "A", type: "relates", to: "C" },
      { from: "B", type: "relates", to: "C" },
      { from: "C", type: "relates", to: "D" },
    ]);
    const layout = layoutSkillMapFlow(skillMap);
    expect(layout.nodes.map(({ name }) => name).toSorted()).toEqual(["A", "B", "C", "D"]);
    expect(layout.edges.map(({ edge }) => edge)).toEqual(skillMap.edges);
    expect(layout.nodes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});

describe("layoutSkillMapWeb", () => {
  it("produces deterministic, finite, spread positions after fixed synchronous ticks", () => {
    const skillMap = map([
      { from: "A", type: "relates", to: "B" },
      { from: "B", type: "relates", to: "C" },
      { from: "C", type: "relates", to: "A" },
    ]);
    const first = layoutSkillMapWeb(skillMap);
    const second = layoutSkillMapWeb(skillMap);
    expect(second).toEqual(first);
    expect(first.nodes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(new Set(first.nodes.map(({ x, y }) => `${x},${y}`)).size).toBeGreaterThan(1);
    expect(first.edges.map(({ edge }) => edge)).toEqual(skillMap.edges);
  });

  it("retains and positions a self-loop", () => {
    const layout = layoutSkillMapWeb(map([{ from: "A", type: "relates", to: "A" }]));
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toHaveLength(1);
    expect(layout.nodes[0]).toMatchObject({ name: "A" });
  });
});
