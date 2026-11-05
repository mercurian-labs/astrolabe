// @effect-diagnostics nodeBuiltinImport:off - fixtures are files beside the test.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { formatDate } from "./baseValues.ts";
import {
  BaseError,
  baseBlocks,
  baseCorpus,
  noteProperties,
  noteTags,
  parseBase,
  queryBase,
  type BaseQueryOptions,
} from "./index.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const FILES: Readonly<Record<string, string>> = {
  "Index.md": [
    "---",
    "kind: index",
    "---",
    "# Index",
    "",
    "Start with [[Alpha]], then [[Beta]].",
    "",
    "```base",
    "filters:",
    "  and:",
    '    - file.hasTag("area")',
    "    - '!this.file.links.contains(file)'",
    "```",
    "",
  ].join("\n"),
  "Alpha.md": [
    "---",
    "status: open",
    "priority: 2",
    "tags: [area, book]",
    'author: "[[Venkat]]"',
    "---",
    "# Alpha",
    "",
    "Builds on [[Beta]] and the [[Textbook]].",
    "",
  ].join("\n"),
  "Beta.md": "---\nstatus: done\npriority: 1\ndue: 2026-01-15\n---\nBeta sits in #area/sub.\n",
  "Gamma.md": "Gamma is #area too, and links [[Alpha]].\n",
  "Delta.md": "---\ntags: book\npriority: 3\n---\nNo textbook here.\n",
  "Textbook.md": "# Textbook\n",
  "Code.md": "```\n#notatag [[Alpha]]\n```\n\n## Heading, not a tag\n",
  "Open decisions.base": "views:\n  - type: table\n",
};

const EDITED = new Map([
  ["Alpha.md", "2026-10-30T12:00:00.000Z"],
  ["Beta.md", "2026-09-01T12:00:00.000Z"],
]);
const WIKI = baseCorpus(
  Object.entries(FILES).map(([file, source]) => ({ file, source })),
  { modified: EDITED },
);
const NOW = Date.parse("2026-11-01T12:00:00.000Z");

type Options = Partial<BaseQueryOptions>;

const names = (source: string, options: Options = {}) =>
  queryBase(WIKI, parseBase(source), { now: NOW, ...options }).rows.map((row) => row.name);
const failure = (source: string, options: Options = {}) => {
  try {
    queryBase(WIKI, parseBase(source), { now: NOW, ...options });
  } catch (error) {
    expect(error).toBeInstanceOf(BaseError);
    return (error as BaseError).message;
  }
  throw new Error("Expected the base to fail");
};
const filter = (statement: string) => `filters: ${JSON.stringify(statement)}\n`;

describe("note properties", () => {
  it("reads frontmatter as a mapping, and nothing from a malformed one", () => {
    expect(noteProperties("---\nstatus: open\ncount: 2\ndue: 2026-01-15\n---\nBody")).toEqual({
      status: "open",
      count: 2,
      due: "2026-01-15",
    });
    expect(noteProperties("---\n---\nBody")).toEqual({});
    expect(noteProperties("---\n- a list\n---\n")).toEqual({});
    expect(noteProperties("---\nkey: [unclosed\n---\n")).toEqual({});
    expect(noteProperties("Body\n---\nstatus: open\n---\n")).toEqual({});
  });

  it("tags from the tags property and the prose, never from code or headings", () => {
    const source = "---\ntags: [Project, '#area/sub']\n---\n# Title\n#inline `#code` 2024 #2024\n";
    expect(noteTags(source, noteProperties(source))).toEqual(["#inline", "#Project", "#area/sub"]);
  });
});

describe("base blocks", () => {
  it("finds each ```base block of a note and nothing else", () => {
    const source = [
      "```base",
      "views: []",
      "```",
      "```yaml",
      "not: a base",
      "```",
      "~~~~base",
      "filters: 'file.hasTag(\"x\")'",
      "~~~~",
      "```base",
      "unclosed: true",
    ].join("\n");
    expect(baseBlocks(source)).toEqual([
      "views: []",
      "filters: 'file.hasTag(\"x\")'",
      "unclosed: true",
    ]);
  });
});

