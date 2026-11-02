import { describe, expect, it } from "vite-plus/test";

import type { FileGraphData, FileGraphNode } from "../model/fileGraph.ts";
import { DEFAULT_FILE_GRAPH_SETTINGS } from "../model/fileGraphSettings.ts";
import { FileForces, type Point } from "./fileForces.ts";

const node = (id: string): FileGraphNode => ({
  id,
  name: id,
  kind: "file",
  changed: false,
  test: false,
  files: null,
  group: null,
});

/** A centre file with eight neighbours, two of which import each other. */
const GRAPH: FileGraphData = {
  roots: ["c"],
  nodes: ["c", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"].map(node),
  links: [
    ...["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"].map((id) => ({
      from: "c",
      to: id,
      guessed: false,
    })),
    { from: "n1", to: "n2", guessed: false },
  ],
};

const settled = () => {
  const forces = new FileForces(GRAPH, DEFAULT_FILE_GRAPH_SETTINGS);
  forces.settle();
  return forces;
};
const distance = (a: Point | null, b: Point | null) =>
  a === null || b === null ? Number.NaN : Math.hypot(a.x - b.x, a.y - b.y);

describe("a file graph's forces", () => {
  it("settle into rest, the centre's links near the link distance, and the same every time", () => {
    const forces = settled();
    expect(forces.moving).toBe(false);
    expect(forces.step()).toBe(false);
    for (const id of ["n3", "n4", "n5"]) {
      const length = distance(forces.positionOf("c"), forces.positionOf(id));
      expect(length).toBeGreaterThan(DEFAULT_FILE_GRAPH_SETTINGS.linkDistance * 0.6);
      expect(length).toBeLessThan(DEFAULT_FILE_GRAPH_SETTINGS.linkDistance * 1.6);
    }
    expect(settled().positions()).toEqual(forces.positions());
  });

  it("stop moving on their own after a warm-up, well before a full cooling", () => {
    const forces = settled();
    forces.reheat(0.3);
    let ticks = 0;
    while (forces.step()) ticks += 1;
    // Near its rest already, it stops once nothing moves, long before it cools from 0.3 (~180 ticks).
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(100);
    expect(forces.moving).toBe(false);
  });

  it("keep a dragged node where it is held and stay warm until it is let go", () => {
    const forces = settled();
    const held = { x: 400, y: -250 };
    forces.drag("n4", held);
    for (let tick = 0; tick < 400; tick += 1) expect(forces.step()).toBe(true);
    expect(forces.positionOf("n4")).toEqual(held);
    // Its neighbour followed it some way.
    expect(distance(forces.positionOf("c"), held)).toBeLessThan(distance({ x: 0, y: 0 }, held));
    forces.release("n4");
    let ticks = 0;
    while (forces.step() && ticks < 1000) ticks += 1;
    expect(forces.moving).toBe(false);
    expect(ticks).toBeLessThan(1000);
  });

  it("start a node where the last picture had it, and a new one beside a placed neighbour", () => {
    const before = settled();
    const grown: FileGraphData = {
      ...GRAPH,
      nodes: [...GRAPH.nodes, node("n9")],
      links: [...GRAPH.links, { from: "n3", to: "n9", guessed: false }],
    };
    const after = new FileForces(grown, DEFAULT_FILE_GRAPH_SETTINGS, (id) => before.positionOf(id));
    expect(after.positionOf("n5")).toEqual(before.positionOf("n5"));
    expect(distance(after.positionOf("n9"), before.positionOf("n3"))).toBeLessThan(
      DEFAULT_FILE_GRAPH_SETTINGS.linkDistance,
    );
  });

  it("spread wider with a longer link distance", () => {
    const near = settled();
    const far = new FileForces(GRAPH, { ...DEFAULT_FILE_GRAPH_SETTINGS, linkDistance: 300 });
    far.settle();
    expect(distance(far.positionOf("c"), far.positionOf("n5"))).toBeGreaterThan(
      distance(near.positionOf("c"), near.positionOf("n5")) * 1.5,
    );
  });
});
