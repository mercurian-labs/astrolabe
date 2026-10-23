import { describe, expect, it } from "vite-plus/test";

import { indexVault, parseSkillMap, wikilinkTargets } from "./vault.ts";

describe("wikilinkTargets", () => {
  it("strips aliases and headings, reads embeds and path links, and skips code", () => {
    const text = [
      "See [[Memory|the memory]] and [[Threads#Forks]] and ![[Atlas Graph]].",
      "A path: [[research/Control Plane Pivot]]. Twice: [[Memory]].",
      "`[[Not A Link]]` and",
      "```",
      "[[Also Not]]",
      "```",
    ].join("\n");
    expect(wikilinkTargets(text)).toEqual([
      "Memory",
      "Threads",
      "Atlas Graph",
      "Control Plane Pivot",
      "Memory",
    ]);
  });
});

describe("parseSkillMap", () => {
  it("reads typed edges and the vocabulary from frontmatter", () => {
    const lens = parseSkillMap(
      "Product.skillmap.md",
      [
        "---",
        "name: Product",
        "types:",
        "  contains: The destination is a part of the source.",
        "edges:",
        "  - { from: Mercurian, type: contains, to: Memory, rationale: Declared. }",
        '  - { from: Memory, type: contains, to: Threads, rationale: "A: quoted." }',
        "  - { from: Broken }",
        "---",
        "Body text.",
      ].join("\n"),
    );
    expect(lens.name).toBe("Product");
    expect(lens.types).toEqual({ contains: "The destination is a part of the source." });
    expect(lens.edges).toEqual([
      { from: "Mercurian", type: "contains", to: "Memory", rationale: "Declared." },
      { from: "Memory", type: "contains", to: "Threads", rationale: "A: quoted." },
    ]);
  });
});

describe("indexVault", () => {
  const memory = indexVault("test", [
    { fileName: "Memory.md", text: "[[Threads]] [[threads]] [[Red Link]] [[Memory]]" },
    { fileName: "Threads.md", text: "[[Memory]]", lastChanged: "2026-09-20" },
    { fileName: "Alone.md", text: "No links." },
    { fileName: "AGENTS.md", text: "[[Memory]]" },
    {
      fileName: "Map.skillmap.md",
      text: "---\nname: Map\ntypes: { informs: x }\nedges:\n  - { from: memory, type: informs, to: Elsewhere }\n---\n",
    },
  ]);

  it("makes one note per file and a frontier note per red link, skipping skill maps and instructions", () => {
    expect(memory.notes.map((note) => [note.name, note.frontier])).toEqual([
      ["Alone", false],
      ["Elsewhere", true],
      ["Memory", false],
      ["Red Link", true],
      ["Threads", false],
    ]);
    expect(memory.notes.find((note) => note.id === "Threads")?.lastChanged).toBe("2026-09-20");
  });

  it("resolves links ignoring case, dedupes them, and drops self-links", () => {
    expect(memory.links).toEqual([
      { from: "Memory", to: "Red Link" },
      { from: "Memory", to: "Threads" },
      { from: "Threads", to: "Memory" },
    ]);
  });

  it("resolves lens edges to the notes they name", () => {
    expect(memory.lenses).toEqual([
      {
        name: "Map",
        types: { informs: "x" },
        edges: [{ from: "Memory", type: "informs", to: "Elsewhere" }],
      },
    ]);
  });
});
