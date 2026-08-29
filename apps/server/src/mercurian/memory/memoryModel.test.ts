import { describe, expect, it } from "vite-plus/test";

import { isProductMapCycleError } from "@t3tools/contracts";

import {
  buildMemoryGraph,
  compileProductMap,
  fingerprintMemoryFiles,
  insertMapPlacement,
  isValidMemoryNoteName,
  missingOpenDecisionHeadings,
  parseAndValidateMemoryMap,
  parseContainsLines,
  parseOpenDecisions,
  parseWikilinks,
  serializeMemoryMap,
} from "./memoryModel.ts";

const note = (name: string, markdown: string, path = `${name}.md`) => ({ name, markdown, path });
const validHeader = `name: Product\npurpose: Product structure\n`;

describe("memoryModel", () => {
  it("parses aliases while excluding fenced and inline code", () => {
    expect(
      parseWikilinks(
        "See [[Plans|the plans]]. `[[Inline]]`\n```md\n[[Fenced]]\n```\nAnd [[Composer]].",
      ),
    ).toEqual(["Plans", "Composer"]);
  });

  it("derives backlinks and unresolved references", () => {
    const graph = buildMemoryGraph([
      note("Plans", "See [[Composer]] and [[Unwritten]]."),
      note("Composer", "Back to [[Plans]]."),
    ]);
    expect(graph.backlinks.get("Composer")).toEqual(["Plans"]);
    expect(graph.backlinks.get("Plans")).toEqual(["Composer"]);
    expect(graph.unresolved).toEqual([{ name: "Unwritten", referencedBy: ["Plans"] }]);
  });

  it("extracts contains declarations only at line start", () => {
    expect(
      parseContainsLines(
        "Product",
        "contains:: [[Plans]], [[Composer|composer]]\n contains:: [[No]]",
      ),
    ).toEqual([
      { parent: "Product", child: "Plans" },
      { parent: "Product", child: "Composer" },
    ]);
  });

  it("parses open decisions, resolutions, and ignores code", () => {
    expect(
      parseOpenDecisions(
        "## Open Decisions\n### Keep it?\nTBD\n### Done?\n**Resolved:** Yes\n```md\n### Fake\n**Resolved**\n```\n## Later\n### Outside",
      ),
    ).toEqual([
      { title: "Keep it?", resolved: false },
      { title: "Done?", resolved: true },
    ]);
    expect(parseOpenDecisions("## Other\n### None")).toEqual([]);
  });

  it("detects deleted open-decision headings but permits appended resolutions", () => {
    const before = "## Open Decisions\n### Which shape?\nStill open.\n";
    expect(missingOpenDecisionHeadings(before, "## Open Decisions\n")).toEqual(["Which shape?"]);
    expect(
      missingOpenDecisionHeadings(before, `${before}\n**Resolved:** The small one.\n`),
    ).toEqual([]);
  });

  it.each(["", " spaced", "../Note", ".Hidden", "Note.md", "dir/Note", "dir\\Note"])(
    "refuses invalid note name %j",
    (name) => expect(isValidMemoryNoteName(name)).toBe(false),
  );
  it("accepts a plain note stem", () => expect(isValidMemoryNoteName("Future Design")).toBe(true));

  it("inserts a placement only when parent, uniqueness, and post-change prose edge hold", () => {
    const map = parseAndValidateMemoryMap(
      "maps/product.yaml",
      `${validHeader}arrangement:\n  - note: Product\n`,
      buildMemoryGraph([note("Product", "")]),
    );
    if ("refusal" in map) throw new Error(map.refusal);
    expect("refusal" in insertMapPlacement(map, "Missing", "Composer", buildMemoryGraph([]))).toBe(
      true,
    );
    expect("refusal" in insertMapPlacement(map, "Product", "Product", buildMemoryGraph([]))).toBe(
      true,
    );
    const noEdge = insertMapPlacement(
      map,
      "Product",
      "Composer",
      buildMemoryGraph([note("Product", ""), note("Composer", "")]),
    );
    expect("refusal" in noEdge ? noEdge.refusal : "").toContain("does not link");
    const graph = buildMemoryGraph([note("Product", ""), note("Composer", "See [[Product]].")]);
    const inserted = insertMapPlacement(map, "Product", "Composer", graph);
    expect("refusal" in inserted).toBe(false);
    if ("refusal" in inserted) return;
    expect(
      "refusal" in parseAndValidateMemoryMap(inserted.file, serializeMemoryMap(inserted), graph),
    ).toBe(false);
  });

  it("indexes the lexicographically first duplicate stem and reports it", () => {
    const graph = buildMemoryGraph([
      note("Plans", "second", "z/Plans.md"),
      note("Plans", "first", "a/Plans.md"),
    ]);
    expect(graph.noteByName.get("Plans")?.path).toBe("a/Plans.md");
    expect(graph.problems[0]).toContain("Plans");
    expect(graph.problems[0]).toContain("z/Plans.md");
  });

  it.each([
    ["unknown key", `${validHeader}query: x\narrangement: []\n`, "unknown top-level key"],
    ["wrong type", `name: Product\npurpose: 3\narrangement: []\n`, "purpose must"],
    ["anchor", `${validHeader}arrangement:\n  - &node\n    note: Plans\n  - *node\n`, "anchor"],
    ["tag", `${validHeader}arrangement: !custom []\n`, "tag"],
    [
      "repeated note",
      `${validHeader}arrangement:\n  - note: Plans\n  - note: Plans\n`,
      "repeated note",
    ],
    ["malformed YAML", `${validHeader}arrangement: [\n`, "malformed YAML"],
  ])("refuses a map with %s and names the file and problem", (_case, source, problem) => {
    const result = parseAndValidateMemoryMap("maps/product.yaml", source, buildMemoryGraph([]));
    expect("refusal" in result).toBe(true);
    if ("refusal" in result) {
      expect(result.refusal).toContain("maps/product.yaml");
      expect(result.refusal.toLowerCase()).toContain(problem.toLowerCase());
    }
  });

  it("refuses a missing prose edge and names the note to fix", () => {
    const result = parseAndValidateMemoryMap(
      "maps/product.yaml",
      `${validHeader}arrangement:\n  - note: Plans\n    children:\n      - note: Composer\n`,
      buildMemoryGraph([note("Plans", "No edge"), note("Composer", "No edge")]),
    );
    expect("refusal" in result ? result.refusal : "").toContain('"Plans" does not link "Composer"');
  });

  it("accepts either-direction prose edges", () => {
    const source = `${validHeader}arrangement:\n  - note: Plans\n    children:\n      - note: Composer\n`;
    expect(
      "refusal" in
        parseAndValidateMemoryMap(
          "maps/product.yaml",
          source,
          buildMemoryGraph([note("Plans", "[[Composer]]"), note("Composer", "")]),
        ),
    ).toBe(false);
    expect(
      "refusal" in
        parseAndValidateMemoryMap(
          "maps/product.yaml",
          source,
          buildMemoryGraph([note("Plans", ""), note("Composer", "[[Plans]]")]),
        ),
    ).toBe(false);
  });

  it("accepts a red-linked placement when the written side links it", () => {
    const result = parseAndValidateMemoryMap(
      "maps/product.yaml",
      `${validHeader}arrangement:\n  - note: Plans\n    children:\n      - note: Future\n`,
      buildMemoryGraph([note("Plans", "Next is [[Future]].")]),
    );
    expect("refusal" in result).toBe(false);
  });

  it("compiles a deterministic forest and refuses cycles", () => {
    const compiled = compileProductMap([
      { parent: "Product", child: "Plans" },
      { parent: "Product", child: "Composer" },
      { parent: "Other", child: "Zed" },
    ]);
    expect(isProductMapCycleError(compiled)).toBe(false);
    if (!isProductMapCycleError(compiled)) {
      expect(compiled.arrangement.map(({ note }) => note)).toEqual(["Other", "Product"]);
      expect(compiled.arrangement[1]?.children?.map(({ note }) => note)).toEqual([
        "Composer",
        "Plans",
      ]);
    }
    const cycle = compileProductMap([
      { parent: "A", child: "B" },
      { parent: "B", child: "A" },
    ]);
    expect(isProductMapCycleError(cycle)).toBe(true);
    expect(isProductMapCycleError(cycle) ? cycle.cycle : []).toEqual(["A", "B", "A"]);
  });

  it("serializes generated YAML that round-trips through validation", () => {
    const graph = buildMemoryGraph([
      note("Product", "contains:: [[Composer]], [[Plans]]"),
      note("Composer", ""),
      note("Plans", ""),
    ]);
    const compiled = compileProductMap(graph.declarations);
    expect(isProductMapCycleError(compiled)).toBe(false);
    if (isProductMapCycleError(compiled)) return;
    const parsed = parseAndValidateMemoryMap(
      "maps/product.yaml",
      serializeMemoryMap(compiled),
      graph,
    );
    expect("refusal" in parsed ? parsed.refusal : parsed.name).toBe("Product");
  });

  it("fingerprints path, mtime, and size deterministically", () => {
    const base = [{ path: "A.md", mtimeMs: 1, size: 2 }];
    expect(fingerprintMemoryFiles(base)).toBe(fingerprintMemoryFiles([...base].reverse()));
    expect(fingerprintMemoryFiles(base)).not.toBe(
      fingerprintMemoryFiles([{ path: "A.md", mtimeMs: 2, size: 2 }]),
    );
    expect(fingerprintMemoryFiles(base)).not.toBe(
      fingerprintMemoryFiles([{ path: "A.md", mtimeMs: 1, size: 3 }]),
    );
  });
});
