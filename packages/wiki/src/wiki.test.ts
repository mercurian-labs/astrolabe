import { describe, expect, it } from "vite-plus/test";

import {
  amendmentMessage,
  backlinks,
  indexFiles,
  keepWarningHistory,
  links,
  parseAmendmentTrailers,
  parseMap,
  planAmendment,
  planTransform,
  renameLinks,
  serializeCanvas,
  serializeMap,
  support,
  typedLinks,
  unresolved,
  walk,
  type SkillMap,
  type WikiChanges,
  type WikiFiles,
} from "./index.ts";

const product = (
  edges: SkillMap["edges"] = [{ from: "A", type: "relates", to: "B", rationale: "A discusses B." }],
): SkillMap => ({
  version: 1,
  name: "Product",
  purpose: "Orient",
  types: { relates: "The concepts are related." },
  edges,
  body: "Read [[A]] first.",
});

let counter = 0;
const stamp = () => ({
  amendment: `am-${++counter}`,
  at: "2026-10-16T00:00:00.000Z",
  newId: () => `w-${++counter}`,
});
const base = (): WikiFiles => ({
  "A.md": "# A\n[[B]] and [[Missing]]\n",
  "B.md": "# B\n",
  "Product.skillmap.md": serializeMap(product()),
});
const apply = (files: WikiFiles, changes: WikiChanges): WikiFiles => {
  const next: Record<string, string> = { ...files };
  for (const [file, content] of Object.entries(changes)) {
    if (content === null) delete next[file];
    else next[file] = content;
  }
  return next;
};

describe("typed links", () => {
  it("reads `@` words from body links, combining a document's mentions", () => {
    const source = [
      "Uses [[Auth|the login flow @depends_on]] and [[auth#Login|@blocks @depends_on]].",
      "The [[Analysis|new work @supersedes and @contradicts-it the old]], [[Plain]], [[Named|text]].",
    ].join("\n");
    expect(typedLinks(source)).toEqual([
      { target: "Auth", types: ["depends_on", "blocks"] },
      { target: "Analysis", types: ["supersedes", "contradicts-it"] },
    ]);
  });

  it("reads a link in a table, where its bar is escaped, and renames it the same way", () => {
    const source = "| Needs |\n| - |\n| [[Auth\\|the flow @depends_on]] |\n";
    expect(typedLinks(source)).toEqual([{ target: "Auth", types: ["depends_on"] }]);
    expect(renameLinks(source, "Auth", "Identity")).toContain(
      "[[Identity\\|the flow @depends_on]]",
    );
  });

  it("leaves addresses, escapes, code, frontmatter and embeds untyped", () => {
    const source = [
      "---",
      'owner: "[[Priya|@owner]]"',
      "---",
      "[[A|sam@example.com]] [[B|\\@sam]] [[C|(@sam)]] `[[D|@code]]` ![[E|@embed]]",
      "```",
      "[[F|@fenced]]",
      "```",
      "",
    ].join("\n");
    expect(typedLinks(source)).toEqual([]);
  });
});

describe("links", () => {
  it("finds real links and renames them, keeping anchors, aliases and examples", () => {
    const source =
      "[[A#Part|Label]] [[A.md]] [[Missing]] \\[[A]]\n`[[A]]`\n``[[A]]``\n~~~md\n[[A]]\n~~~\n```\n[[A]]\n```\n<!-- [[A]] -->\n";
    expect(links(source).map((link) => link.target)).toEqual(["A", "A", "Missing"]);
    const renamed = renameLinks(source, "a", "New");
    expect(renamed.startsWith("[[New#Part|Label]] [[New.md]]")).toBe(true);
    expect(renamed).toContain("`[[A]]`");
    expect(renamed).toContain("\\[[A]]");
  });
});

