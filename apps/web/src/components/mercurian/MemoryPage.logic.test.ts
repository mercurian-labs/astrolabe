import { describe, expect, it } from "vite-plus/test";

import {
  buildSkillMapTree,
  initialMemorySelection,
  memoryMapTeachingLinks,
  memoryPageStanding,
  memoryRailItems,
  skillMapIsForest,
  skillMapView,
  writeNoteSeedMessage,
} from "./MemoryPage.logic";

import type { MemoryMap } from "@t3tools/contracts";

const map = (edges: MemoryMap["edges"], view?: MemoryMap["view"]): MemoryMap => ({
  file: "Product.skillmap.md",
  name: "Product",
  purpose: "Structure",
  types: [
    { name: "contains", meaning: "Child territory." },
    { name: "depends-on", meaning: "Needed by the source." },
  ],
  edges,
  ...(view === undefined ? {} : { view }),
  body: "Teach with [[Specs]] and [[Future|future work]].",
});

const index = {
  maps: [{ file: "maps/z.yaml", refusal: "maps/z.yaml: bad arrangement" }, map([])],
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
      ["map", "map:Product.skillmap.md"],
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

describe("writeNoteSeedMessage", () => {
  it("seeds the amendment message with the note's references", () => {
    expect(writeNoteSeedMessage("Workspaces", ["Repositories", "Settings"])).toBe(
      "Write [[Workspaces]] — it's referenced by Repositories and Settings. Propose it as a memory amendment.",
    );
  });

  it("stays terse for a note nothing references yet", () => {
    expect(writeNoteSeedMessage("Future Design", [])).toBe(
      "Write [[Future Design]]. Propose it as a memory amendment.",
    );
  });
});

describe("skill-map views", () => {
  const forest = map([
    { from: "Product", type: "contains", to: "Composer" },
    { from: "Product", type: "contains", to: "Plans" },
    { from: "Other", type: "depends-on", to: "Zed" },
  ]);

  it("derives tree for forests and graph for shared children and cycles", () => {
    expect(skillMapIsForest(forest)).toBe(true);
    expect(skillMapView(forest)).toBe("tree");
    expect(
      skillMapView(
        map([
          { from: "A", type: "contains", to: "C" },
          { from: "B", type: "contains", to: "C" },
        ]),
      ),
    ).toBe("graph");
    expect(
      skillMapView(
        map([
          { from: "A", type: "contains", to: "B" },
          { from: "B", type: "contains", to: "A" },
        ]),
      ),
    ).toBe("graph");
  });

  it("honors declared view overrides in both directions", () => {
    expect(skillMapView(map(forest.edges, "graph"))).toBe("graph");
    expect(
      skillMapView(
        map(
          [
            { from: "A", type: "contains", to: "B" },
            { from: "B", type: "contains", to: "A" },
          ],
          "tree",
        ),
      ),
    ).toBe("tree");
  });

  it("builds roots and siblings in file order while retaining edge types", () => {
    expect(buildSkillMapTree(forest)).toEqual([
      {
        key: "root:Product",
        name: "Product",
        children: [
          {
            key: "root:Product/edge:0:Composer",
            name: "Composer",
            edgeType: "contains",
            children: [],
          },
          {
            key: "root:Product/edge:1:Plans",
            name: "Plans",
            edgeType: "contains",
            children: [],
          },
        ],
      },
      {
        key: "root:Other",
        name: "Other",
        children: [
          {
            key: "root:Other/edge:2:Zed",
            name: "Zed",
            edgeType: "depends-on",
            children: [],
          },
        ],
      },
    ]);
  });

  it("resolves teaching links against written notes", () => {
    expect(
      memoryMapTeachingLinks(forest, { notes: [{ name: "Specs", path: "Specs.md" }] }),
    ).toEqual([
      { name: "Specs", exists: true },
      { name: "Future", exists: false },
    ]);
  });
});
