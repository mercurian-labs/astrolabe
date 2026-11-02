// @effect-diagnostics nodeBuiltinImport:off - fixtures are files beside the test.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  BaseError,
  baseBlocks,
  indexFiles,
  noteProperties,
  noteTags,
  parseBase,
  queryBase,
  type BaseQueryOptions,
} from "./index.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const WIKI = indexFiles({
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
});

const EDITED = new Map([
  ["Alpha.md", "2026-10-30T12:00:00.000Z"],
  ["Beta.md", "2026-09-01T12:00:00.000Z"],
]);
const NOW = Date.parse("2026-11-01T12:00:00.000Z");

type Options = Partial<BaseQueryOptions>;

const names = (source: string, options: Options = {}) =>
  queryBase(WIKI, parseBase(source), { editTimes: EDITED, now: NOW, ...options }).rows.map(
    (row) => row.name,
  );
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
    expect(noteTags(source, noteProperties(source))).toEqual(["#Project", "#area/sub", "#inline"]);
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

describe("queries", () => {
  it("runs Obsidian's own example filter, copied verbatim, over the wiki's notes", () => {
    // Alpha is a book that links the Textbook; Delta is a book that does not.
    expect(names(fixture("obsidian-complex-filter.base"))).toEqual([
      "Alpha",
      "Beta",
      "Code",
      "Gamma",
      "Index",
      "Textbook",
    ]);
    const embedded = queryBase(WIKI, parseBase(fixture("obsidian-embedded.base")), { now: NOW });
    expect(embedded.view).toEqual({ name: "Table", type: "table" });
    expect(embedded.rows).toEqual([]);
  });

  it("fails Obsidian's full example loudly, naming the formula it cannot run", () => {
    expect(failure(fixture("obsidian-syntax-example.base"))).toBe(
      "Not supported: formula.ppu (formulas) in view “My table”'s filters `formula.ppu > 5`.",
    );
  });

  it("fails on anything outside the subset, even where no note would reach it", () => {
    expect(failure(filter("false && file.ctime > 0"))).toMatch(/Not supported: file\.ctime/);
    expect(failure(filter("if(status, true, false)"))).toMatch(/Not supported: if\(\)/);
    expect(failure(filter('status.replace("a", "b")'))).toMatch(/status\.replace\(\)/);
    expect(failure(filter("/ab/.matches(status)"))).toMatch(/regular expressions/);
    expect(failure(filter("formula"))).toMatch(/formulas/);
    expect(failure("views:\n  - type: kanban\n")).toMatch(/the kanban view/);
    expect(failure("views:\n  - type: table\n    order: [formula.x]\n")).toMatch(/formula\.x/);
    expect(failure("views:\n  - type: table\n    order: [file.embeds]\n")).toMatch(/file\.embeds/);
    expect(
      failure("views:\n  - type: table\n    groupBy: { property: status }\n    groupOrder: [a]\n"),
    ).toMatch(/groupOrder/);
    expect(failure("views:\n  - type: table\n    summaries: { priority: Average }\n")).toMatch(
      /summaries/,
    );
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
    expect(names(filter("file.backlinks.isEmpty()"))).toEqual(["Code", "Delta", "Gamma", "Index"]);
    expect(names(filter('file.hasTag("area")'))).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(names(filter('file.hasTag("notatag") || file.hasProperty("kind")'))).toEqual(["Index"]);
    expect(
      names(filter('file.inFolder("/") && file.ext == "md" && file.name == "Beta.md"')),
    ).toEqual(["Beta"]);
  });

  it("runs a block embedded in a note with `this` as that note: the tail after a curated head", () => {
    const [block] = baseBlocks(WIKI.notes.get("index")!.source);
    expect(names(block!, { self: "Index.md" })).toEqual(["Gamma"]);
    expect(names(filter("file.hasLink(this.file)"), { self: "Index" })).toEqual([]);
    expect(names(filter("file.hasLink(this)"), { self: "Alpha.md" })).toEqual(["Gamma", "Index"]);
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
    const cards = queryBase(WIKI, base, { editTimes: EDITED, now: NOW });
    expect(cards.view).toEqual({ name: "By priority", type: "cards" });
    expect(cards.views).toEqual(["By priority", "By status"]);
    expect(cards.columns).toEqual([
      { id: "file.basename", label: "Name" },
      { id: "priority", label: "Priority" },
      { id: "file.links", label: "Links" },
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
          "file.links": ["[[Venkat]]", "[[Beta]]", "[[Textbook]]"],
        },
      },
    ]);
    expect(cards.total).toBe(2);

    const grouped = queryBase(WIKI, base, {
      view: "by status",
      editTimes: EDITED,
      now: NOW,
      cap: 3,
    });
    expect(grouped.groupBy).toEqual({ id: "status", label: "status" });
    expect(grouped.rows.map((row) => [row.name, row.group])).toEqual([
      ["Beta", "done"],
      ["Alpha", "open"],
      ["Code", null],
    ]);
    expect(grouped.rows[1]?.values["file.mtime"]).toBe("2026-10-30T12:00:00.000Z");
    expect(grouped.total).toBe(7);
    expect(grouped.truncated).toBe(true);
  });
});
