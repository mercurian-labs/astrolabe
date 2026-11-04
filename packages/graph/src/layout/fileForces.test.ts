import { describe, expect, it } from "vite-plus/test";

import type { FileGraphData, FileGraphNode } from "../model/fileGraph.ts";
import { DEFAULT_FILE_GRAPH_SETTINGS } from "../model/fileGraphSettings.ts";
import { FileForces, seededPoint, type Point } from "./fileForces.ts";

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

/**
 * `count` open clusters as a definitions graph has them: hubs that use each other, each spoke used
 * from the next cluster's hub, and a loose file.
 */
function clusters(count: number, size: number): FileGraphData {
  const ids = Array.from({ length: count }, (_, at) => `c${at}`);
  return {
    roots: [],
    nodes: [
      node("loose"),
      ...ids.flatMap((cluster) =>
        Array.from({ length: size }, (_, at) => ({ ...node(`${cluster}#${at}`), cluster })),
      ),
    ],
    links: ids.flatMap((cluster, at) => [
      { from: "loose", to: `${cluster}#0`, guessed: false },
      { from: `${cluster}#0`, to: `c${(at + 7) % count}#0`, guessed: false },
      ...Array.from({ length: size - 1 }, (_, spoke) => ({
        from: `c${(at + 1) % count}#0`,
        to: `${cluster}#${spoke + 1}`,
        guessed: false,
      })),
    ]),
    clusters: ids.map((id) => ({ id, name: id, parent: null, root: false })),
  };
}

/** Each cluster's middle and the reach of its nodes. */
function discs(graph: FileGraphData, forces: FileForces) {
  return (graph.clusters ?? []).map((cluster) => {
    const held = graph.nodes.flatMap((each) =>
      each.cluster === cluster.id ? (forces.positionOf(each.id) ?? []) : [],
    );
    const x = held.reduce((sum, at) => sum + at.x, 0) / held.length;
    const y = held.reduce((sum, at) => sum + at.y, 0) / held.length;
    return { x, y, radius: Math.max(...held.map((at) => distance(at, { x, y }))) };
  });
}

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

  it("hold open clusters to their size however many there are, shown whole or grown in place", () => {
    for (const count of [12, 37, 78]) {
      const graph = clusters(count, 6);
      const whole = new FileForces(graph, DEFAULT_FILE_GRAPH_SETTINGS);
      whole.settle();
      // A new level's nodes all start around where their files stood.
      const grown = new FileForces(graph, DEFAULT_FILE_GRAPH_SETTINGS, (id) => {
        const [x, y] = seededPoint(id, 24);
        return { x, y };
      });
      grown.reheat(0.5);
      let ticks = 0;
      while (grown.step() && ticks < 1000) ticks += 1;
      expect(grown.moving).toBe(false);
      for (const forces of [whole, grown]) {
        const reach = forces.positions().map((at) => Math.max(Math.abs(at.x), Math.abs(at.y)));
        expect(Math.max(...reach)).toBeLessThan(200 * Math.sqrt(count));
        expect(Math.max(...discs(graph, forces).map((disc) => disc.radius))).toBeLessThan(250);
        // No disc rests on another, and the loose file rests outside them all.
        const placed = discs(graph, forces);
        for (const [at, disc] of placed.entries()) {
          for (const other of placed.slice(at + 1)) {
            expect(distance(disc, other)).toBeGreaterThan(disc.radius + other.radius);
          }
          expect(distance(forces.positionOf("loose"), disc)).toBeGreaterThan(disc.radius);
        }
      }
    }
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
