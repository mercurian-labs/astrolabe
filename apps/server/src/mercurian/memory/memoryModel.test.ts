import { describe, expect, it } from "vite-plus/test";

import { isProductMapCycleError } from "@t3tools/contracts";

import {
  buildMemoryGraph,
  compileProductMap,
  fingerprintMemoryFiles,
  insertMapPlacement,
  isValidMemoryNoteName,
  parseContainsLines,
  parseSkillMap,
  parseWikilinks,
  serializeSkillMap,
} from "./memoryModel.ts";

const note = (name: string, markdown: string, path = `${name}.md`) => ({ name, markdown, path });
const mapSource = (
  edges = "",
  options: { readonly types?: string; readonly view?: string; readonly body?: string } = {},
) => `---
name: Product
purpose: Product structure
types:
${options.types ?? "  contains: The child is part of the parent."}
${edges.length === 0 ? "edges: []\n" : `edges:\n${edges}`}${options.view === undefined ? "" : `view: ${options.view}\n`}---
${options.body ?? ""}`;

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

  it.each(["", " spaced", "../Note", ".Hidden", "Note.md", "dir/Note", "dir\\Note"])(
    "refuses invalid note name %j",
    (name) => expect(isValidMemoryNoteName(name)).toBe(false),
  );
  it("accepts a plain note stem", () => expect(isValidMemoryNoteName("Future Design")).toBe(true));

  it("parses a skill map and carries its teaching body", () => {
    const source = mapSource("  - { from: Product, type: contains, to: Composer }\n", {
      body: "Teach people how to walk [[Product]].\n",
    });
    const parsed = parseSkillMap(
      "Product.skillmap.md",
      source,
      buildMemoryGraph([note("Product", "[[Composer]]")]),
    );
    expect(parsed).toEqual({
      file: "Product.skillmap.md",
      name: "Product",
      purpose: "Product structure",
      types: [{ name: "contains", meaning: "The child is part of the parent." }],
      edges: [{ from: "Product", type: "contains", to: "Composer" }],
      body: "Teach people how to walk [[Product]].\n",
    });
  });

  it.each([
    ["missing frontmatter", "name: Product\n", "missing frontmatter"],
    [
      "unknown key",
      mapSource("").replace("edges: []\n", "query: x\nedges: []\n"),
      "unknown top-level key",
    ],
    [
      "refusal key",
      mapSource("").replace("edges: []\n", "refusal: nope\nedges: []\n"),
      "unknown top-level key",
    ],
    ["missing name", mapSource("").replace("name: Product\n", ""), "name must"],
    [
      "bad purpose",
      mapSource("").replace("purpose: Product structure", "purpose: 3"),
      "purpose must",
    ],
    ["missing types", mapSource("").replace(/types:\n  contains:[^\n]+\n/u, ""), "types must"],
    [
      "empty types",
      mapSource("").replace("  contains: The child is part of the parent.\n", ""),
      "types must",
    ],
    [
      "bad type meaning",
      mapSource("").replace("The child is part of the parent.", "3"),
      "types.contains must",
    ],
    [
      "bad type name",
      mapSource("").replace("contains: The child", "1: The child"),
      "type names under types must",
    ],
    ["missing edges", mapSource("").replace("edges: []\n", ""), "edges must"],
    ["bad edges", mapSource("").replace("edges: []\n", "edges: nope\n"), "edges must"],
    ["bad edge entry", mapSource("  - nope\n"), "edges[0] must"],
    [
      "unknown edge key",
      mapSource("  - { from: A, type: contains, to: B, why: x }\n"),
      "unknown key",
    ],
    ["missing edge field", mapSource("  - { from: A, type: contains }\n"), "edges[0].to must"],
    ["anchor", mapSource("").replace("types:\n", "types: &vocabulary\n"), "anchor"],
    ["alias", mapSource("").replace("edges: []\n", "edges: *vocabulary\n"), "alias"],
    ["tag", mapSource("").replace("edges: []\n", "edges: !custom []\n"), "tag"],
    ["malformed YAML", mapSource("").replace("edges: []\n", "edges: [\n"), "malformed YAML"],
  ])("refuses a map with %s and names the file and problem", (_case, source, problem) => {
    const result = parseSkillMap("Product.skillmap.md", source, buildMemoryGraph([]));
    expect("refusal" in result).toBe(true);
    if ("refusal" in result) {
      expect(result.refusal).toContain("Product.skillmap.md");
      expect(result.refusal.toLowerCase()).toContain(problem.toLowerCase());
    }
  });

  it("refuses an undeclared edge type with its entry and the fix", () => {
    const result = parseSkillMap(
      "Product.skillmap.md",
      mapSource("  - { from: Product, type: depends-on, to: Composer }\n"),
      buildMemoryGraph([]),
    );
    expect("refusal" in result ? result.refusal : "").toBe(
      'Product.skillmap.md: edges[0]: type "depends-on" is not declared under types — declare it with a meaning or fix the edge',
    );
  });

  it("requires a prose edge and accepts it in either direction", () => {
    const source = mapSource("  - { from: Plans, type: contains, to: Composer }\n");
    const missing = parseSkillMap(
      "Product.skillmap.md",
      source,
      buildMemoryGraph([note("Plans", "No edge"), note("Composer", "No edge")]),
    );
    expect("refusal" in missing ? missing.refusal : "").toContain(
      '"Plans" does not link "Composer" — add the link to a note\'s prose or remove the edge',
    );
    expect(
      "refusal" in
        parseSkillMap(
          "Product.skillmap.md",
          source,
          buildMemoryGraph([note("Plans", "[[Composer]]"), note("Composer", "")]),
        ),
    ).toBe(false);
    expect(
      "refusal" in
        parseSkillMap(
          "Product.skillmap.md",
          source,
          buildMemoryGraph([note("Plans", ""), note("Composer", "[[Plans]]")]),
        ),
    ).toBe(false);
  });

  it("accepts an unwritten endpoint only when the written side links it", () => {
    const source = mapSource("  - { from: Plans, type: contains, to: Future }\n");
    expect(
      "refusal" in
        parseSkillMap(
          "Product.skillmap.md",
          source,
          buildMemoryGraph([note("Plans", "Next is [[Future]].")]),
        ),
    ).toBe(false);
    const neitherWritten = parseSkillMap("Product.skillmap.md", source, buildMemoryGraph([]));
    expect("refusal" in neitherWritten ? neitherWritten.refusal : "").toContain("does not link");
  });

  it("allows repeated edges and cycles", () => {
    const parsed = parseSkillMap(
      "Product.skillmap.md",
      mapSource(
        "  - { from: A, type: contains, to: B }\n  - { from: A, type: contains, to: B }\n  - { from: B, type: contains, to: A }\n",
      ),
      buildMemoryGraph([note("A", "[[B]]"), note("B", "[[A]]")]),
    );
    expect("refusal" in parsed).toBe(false);
    if (!("refusal" in parsed)) expect(parsed.edges).toHaveLength(3);
  });

  it("validates and retains the optional view", () => {
    const tree = parseSkillMap(
      "Product.skillmap.md",
      mapSource("", { view: "tree" }),
      buildMemoryGraph([]),
    );
    expect("refusal" in tree ? tree.refusal : tree.view).toBe("tree");
    const flow = parseSkillMap(
      "Product.skillmap.md",
      mapSource("", { view: "flow" }),
      buildMemoryGraph([]),
    );
    expect("refusal" in flow ? flow.refusal : flow.view).toBe("flow");
    const web = parseSkillMap(
      "Product.skillmap.md",
      mapSource("", { view: "web" }),
      buildMemoryGraph([]),
    );
    expect("refusal" in web ? web.refusal : web.view).toBe("web");
    const formerGraph = parseSkillMap(
      "Product.skillmap.md",
      mapSource("", { view: "graph" }),
      buildMemoryGraph([]),
    );
    expect("refusal" in formerGraph ? formerGraph.refusal : "").toContain(
      'view must be "tree", "flow" or "web"',
    );
    const invalid = parseSkillMap(
      "Product.skillmap.md",
      mapSource("", { view: "radial" }),
      buildMemoryGraph([]),
    );
    expect("refusal" in invalid ? invalid.refusal : "").toContain("view must");
  });

  it("serializes a parse round-trip with a byte-stable body", () => {
    const body = "\n# Teaching\r\n\r\nKeep the final blanks.\n\n";
    const parsed = parseSkillMap(
      "Product.skillmap.md",
      mapSource("", { body }),
      buildMemoryGraph([]),
    );
    if ("refusal" in parsed) throw new Error(parsed.refusal);
    const serialized = serializeSkillMap(parsed);
    expect(serialized.endsWith(body)).toBe(true);
    const reparsed = parseSkillMap(parsed.file, serialized, buildMemoryGraph([]));
    expect(reparsed).toEqual(parsed);
  });

  it("resolves placement types, appends edges, and refuses duplicates", () => {
    const graph = buildMemoryGraph([note("Product", "[[Composer]]")]);
    const single = parseSkillMap("Product.skillmap.md", mapSource(""), graph);
    if ("refusal" in single) throw new Error(single.refusal);
    const inserted = insertMapPlacement(single, "Product", "Composer", graph);
    expect("refusal" in inserted ? inserted.refusal : inserted.edges).toEqual([
      { from: "Product", type: "contains", to: "Composer" },
    ]);
    if ("refusal" in inserted) return;
    const duplicate = insertMapPlacement(inserted, "Product", "Composer", graph);
    expect("refusal" in duplicate ? duplicate.refusal : "").toContain("already exists");

    const multi = parseSkillMap(
      "Product.skillmap.md",
      mapSource("", {
        types:
          "  contains: The child is part of the parent.\n  depends-on: The source needs the target.",
      }),
      graph,
    );
    if ("refusal" in multi) throw new Error(multi.refusal);
    const ambiguous = insertMapPlacement(multi, "Product", "Composer", graph);
    expect("refusal" in ambiguous ? ambiguous.refusal : "").toContain(
      "name the edge type — this map declares contains, depends-on",
    );
    const typed = insertMapPlacement(multi, "Product", "Composer", graph, "depends-on");
    expect("refusal" in typed ? typed.refusal : typed.edges.at(-1)?.type).toBe("depends-on");
  });

  it("round-trip validation refuses a placement without a prose edge", () => {
    const map = parseSkillMap("Product.skillmap.md", mapSource(""), buildMemoryGraph([]));
    if ("refusal" in map) throw new Error(map.refusal);
    const placed = insertMapPlacement(
      map,
      "Product",
      "Composer",
      buildMemoryGraph([note("Product", ""), note("Composer", "")]),
    );
    expect("refusal" in placed ? placed.refusal : "").toContain("does not link");
  });

  it("compiles a deterministic skill-map forest with teaching and refuses cycles", () => {
    const compiled = compileProductMap([
      { parent: "Product", child: "Plans" },
      { parent: "Product", child: "Composer" },
      { parent: "Other", child: "Zed" },
    ]);
    expect(isProductMapCycleError(compiled)).toBe(false);
    if (!isProductMapCycleError(compiled)) {
      expect(compiled.file).toBe("Product.skillmap.md");
      expect(compiled.edges).toEqual([
        { from: "Other", type: "contains", to: "Zed" },
        { from: "Product", type: "contains", to: "Composer" },
        { from: "Product", type: "contains", to: "Plans" },
      ]);
      expect(compiled.body.length).toBeGreaterThan(0);
    }
    const cycle = compileProductMap([
      { parent: "A", child: "B" },
      { parent: "B", child: "A" },
    ]);
    expect(isProductMapCycleError(cycle)).toBe(true);
    expect(isProductMapCycleError(cycle) ? cycle.cycle : []).toEqual(["A", "B", "A"]);
  });

  it("serializes a generated skill map that round-trips through validation", () => {
    const graph = buildMemoryGraph([
      note("Product", "contains:: [[Composer]], [[Plans]]"),
      note("Composer", ""),
      note("Plans", ""),
    ]);
    const compiled = compileProductMap(graph.declarations);
    if (isProductMapCycleError(compiled)) throw new Error(compiled.message);
    const serialized = serializeSkillMap(compiled);
    expect(serialized).toContain("- { from: Product, type: contains, to: Composer }");
    const parsed = parseSkillMap(compiled.file, serialized, graph);
    expect("refusal" in parsed ? parsed.refusal : parsed.name).toBe("Product");
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