describe("link types", () => {
  const typed = baseCorpus(
    Object.entries({
      "Beta.md": "# Beta\n",
      "Gamma.md": "# Gamma\n",
      "Typed.md": "Uses [[Beta|the flow @depends_on]] and [[Gamma#Top|@blocks]].\n",
      "Other.md":
        '---\nfor: "[[Beta|@depends_on]]"\n---\nSee [[Beta|@blocks]] and ![[Gamma|@depends_on]].\n',
    }).map(([file, source]) => ({ file, source })),
  );
  const matching = (statement: string, self?: string) =>
    queryBase(typed, parseBase(filter(statement)), { now: NOW, self }).rows.map((row) => row.name);

  it("asks which notes link with a type, from either end", () => {
    expect(matching('file.linksOfType("depends_on").contains(link("Beta"))')).toEqual(["Typed"]);
    expect(matching('file.linksOfType("blocks").contains(link("Gamma"))')).toEqual(["Typed"]);
    expect(matching('file.backlinksOfType("depends_on").contains(link("Typed"))')).toEqual([
      "Beta",
    ]);
    expect(matching('file.backlinksOfType("blocks").length > 0')).toEqual(["Beta", "Gamma"]);
  });

  it("follows `this` for a base embedded in a note", () => {
    expect(matching('file.linksOfType("depends_on").contains(this.file)', "Beta.md")).toEqual([
      "Typed",
    ]);
  });

  it("reports a type that isn't text", () => {
    const { rows } = queryBase(
      typed,
      parseBase(
        "formulas:\n  t: 'file.linksOfType(1)'\nviews:\n  - type: table\n    order: [formula.t]\n",
      ),
      { now: NOW },
    );
    expect(rows[0]?.values["formula.t"]).toContain("Expected String, given Number");
  });
});

