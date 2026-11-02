import { describe, expect, it } from "vite-plus/test";

import {
  fileGraphDegrees,
  fileGraphSignature,
  fileGraphStructure,
  neighbourhood,
  nodeLabel,
  type FileGraphData,
  type FileGraphNode,
} from "./fileGraph.ts";

const node = (id: string, extra: Partial<FileGraphNode> = {}): FileGraphNode => ({
  id,
  name: id.slice(id.lastIndexOf("/") + 1),
  kind: "file",
  changed: false,
  test: false,
  files: null,
  group: null,
  ...extra,
});

const link = (from: string, to: string) => ({ from, to, guessed: false });

/** `app.ts` imports `a.ts` (which imports `a1.ts`) and `b.ts`; `main.ts` imports it. */
const GRAPH: FileGraphData = {
  roots: ["app.ts"],
  nodes: ["app.ts", "a.ts", "a1.ts", "b.ts", "main.ts"].map((id) => node(id)),
  links: [
    link("app.ts", "a.ts"),
    link("a.ts", "a1.ts"),
    link("app.ts", "b.ts"),
    link("main.ts", "app.ts"),
  ],
};

describe("a file graph", () => {
  it("counts each node's links either way, never a link to itself", () => {
    const degrees = fileGraphDegrees({ ...GRAPH, links: [...GRAPH.links, link("b.ts", "b.ts")] });
    expect(Object.fromEntries(degrees)).toEqual({
      "app.ts": 3,
      "a.ts": 2,
      "a1.ts": 1,
      "b.ts": 1,
      "main.ts": 1,
    });
  });

  it("lights a node and what it links to either way, and nothing further", () => {
    expect([...neighbourhood(GRAPH, "a.ts")].toSorted()).toEqual(["a.ts", "a1.ts", "app.ts"]);
    expect([...neighbourhood(GRAPH, "app.ts")].toSorted()).toEqual([
      "a.ts",
      "app.ts",
      "b.ts",
      "main.ts",
    ]);
  });

  it("lays out the same when only how a node looks changes, and draws differently", () => {
    const tinted: FileGraphData = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((each) => (each.id === "b.ts" ? { ...each, group: 2 } : each)),
    };
    expect(fileGraphStructure(tinted)).toBe(fileGraphStructure(GRAPH));
    expect(fileGraphSignature(tinted)).not.toBe(fileGraphSignature(GRAPH));
    const narrowed: FileGraphData = {
      ...GRAPH,
      nodes: GRAPH.nodes.filter((each) => each.id !== "main.ts"),
      links: GRAPH.links.filter((each) => each.from !== "main.ts"),
    };
    expect(fileGraphStructure(narrowed)).not.toBe(fileGraphStructure(GRAPH));
  });

  it("names a folded folder with its file count", () => {
    expect(nodeLabel(node("src/ui", { kind: "folder", files: 7 }))).toBe("ui · 7");
    expect(nodeLabel(node("src/ui", { kind: "folder" }))).toBe("ui");
    expect(nodeLabel(node("src/app.ts"))).toBe("app.ts");
  });
});