describe("the index", () => {
  it("allows cycles and red links, and the walk terminates", () => {
    const map = product([
      { from: "A", type: "relates", to: "B", rationale: "Linked" },
      { from: "B", type: "relates", to: "A", rationale: "Other direction" },
      { from: "A", type: "relates", to: "Missing", rationale: "Frontier" },
    ]);
    const index = indexFiles({
      "A.md": "[[B]] [[Missing]]",
      "B.md": "B",
      "Product.skillmap.md": serializeMap(map),
    });
    expect(index.errors).toEqual([]);
    expect(unresolved(index)[0]?.name).toBe("Missing");
    expect(walk(map, index)).toMatch(/already shown/);
    expect(walk(map, index)).toMatch(/Missing \(unwritten\)/);
    expect(support(index, map.edges[0]!)[0]?.prose).toBe("[[B]] [[Missing]]");
    expect(parseMap(serializeMap(map))).toEqual(map);
  });

  it("refuses malformed maps and reports edges with no prose link", () => {
    expect(() => parseMap("---\nversion: 1\nversion: 1\n---")).toThrow();
    expect(() => serializeMap({ ...product(), version: 2 } as unknown as SkillMap)).toThrow(
      /version/,
    );
    expect(() =>
      serializeMap(product([{ from: "A", type: "other", to: "B", rationale: "x" }])),
    ).toThrow(/Undeclared/);
    expect(
      indexFiles({ "A.md": "```\n[[B]]\n```", "Product.skillmap.md": serializeMap(product()) })
        .errors,
    ).toHaveLength(1);
  });

  it("ignores operational files and nested folders", () => {
    const index = indexFiles({ "AGENTS.md": "[[A]]", "research/Strategy.md": "x", "A.md": "a" });
    expect([...index.notes.keys()]).toEqual(["a"]);
  });
});

describe("canvases in the index", () => {
  const board = JSON.stringify({
    nodes: [
      { id: "a", type: "text", text: "[[A]] and [[Ghost]] and [[Product]]" },
      { id: "b", type: "file", file: "B.md" },
      { id: "c", type: "file", file: "Gone.md" },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "b" }],
  });
  const files = { ...base(), "Board.canvas": board, "Note.md": "[[Board.canvas]] [[Board]]" };

  it("keeps canvases out of the notes, and reports one that isn't JSON", () => {
    const index = indexFiles({ ...files, "Bad.canvas": "{nope" });
    expect(index.notes.has("board")).toBe(false);
    expect(index.notes.has("board.canvas")).toBe(false);
    expect([...index.canvases.values()].map((canvas) => canvas.file)).toEqual([
      "Bad.canvas",
      "Board.canvas",
    ]);
    expect(index.errors).toEqual([expect.objectContaining({ file: "Bad.canvas" })]);
  });

  it("counts file cards and text links as backlinks; only text links go red", () => {
    const index = indexFiles(files);
    expect(backlinks(index, "A")).toContain("Board.canvas");
    expect(backlinks(index, "B")).toEqual(["A", "Board.canvas"]);
    const red = unresolved(index);
    expect(red.find((entry) => entry.name === "Ghost")?.sources).toEqual(["Board.canvas"]);
    expect(red.some((entry) => entry.name === "Gone")).toBe(false);
  });

  it("resolves `[[Board.canvas]]` and not `[[Board]]`", () => {
    const red = unresolved(indexFiles(files));
    expect(red.some((entry) => entry.name === "Board.canvas")).toBe(false);
    expect(red.find((entry) => entry.name === "Board")?.sources).toEqual(["Note"]);
  });

  it("never lets a card hold up a map's edge", () => {
    const map = product([{ from: "B", type: "relates", to: "A", rationale: "None." }]);
    const index = indexFiles({
      "A.md": "# A\n",
      "B.md": "# B\n",
      "Product.skillmap.md": serializeMap(map),
      "Board.canvas": JSON.stringify({
        nodes: [{ id: "a", type: "text", text: "[[A]] [[B]]" }],
      }),
    });
    expect(index.errors.some((error) => error.edge !== undefined)).toBe(true);
  });
});

