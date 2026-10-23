import { describe, expect, it } from "vite-plus/test";

import { lensPlacement, mapsPlacing } from "./lenses.ts";
import { pairKey, type MemoryLens } from "./memory.ts";

const lenses: ReadonlyArray<MemoryLens> = [
  {
    name: "Decisions",
    types: { informs: "Supplies context." },
    edges: [{ from: "Memory", type: "informs", to: "Skill Maps" }],
  },
  {
    name: "Product",
    types: { contains: "A part of." },
    edges: [
      { from: "Mercurian", type: "contains", to: "Memory" },
      { from: "Memory", type: "contains", to: "Skill Maps" },
    ],
  },
];

describe("lensPlacement", () => {
  it("places nothing while no lens is on", () => {
    const placement = lensPlacement(lenses, []);
    expect(placement.noteSlot.size).toBe(0);
    expect(placement.edgeSlot.size).toBe(0);
  });

  it("shows several lenses at once, the first lens tinting what both place", () => {
    const placement = lensPlacement(lenses, [1, 0]);
    expect(placement.noteSlot.get("Memory")).toBe(0);
    expect(placement.noteSlot.get("Mercurian")).toBe(1);
    const shared = pairKey("Memory", "Skill Maps");
    expect(placement.edgeSlot.get(shared)).toBe(0);
    expect(placement.edgeNames.get(shared)?.map((name) => [name.lens, name.type])).toEqual([
      ["Decisions", "informs"],
      ["Product", "contains"],
    ]);
    expect(placement.edgeNames.get(shared)?.[1]?.meaning).toBe("A part of.");
  });

  it("names the maps that place a note, shown or not", () => {
    expect(mapsPlacing(lenses, "Skill Maps")).toEqual(["Decisions", "Product"]);
    expect(mapsPlacing(lenses, "Mercurian")).toEqual(["Product"]);
    expect(mapsPlacing(lenses, "Threads")).toEqual([]);
  });
});
