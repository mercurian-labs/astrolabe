import { describe, expect, it } from "vite-plus/test";

import {
  amendmentMessage,
  backlinks,
  findMap,
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
    expect(renameLinks(source, (target) => (target === "Auth" ? "Identity" : null))).toContain(
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
    const renamed = renameLinks(source, (target) => (target.toLowerCase() === "a" ? "New" : null));
    expect(renamed.startsWith("[[New#Part|Label]] [[New]]")).toBe(true);
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

  it("keys notes by file, and leaves out operational files in every folder", () => {
    const index = indexFiles({
      "AGENTS.md": "[[A]]",
      "research/README.md": "x",
      "research/CLAUDE.md": "x",
      "research/Strategy.md": "x",
      ".notes/Hidden.md": "x",
      ".git/config.md": "x",
      "A.md": "a",
    });
    expect([...index.notes.keys()]).toEqual([".notes/Hidden.md", "A.md", "research/Strategy.md"]);
    expect(index.notes.get("research/Strategy.md")?.name).toBe("research/Strategy");
  });

  it("holds two notes of one name, and case differences a case-sensitive server can have", () => {
    const index = indexFiles({
      "a/Plan.md": "1",
      "b/Plan.md": "2",
      "c/Name.md": "3",
      "c/name.md": "4",
    });
    expect(index.notes.size).toBe(4);
    expect(index.errors).toEqual([]);
  });

  it("counts a link by where it lands, however it's spelled", () => {
    const index = indexFiles({
      "a/Plan.md": "# one",
      "b/Plan.md": "# two",
      "a/Near.md": "[[Plan]] [[a/Plan]] [[./Plan.md]] [[b/Plan]]",
      "c/Far.md": "[[Plan]]",
      "Board.canvas": JSON.stringify({
        nodes: [
          { id: "t", type: "text", text: "[[b/Plan]]" },
          { id: "f", type: "file", file: "a/Plan.md" },
        ],
        edges: [],
      }),
    });
    expect(backlinks(index, "a/Plan")).toEqual(["a/Near", "c/Far", "Board.canvas"]);
    expect(backlinks(index, "b/Plan")).toEqual(["a/Near", "Board.canvas"]);
    expect(unresolved(index)).toEqual([]);
  });

  it("resolves a red link from the note that writes it", () => {
    const index = indexFiles({
      "a/Near.md": "[[./Here]]",
      "b/Here.md": "",
      "Other.md": "[[./Here]]",
    });
    expect(unresolved(index)).toEqual([{ name: "./Here", sources: ["a/Near"] }]);
    expect(backlinks(index, "a/Here")).toEqual(["a/Near"]);
  });

  it("stands a map's edges on where its names lead, keeping them as written", () => {
    const map: SkillMap = {
      version: 1,
      name: "Deep",
      purpose: "Nested.",
      types: { uses: "Uses." },
      edges: [{ from: "A", type: "uses", to: "b/B", rationale: "Because." }],
    };
    const index = indexFiles({
      "a/A.md": "[[B]]",
      "a/B.md": "A decoy.",
      "b/B.md": "",
      "maps/Deep.skillmap.md": serializeMap(map),
    });
    expect(index.errors).toEqual([
      expect.objectContaining({ error: "Missing prose link: A ↔ b/B" }),
    ]);
    const held = indexFiles({
      "a/A.md": "[[b/B]]",
      "b/B.md": "",
      "maps/Deep.skillmap.md": serializeMap(map),
    });
    expect(held.errors).toEqual([]);
    expect(held.maps.get("maps/Deep.skillmap.md")?.edges[0]?.from).toBe("A");
    expect(findMap(held, "maps/Deep.skillmap")?.[1].name).toBe("Deep");
    expect(findMap(held, "Deep")?.[0]).toBe("maps/Deep.skillmap.md");
    expect(walk(held.maps.get("maps/Deep.skillmap.md")!, held, "maps/Deep.skillmap.md")).toBe(
      "A\n  b/B",
    );
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
    expect(index.notes.has("Board.canvas")).toBe(false);
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
    expect(indexFiles(filled).notes.has("Missing.md")).toBe(true);
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

  it.each([
    "../x.md",
    "a/../x.md",
    "./x.md",
    "a//x.md",
    "/x.md",
    ".git/x.md",
    "a/.git/x.md",
    "a\\x.md",
    "x.png",
  ])("refuses %s", (file) => {
    expect(() => planAmendment(base(), { [file]: "x" }, stamp())).toThrow(/Expected a path/);
  });

  it.each(["notes/x.md", "notes/deep/x.base", "notes/x.canvas", ".notes/x.md", ".x.md"])(
    "takes %s",
    (file) => {
      expect(planAmendment(base(), { [file]: "" }, stamp()).changes[file]).toBe("");
    },
  );

  it("keeps a renamed note in its folder, and follows the links that led to it", () => {
    const files = {
      "a/Old.md": "[[Old]] [[Other]]",
      "a/Other.md": "[[Old|shown]] [[a/Old#Part]] [[./Old.md]]",
      "b/Old.md": "Another note.",
      "b/Keeps.md": "[[Old]] [[a/Old]]",
      "c/Open.base": 'filters: file.hasLink(link("a/Old"))\nviews:\n  - type: table\n',
      "Board.canvas": JSON.stringify({
        nodes: [
          { id: "f", type: "file", file: "a/Old.md" },
          { id: "t", type: "text", text: "[[a/Old]]" },
        ],
        edges: [],
      }),
    };
    const changes = planTransform(files, { kind: "rename", from: "a/Old", to: "New" }, stamp());
    expect(changes["a/Old.md"]).toBeNull();
    expect(changes["a/New.md"]).toBe("[[New]] [[Other]]");
    expect(changes["a/Other.md"]).toBe("[[New|shown]] [[New#Part]] [[New]]");
    expect(changes["b/Keeps.md"]).toBe("[[Old]] [[New]]");
    expect(changes["c/Open.base"]).toContain('link("a/New")');
    expect(changes["b/Old.md"]).toBeUndefined();
    const board = JSON.parse(changes["Board.canvas"] ?? "");
    expect(board.nodes[0].file).toBe("a/New.md");
    expect(board.nodes[1].text).toBe("[[New]]");
  });

  it("renames a canvas in its folder, and moves it by a path", () => {
    const files = { "a/Board.canvas": '{"nodes":[],"edges":[]}', "Note.md": "[[a/Board.canvas]]" };
    const changes = planTransform(
      files,
      { kind: "rename", from: "a/Board.canvas", to: "Plan" },
      stamp(),
    );
    expect(changes["a/Plan.canvas"]).toBeDefined();
    expect(changes["Note.md"]).toBe("[[Plan.canvas]]");
    const moved = planTransform(
      files,
      { kind: "rename", from: "a/Board.canvas", to: "b/Plan" },
      stamp(),
    );
    expect(moved["b/Plan.canvas"]).toBeDefined();
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
    expect(
      parseAmendmentTrailers(
        amendmentMessage("Edit Alpha", { amendment: "a2", actor: "You", autosave: "Alpha.md" }),
      ),
    ).toEqual({ amendment: "a2", actor: "You", autosave: "Alpha.md" });
    expect(parseAmendmentTrailers("docs\n\nMemory-Amendment: m1\nMemory-Actor: Codex\n")).toEqual({
      amendment: "m1",
      actor: "Codex",
    });
  });
});