describe("amendments", () => {
  it("stamps a warning into the map when a change severs an edge, and keeps it through resolution", () => {
    const files = base();
    const first = stamp();
    const severed = planAmendment(files, { "A.md": "# A\nNo relationship.\n" }, first);
    const after = apply(files, severed.changes);
    const warning = indexFiles(after).maps.get("Product.skillmap.md")?.warnings?.[0];
    expect(warning?.amendment).toBe(first.amendment);
    expect(severed.errors).toHaveLength(1);

    expect(() =>
      planTransform(
        after,
        { kind: "resolve-warning", map: "Product", id: warning!.id, text: "Handled" },
        stamp(),
      ),
    ).toThrow(/Repair/);

    const repaired = apply(
      after,
      planAmendment(after, { "A.md": "# A\n[[B]] restored.\n" }, stamp()).changes,
    );
    const resolveStamp = stamp();
    const resolved = apply(
      repaired,
      planAmendment(
        repaired,
        planTransform(
          repaired,
          { kind: "resolve-warning", map: "Product", id: warning!.id, text: "Restored." },
          resolveStamp,
        ),
        resolveStamp,
      ).changes,
    );
    const record = indexFiles(resolved).maps.get("Product.skillmap.md")?.warnings?.[0];
    expect(record?.id).toBe(warning!.id);
    expect(record?.resolution?.text).toBe("Restored.");
  });

  it("refuses to erase warning history", () => {
    const files = base();
    const after = apply(
      files,
      planAmendment(files, { "A.md": "# A\nNo relationship.\n" }, stamp()).changes,
    );
    expect(() =>
      planAmendment(after, { "Product.skillmap.md": serializeMap(product()) }, stamp()),
    ).toThrow(/warning history/);
  });

  it("refuses a new edge without prose support, and fill lands a note with its placement", () => {
    const files = base();
    const invented = { from: "A", type: "relates", to: "Invented", rationale: "Not linked" };
    const addStamp = stamp();
    expect(() =>
      planAmendment(
        files,
        planTransform(files, { kind: "edge-add", map: "Product", edge: invented }, addStamp),
        addStamp,
      ),
    ).toThrow(/prose/);

    const fillStamp = stamp();
    const fill = planTransform(
      files,
      {
        kind: "fill",
        map: "Product",
        name: "Missing",
        content: "# Missing\nWritten now.\n",
        edge: {
          from: "A",
          type: "relates",
          to: "Missing",
          rationale: "A references this frontier.",
        },
      },
      fillStamp,
    );
    const filled = apply(files, planAmendment(files, fill, fillStamp).changes);
    expect(indexFiles(filled).notes.has("missing")).toBe(true);
    expect(indexFiles(filled).errors).toEqual([]);
  });

  it("renames a note, every link to it, and every map edge in one change set", () => {
    const files = base();
    const renameStamp = stamp();
    const changes = planTransform(files, { kind: "rename", from: "B", to: "Bee" }, renameStamp);
    const renamed = apply(files, planAmendment(files, changes, renameStamp).changes);
    expect(renamed["B.md"]).toBeUndefined();
    expect(renamed["A.md"]).toContain("[[Bee]]");
    expect(indexFiles(renamed).maps.get("Product.skillmap.md")?.edges[0]?.to).toBe("Bee");
    expect(indexFiles(renamed).errors).toEqual([]);
  });

  it("renames a note inside bases: link-shaped literals and name comparisons, nothing else", () => {
    const files = {
      ...base(),
      "Open.base": [
        "filters:",
        "  or:",
        '    - file.hasLink("B")',
        "    - 'file.hasLink(link(\"[[B|bee]]\"))'",
        "    - \"file.basename == 'B' && status != 'B'\"",
        "formulas:",
        "  next: link('B.md')",
        "views:",
        "  - type: table # the only view",
        '    filters: { and: [file.name != "A"] }',
        "",
      ].join("\n"),
      "C.md": "# C\n\n```base\nfilters: 'file.hasLink(\"B\")'\n```\n",
    };
    const changes = planTransform(files, { kind: "rename", from: "B", to: "Bee: two" }, stamp());
    expect(changes["Open.base"]).toBe(
      [
        "filters:",
        "  or:",
        '    - "file.hasLink(\\"Bee: two\\")"',
        "    - 'file.hasLink(link(\"[[Bee: two|bee]]\"))'",
        "    - \"file.basename == 'Bee: two' && status != 'B'\"",
        "formulas:",
        "  next: \"link('Bee: two.md')\"",
        "views:",
        "  - type: table # the only view",
        '    filters: { and: [file.name != "A"] }',
        "",
      ].join("\n"),
    );
    expect(changes["C.md"]).toBe("# C\n\n```base\nfilters: 'file.hasLink(\"Bee: two\")'\n```\n");
    expect(indexFiles(apply(files, changes)).errors).toEqual([]);
  });

  it("reports a base naming a note that nothing carries, as a rename made in Obsidian leaves", () => {
    const files = {
      ...base(),
      "Open.base": 'filters: \'file.hasLink("Gone") || file.hasLink("Missing")\'\n',
    };
    expect(indexFiles(files).errors).toEqual([
      { file: "Open.base", error: "Names “Gone”, but no note is called that or links to it." },
    ]);
    const amended = planAmendment(files, { "B.md": "# B\n[[Gone]]\n" }, stamp());
    expect(amended.errors).toEqual([]);
  });

  it("writes a base, keeping what it can't run as an index error rather than a refusal", () => {
    const planned = planAmendment(base(), { "Open.base": "views:\n  - type: board\n" }, stamp());
    expect(planned.changes["Open.base"]).toBe("views:\n  - type: board\n");
    expect(planned.errors).toEqual([
      {
        file: "Open.base",
        error:
          "Not supported: the board view (table, cards, list, kanban and map are) in view “Board”.",
      },
    ]);
  });

  it("renames across canvases, and a canvas itself, by the extension a link must write", () => {
    const board = serializeCanvas({
      nodes: [
        { id: "f", type: "file", file: "A.md", subpath: "#Top", x: 0 },
        { id: "t", type: "text", text: "[[A|alias]] and [[Other.canvas]]" },
      ],
      edges: [],
    });
    const files = { ...base(), "Board.canvas": board, "Other.canvas": "{}" };
    const note = planTransform(files, { kind: "rename", from: "A", to: "C" }, stamp());
    const rewritten = JSON.parse(note["Board.canvas"] ?? "");
    expect(rewritten.nodes[0]).toEqual({
      id: "f",
      type: "file",
      file: "C.md",
      subpath: "#Top",
      x: 0,
    });
    expect(rewritten.nodes[1].text).toBe("[[C|alias]] and [[Other.canvas]]");
    expect(note["Other.canvas"]).toBeUndefined();

    const canvas = planTransform(
      { ...files, "N.md": "![[Other.canvas]] [[Other]]" },
      { kind: "rename", from: "Other.canvas", to: "Renamed" },
      stamp(),
    );
    expect(canvas["Other.canvas"]).toBeNull();
    expect(canvas["Renamed.canvas"]).toBe("{}");
    expect(canvas["N.md"]).toBe("![[Renamed.canvas]] [[Other]]");
    expect(JSON.parse(canvas["Board.canvas"] ?? "").nodes[1].text).toContain("[[Renamed.canvas]]");
  });

  it("starts an empty canvas, once", () => {
    const made = planTransform(base(), { kind: "canvas-create", file: "New.canvas" }, stamp());
    expect(made["New.canvas"]).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
    expect(() =>
      planTransform(apply(base(), made), { kind: "canvas-create", file: "x.md" }, stamp()),
    ).toThrow(/\.canvas filename/);
    expect(() =>
      planTransform(apply(base(), made), { kind: "canvas-create", file: "New.canvas" }, stamp()),
    ).toThrow(/already exists/);
  });

  it("refuses paths outside the flat wiki", () => {
    expect(() => planAmendment(base(), { "../x.md": "x" }, stamp())).toThrow(/flat/);
    expect(() => planAmendment(base(), { "notes/x.md": "x" }, stamp())).toThrow(/flat/);
    expect(() => planAmendment(base(), { "notes/x.base": "x" }, stamp())).toThrow(/flat/);
    expect(() => planAmendment(base(), { "notes/x.canvas": "x" }, stamp())).toThrow(/flat/);
    expect(() => planAmendment(base(), { "x.png": "x" }, stamp())).toThrow(/flat/);
  });

  it("restores warning history that a revert's inverse would drop", () => {
    const files = base();
    const severed = apply(
      files,
      planAmendment(files, { "A.md": "# A\nNo relationship.\n" }, stamp()).changes,
    );
    const inverse = keepWarningHistory(severed, { "Product.skillmap.md": serializeMap(product()) });
    const kept = indexFiles(apply(severed, inverse)).maps.get("Product.skillmap.md");
    expect(kept?.warnings).toHaveLength(1);
  });
});

describe("trailers", () => {
  it("round-trips an amendment's identity and reads memory-tools' older trailers", () => {
    const body = amendmentMessage("docs: x", {
      amendment: "a1",
      actor: "Claude Code",
      changeRequest: "cr1",
      thread: "t1",
    });
    expect(parseAmendmentTrailers(body)).toEqual({
      amendment: "a1",
      actor: "Claude Code",
      changeRequest: "cr1",
      thread: "t1",
    });
    expect(parseAmendmentTrailers("docs\n\nMemory-Amendment: m1\nMemory-Actor: Codex\n")).toEqual({
      amendment: "m1",
      actor: "Codex",
    });
  });
});
