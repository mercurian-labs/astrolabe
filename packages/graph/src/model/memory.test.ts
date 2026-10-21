import { describe, expect, it } from "vite-plus/test";

import { indexMemory, localGraph, neighborsOf, pairKey } from "./memory.ts";

const notes = ["a", "b", "c", "d", "red", "lonely"].map((id) => ({
  id,
  name: id,
  frontier: id === "red",
}));
const index = indexMemory(notes, [
  { from: "a", to: "b" },
  { from: "b", to: "a" },
  { from: "b", to: "c" },
  { from: "c", to: "d" },
  { from: "a", to: "red" },
  { from: "a", to: "a" },
  { from: "a", to: "missing" },
]);

describe("indexMemory", () => {
  it("draws one pair per linked pair and keeps which directions exist", () => {
    expect(index.pairs).toHaveLength(4);
    expect(index.pairByKey.get(pairKey("b", "a"))).toMatchObject({
      a: "a",
      b: "b",
      forward: true,
      backward: true,
    });
    expect(index.pairByKey.get(pairKey("c", "b"))).toMatchObject({
      forward: true,
      backward: false,
    });
  });

  it("sizes by distinct linked notes, either direction", () => {
    expect(index.degree.get("a")).toBe(2);
    expect(index.degree.get("b")).toBe(2);
    expect(index.degree.get("red")).toBe(1);
  });

  it("keeps frontier notes, and finds orphans", () => {
    expect(index.byId.get("red")?.frontier).toBe(true);
    expect([...index.orphans]).toEqual(["lonely"]);
  });
});

describe("localGraph", () => {
  it("reaches as far as the depth, seeds included", () => {
    const neighbors = (id: string) => neighborsOf(index, id);
    expect([...localGraph(neighbors, ["a"], 1)].toSorted()).toEqual(["a", "b", "red"]);
    expect([...localGraph(neighbors, ["a"], 2)].toSorted()).toEqual(["a", "b", "c", "red"]);
    expect([...localGraph(neighbors, ["a"], 0)]).toEqual(["a"]);
  });
});
