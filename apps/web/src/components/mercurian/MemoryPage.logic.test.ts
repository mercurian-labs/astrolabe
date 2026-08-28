import { describe, expect, it } from "vite-plus/test";

import { initialMemorySelection, memoryPageStanding, memoryRailItems } from "./MemoryPage.logic";

const index = {
  maps: [
    { file: "maps/z.yaml", refusal: "maps/z.yaml: bad arrangement" },
    { file: "maps/a.yaml", name: "Product", purpose: "Structure", arrangement: [] },
  ],
  notes: [
    { name: "Specs", path: "Specs.md" },
    { name: "Composer", path: "Composer.md" },
  ],
  unresolved: [{ name: "Future", referencedBy: ["Specs"] }],
  problems: [],
  productMapOffer: null,
} as const;

describe("memoryRailItems", () => {
  it("groups sorted maps, notes, and unresolved references while retaining refusals", () => {
    expect(memoryRailItems(index).map((item) => [item.kind, item.key])).toEqual([
      ["refused-map", "map:maps/z.yaml"],
      ["map", "map:maps/a.yaml"],
      ["note", "note:Composer"],
      ["note", "note:Specs"],
      ["unresolved", "unresolved:Future"],
    ]);
  });

  it("deep-links written and unresolved note names case-insensitively", () => {
    const items = memoryRailItems(index);
    expect(initialMemorySelection(items, "composer")).toBe("note:Composer");
    expect(initialMemorySelection(items, "Future")).toBe("unresolved:Future");
    expect(initialMemorySelection(items, "New idea")).toBe("unresolved:New idea");
  });
});

describe("memoryPageStanding", () => {
  it("distinguishes scope, designation, loading, and ready states", () => {
    expect(memoryPageStanding({ projectId: null, designated: false, index: null })).toBe(
      "no-project",
    );
    expect(memoryPageStanding({ projectId: "p", designated: false, index: null })).toBe(
      "not-designated",
    );
    expect(memoryPageStanding({ projectId: "p", designated: true, index: null })).toBe("loading");
    expect(memoryPageStanding({ projectId: "p", designated: true, index })).toBe("ready");
  });
});