describe("queries", () => {
  it("runs Obsidian's own examples, copied verbatim, over every file in the wiki", () => {
    // Alpha is a book that links the Textbook; Delta is a book that does not.
    expect(names(fixture("obsidian-complex-filter.base"))).toEqual([
      "Alpha",
      "Beta",
      "Code",
      "Gamma",
      "Index",
      "Open decisions.base",
      "Textbook",
    ]);
    const embedded = queryBase(WIKI, parseBase(fixture("obsidian-embedded.base")), { now: NOW });
    expect(embedded.view).toEqual({ name: "Table", type: "table" });
    expect(embedded.rows).toEqual([]);
    const full = queryBase(WIKI, parseBase(fixture("obsidian-syntax-example.base")), { now: NOW });
    expect(full.columns).toEqual([
      { id: "file.name", label: "file name" },
      { id: "file.ext", label: "Extension" },
      { id: "note.age", label: "age" },
      { id: "formula.ppu", label: "ppu" },
      { id: "formula.formatted_price", label: "Price" },
    ]);
    expect(full.rows).toEqual([]);
  });

  it("fails on a name the language doesn't have, even where no file would reach it", () => {
    expect(failure(filter("false && file.nope > 0"))).toMatch(/Not supported: file\.nope/);
    expect(failure(filter("shout(status)"))).toMatch(/Not supported: shout\(\)/);
    expect(failure(filter("status.shout()"))).toMatch(/status\.shout\(\)/);
    expect(failure(filter("formula"))).toMatch(/`formula` needs a name/);
    expect(failure(filter("formula.x > 1"))).toMatch(/No formula named “x”/);
    expect(failure(filter("/ab"))).toMatch(/Unclosed regular expression/);
    expect(failure("views:\n  - type: gallery\n")).toMatch(/the gallery view/);
    expect(
      failure(
        "views:\n  - type: table\n    order: [priority]\n    summaries: { priority: Mode }\n",
      ),
    ).toMatch(/No summary named “Mode”/);
    expect(failure(filter("this.file.name == 'x'"))).toMatch(/`this` needs/);
    expect(failure(filter("status = 'open'"))).toMatch(/Unexpected "="/);
    expect(failure("filters:\n  xor: []\n")).toMatch(/exactly one of and, or, not/);
    expect(failure("views:\n  - type: table\n    name: A\n", { view: "B" })).toMatch(
      /No view named “B”; this base has “A”/,
    );
  });

  it("compares properties, a missing one being unequal to anything", () => {
    expect(names(filter('status != "done"'))).toEqual([
      "Alpha",
      "Code",
      "Delta",
      "Gamma",
      "Index",
      "Open decisions.base",
      "Textbook",
    ]);
    expect(names(filter("priority >= 2 && note.priority < 3"))).toEqual(["Alpha"]);
    expect(names(filter('author == link("venkat")'))).toEqual(["Alpha"]);
    expect(names(filter('due < date("2026-02-01") && due > today() - "1y"'))).toEqual(["Beta"]);
    expect(names(filter('file.mtime > now() - "1 week"'))).toEqual(["Alpha"]);
    expect(names(filter('note["kind"].lower().startsWith("ind")'))).toEqual(["Index"]);
  });

  it("follows links and backlinks, and tags with their nesting", () => {
    expect(names(filter('file.hasLink("Textbook")'))).toEqual(["Alpha"]);
    expect(names(filter('file.links.contains(link("Beta"))'))).toEqual(["Alpha", "Index"]);
    expect(names(filter('file.backlinks.contains("Gamma")'))).toEqual(["Alpha"]);
    expect(names(filter("file.backlinks.isEmpty()"))).toEqual([
      "Code",
      "Delta",
      "Gamma",
      "Index",
      "Open decisions.base",
    ]);
    expect(names(filter('file.hasTag("area")'))).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(names(filter('file.hasTag("notatag") || file.hasProperty("kind")'))).toEqual(["Index"]);
    expect(names(filter('file.inFolder("/") && file.ext == "md" && file.name == "Beta"'))).toEqual([
      "Beta",
    ]);
    expect(names(filter('file.name == "Beta.md"'))).toEqual([]);
    expect(names(filter('file.ext == "base"'))).toEqual(["Open decisions.base"]);
  });

  it("runs a block embedded in a note with `this` as that note: the tail after a curated head", () => {
    const [block] = baseBlocks(FILES["Index.md"]!);
    expect(names(block!, { self: "Index.md" })).toEqual(["Gamma"]);
    expect(names(filter("file.hasLink(this.file)"), { self: "Index" })).toEqual([]);
    expect(names(filter("file.hasLink(this)"), { self: "Alpha.md" })).toEqual(["Gamma", "Index"]);
  });

  it("makes an error cell of a formula that refers to itself", () => {
    const source = [
      "formulas:",
      "  a: 'formula.b + 1'",
      "  b: 'formula.a + 1'",
      "views:",
      "  - type: table",
      "    filters: 'file.name == \"Alpha\"'",
      "    order: [formula.a]",
    ].join("\n");
    const result = queryBase(WIKI, parseBase(source), { now: NOW });
    expect(result.rows[0]?.values["formula.a"]).toMatch(/^Error: The formula “a” refers to itself/);
  });

  it("orders, sorts, limits, labels and groups a view, and caps what comes back", () => {
    const source = [
      "properties:",
      "  note.priority:",
      "    displayName: Priority",
      "views:",
      "  - type: cards",
      "    name: By priority",
      '    filters: "file.hasProperty(\\"priority\\")"',
      "    order: [file.basename, priority, file.links]",
      "    sort:",
      "      - property: priority",
      "        direction: DESC",
      "    limit: 2",
      "  - type: table",
      "    name: By status",
      "    groupBy: { property: status, direction: ASC }",
      "    order: [file.name, file.mtime]",
    ].join("\n");
    const base = parseBase(source);
    const cards = queryBase(WIKI, base, { now: NOW });
    expect(cards.view).toEqual({ name: "By priority", type: "cards" });
    expect(cards.views).toEqual(["By priority", "By status"]);
    expect(cards.columns).toEqual([
      { id: "file.basename", label: "file base name" },
      { id: "priority", label: "Priority" },
      { id: "file.links", label: "file links" },
    ]);
    expect(cards.rows).toEqual([
      {
        name: "Delta",
        file: "Delta.md",
        values: { "file.basename": "Delta", priority: 3, "file.links": [] },
      },
      {
        name: "Alpha",
        file: "Alpha.md",
        // A link in the frontmatter counts, as in Obsidian.
        values: {
          "file.basename": "Alpha",
          priority: 2,
          "file.links": ["[[Venkat|Venkat]]", "[[Beta|Beta]]", "[[Textbook|Textbook]]"],
        },
      },
    ]);
    expect(cards.total).toBe(2);

    const grouped = queryBase(WIKI, base, { view: "by status", now: NOW, cap: 3 });
    expect(grouped.groupBy).toEqual({ id: "status", label: "status" });
    expect(grouped.rows.map((row) => [row.name, row.group])).toEqual([
      ["Beta", "done"],
      ["Alpha", "open"],
      ["Code", null],
    ]);
    expect(grouped.groups.map((group) => [group.value, group.count])).toEqual([
      ["done", 1],
      ["open", 1],
      [null, 6],
    ]);
    expect(grouped.rows[1]?.values["file.mtime"]).toBe(
      formatDate(Date.parse("2026-10-30T12:00:00.000Z"), "YYYY-MM-DDTHH:mm:ss"),
    );
    expect(grouped.total).toBe(8);
    expect(grouped.truncated).toBe(true);
  });
});
