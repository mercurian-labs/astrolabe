import { describe, expect, it } from "vite-plus/test";

import {
  fileGraphLayout,
  fileGraphRings,
  fileGraphUniverse,
  fileGraphView,
  type FileGraphData,
  type FileGraphNode,
} from "./fileGraph.ts";
import { NodeShape, nodeShape } from "./kinds.ts";
import { Emphasis } from "./view.ts";

const node = (id: string, extra: Partial<FileGraphNode> = {}): FileGraphNode => ({
  id,
  name: id.slice(id.lastIndexOf("/") + 1),
  kind: "file",
  changed: false,
  files: null,
  ...extra,
});

const link = (from: string, to: string) => ({ from, to, guessed: false });

/** `app.ts` imports `a.ts` (which imports `a1.ts`) and `b.ts`; `main.ts` and `test.ts` import it. */
const GRAPH: FileGraphData = {
  center: "app.ts",
  nodes: [
    node("app.ts"),
    node("a.ts"),
    node("a1.ts"),
    node("b.ts"),
    node("main.ts"),
    node("test.ts"),
  ],
  links: [
    link("app.ts", "a.ts"),
    link("a.ts", "a1.ts"),
    link("app.ts", "b.ts"),
    link("main.ts", "app.ts"),
    link("test.ts", "app.ts"),
  ],
};

function positions(graph: FileGraphData) {
  const universe = fileGraphUniverse(graph);
  const layout = fileGraphLayout(universe, graph);
  const at = (id: string) => {
    const index = universe.indexOf.get(id) ?? -1;
    return {
      x: layout.positions[index * 3] ?? Number.NaN,
      y: layout.positions[index * 3 + 1] ?? Number.NaN,
    };
  };
  return { layout, at };
}

describe("a file graph's rings", () => {
  it("put what the centre uses on one side and what uses it on the other, by links away", () => {
    const rings = fileGraphRings(GRAPH);
    expect(rings.get("a.ts")).toMatchObject({ side: "uses", depth: 1, parent: "app.ts" });
    expect(rings.get("a1.ts")).toMatchObject({ side: "uses", depth: 2, parent: "a.ts" });
    expect(rings.get("main.ts")).toMatchObject({ side: "usedBy", depth: 1, parent: "app.ts" });
    expect(rings.has("app.ts")).toBe(false);
  });

  it("place a file both ways at its nearer side, and one neither way reaches outermost", () => {
    const rings = fileGraphRings({
      center: "app.ts",
      nodes: [node("app.ts"), node("both.ts"), node("far.ts"), node("loose.ts")],
      links: [
        link("app.ts", "both.ts"),
        link("both.ts", "far.ts"),
        link("far.ts", "app.ts"),
        link("loose.ts", "far.ts"),
      ],
    });
    // far.ts is two links along imports but one against them.
    expect(rings.get("far.ts")).toMatchObject({ side: "usedBy", depth: 1 });
    expect(rings.get("both.ts")).toMatchObject({ side: "uses", depth: 1 });
    expect(rings.get("loose.ts")).toMatchObject({ side: "usedBy", depth: 2 });
  });
});

describe("a file graph's layout", () => {
  it("centres the file, its uses to the right, its users to the left, each ring further out", () => {
    const { at, layout } = positions(GRAPH);
    expect(at("app.ts")).toEqual({ x: 0, y: 0 });
    for (const id of ["a.ts", "b.ts", "a1.ts"]) expect(at(id).x).toBeGreaterThan(0);
    for (const id of ["main.ts", "test.ts"]) expect(at(id).x).toBeLessThan(0);
    expect(Math.hypot(at("a1.ts").x, at("a1.ts").y)).toBeGreaterThan(
      Math.hypot(at("a.ts").x, at("a.ts").y),
    );
    expect(layout.radius).toBeCloseTo(Math.hypot(at("a1.ts").x, at("a1.ts").y), 3);
  });

  it("keeps a ring's order by where its parents sit, so links fan out without crossing", () => {
    const graph: FileGraphData = {
      center: "app.ts",
      nodes: ["app.ts", "a.ts", "b.ts", "z.ts", "c.ts"].map((id) => node(id)),
      // c.ts sorts before z.ts by name, but a's child belongs on a's side of b's.
      links: [
        link("app.ts", "a.ts"),
        link("app.ts", "b.ts"),
        link("a.ts", "z.ts"),
        link("b.ts", "c.ts"),
      ],
    };
    const { at } = positions(graph);
    expect(at("a.ts").y > at("b.ts").y).toBe(at("z.ts").y > at("c.ts").y);
  });

  it("moves a crowded ring out until its files stand apart", () => {
    const leaves = Array.from({ length: 60 }, (_, index) => `leaf-${index}.ts`);
    const graph: FileGraphData = {
      center: "app.ts",
      nodes: [node("app.ts"), ...leaves.map((id) => node(id))],
      links: leaves.map((id) => link("app.ts", id)),
    };
    const { at } = positions(graph);
    let nearest = Infinity;
    for (const [index, left] of leaves.entries()) {
      for (const right of leaves.slice(index + 1)) {
        nearest = Math.min(nearest, Math.hypot(at(left).x - at(right).x, at(left).y - at(right).y));
      }
    }
    expect(nearest).toBeGreaterThan(20);
  });
});

describe("a file graph's view", () => {
  it("shows every file and link, the centre in front, and marks what each node is", () => {
    const graph: FileGraphData = {
      center: "app.ts",
      nodes: [
        node("app.ts"),
        node("changed.ts", { changed: true }),
        node("@acme/ui", { kind: "package", name: "@acme/ui" }),
        node("dependency:react", { kind: "dependency", name: "react" }),
        node("src/lib", { kind: "folder", name: "lib", files: 12 }),
      ],
      links: [
        link("app.ts", "changed.ts"),
        link("app.ts", "@acme/ui"),
        link("app.ts", "dependency:react"),
        link("app.ts", "src/lib"),
      ],
    };
    const universe = fileGraphUniverse(graph);
    const view = fileGraphView(universe, graph);
    const at = (id: string) => view.nodeAt.get(universe.indexOf.get(id) ?? -1) ?? -1;
    expect(view.shownNodes).toBe(5);
    expect(view.shownEdges).toBe(4);
    expect(view.focus?.index).toBe(universe.indexOf.get("app.ts"));
    expect(view.nodeEmphasis[at("app.ts")]).toBe(Emphasis.picked);
    expect(view.nodeEmphasis[at("dependency:react")]).toBeLessThan(Emphasis.whole);
    expect(view.nodeGlow[at("changed.ts")]).toBe(1);
    expect(view.nodeGlow[at("app.ts")]).toBe(0);
    expect(view.nodeCount?.[at("src/lib")]).toBe("12 files");
    const shape = (id: string) => nodeShape(universe.nodes[universe.indexOf.get(id) ?? -1] ?? {});
    expect(shape("changed.ts")).toBe(NodeShape.circle);
    expect(shape("@acme/ui")).toBe(NodeShape.square);
    expect(shape("src/lib")).toBe(NodeShape.container);
  });

  it("is a new universe for each graph handed over, never one grown from the last", () => {
    const again: FileGraphData = { ...GRAPH };
    expect(fileGraphUniverse(again).key).not.toBe(fileGraphUniverse(GRAPH).key);
    expect(fileGraphUniverse(GRAPH).key).toBe(fileGraphUniverse(GRAPH).key);
  });
});
