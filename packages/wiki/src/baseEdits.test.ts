import { describe, expect, it } from "vite-plus/test";

import {
  applyBaseEdits,
  baseProblems,
  baseCorpus,
  BaseError,
  corpusWithChanges,
  parseBase,
  planTransform,
  queryBase,
  setNoteProperty,
} from "./index.ts";

const BASE = [
  "# Kept as written",
  'filters: file.ext == "md"',
  "views:",
  "  - type: table",
  "    name: Open",
  "    order:",
  "      - file.name",
  "      - status",
  "  - type: cards",
  "    name: Wall",
  "",
].join("\n");

const FILES = {
  "Work.base": BASE,
  "Alpha.md": '---\nstatus: open\nowner: "[[Priya]]"\n---\n# Alpha\n\nBody stays.\n',
  "Beta.md": "# Beta\n\nNo properties yet.\n",
};

const NOW = Date.parse("2026-11-03T12:00:00Z");

describe("applyBaseEdits", () => {
  it("edits a base and notes in folders, and refuses a path a wiki can't hold", () => {
    const files = { "work/Open.base": BASE, "work/notes/Alpha.md": "# Alpha\n" };
    const changes = applyBaseEdits(files, [
      { kind: "property", file: "work/notes/Alpha.md", property: "status", value: "open" },
      { kind: "create", file: "work/notes/New.md", properties: { status: "open" } },
      { kind: "formula", base: "work/Open.base", name: "x", expression: "1" },
    ]);
    expect(changes["work/notes/Alpha.md"]).toContain("status: open");
    expect(changes["work/notes/New.md"]).toContain("status: open");
    expect(changes["work/Open.base"]).toContain("x:");
    expect(() =>
      applyBaseEdits(files, [{ kind: "create", file: "../New.md", properties: {} }]),
    ).toThrow(BaseError);
    expect(() =>
      applyBaseEdits(files, [
        { kind: "property", file: "work/Open.base", property: "status", value: "open" },
      ]),
    ).toThrow(BaseError);
  });

  it("changes a view's settings, keeping the rest of the base as written", () => {
    const changes = applyBaseEdits(FILES, [
      {
        kind: "view",
        base: "Work.base",
        view: "Open",
        settings: { sort: [{ property: "status", direction: "DESC" }], limit: 5 },
      },
    ]);
    const source = changes["Work.base"]!;
    expect(source).toContain("# Kept as written");
    const view = parseBase(source).views[0]!;
    expect(view.config.sort).toEqual([{ property: "status", direction: "DESC" }]);
    expect(view.config.limit).toBe(5);
    expect(view.config.order).toEqual(["file.name", "status"]);
  });

  it("renames, adds, copies and removes views, keeping at least one", () => {
    const changes = applyBaseEdits(FILES, [
      { kind: "view", base: "Work.base", view: "Open", name: "Still open" },
      { kind: "add-view", base: "Work.base", name: "Board", type: "kanban", copy: "Still open" },
      { kind: "remove-view", base: "Work.base", view: "Wall" },
    ]);
    const views = parseBase(changes["Work.base"]!).views;
    expect(views.map((view) => [view.name, view.config.type])).toEqual([
      ["Still open", "table"],
      ["Board", "kanban"],
    ]);
    expect(views[1]!.config.order).toEqual(["file.name", "status"]);
    expect(() =>
      applyBaseEdits({ "One.base": "views:\n  - type: table\n" }, [
        { kind: "remove-view", base: "One.base", view: "Table" },
      ]),
    ).toThrow("A base keeps at least one view.");
    expect(() =>
      applyBaseEdits(FILES, [{ kind: "view", base: "Work.base", view: "Open", name: "wall" }]),
    ).toThrow("already has a view named “wall”");
  });

  it("removes a setting set to null, and gives a base without views its table first", () => {
    const cleared = applyBaseEdits(FILES, [
      { kind: "view", base: "Work.base", view: "Open", settings: { order: null } },
    ]);
    expect(parseBase(cleared["Work.base"]!).views[0]!.config.order).toBeUndefined();
    const made = applyBaseEdits({ "Bare.base": 'filters: file.ext == "md"\n' }, [
      { kind: "view", base: "Bare.base", view: "Table", settings: { rowHeight: "tall" } },
    ]);
    expect(parseBase(made["Bare.base"]!).views[0]!.config).toEqual({
      type: "table",
      name: "Table",
      rowHeight: "tall",
    });
  });

  it("sets formulas and display names", () => {
    const changes = applyBaseEdits(FILES, [
      { kind: "formula", base: "Work.base", name: "late", expression: 'status == "open"' },
      { kind: "display-name", base: "Work.base", property: "note.status", displayName: "State" },
    ]);
    const base = parseBase(changes["Work.base"]!);
    expect(base.formulas).toEqual({ late: 'status == "open"' });
    expect(base.properties).toEqual({ "note.status": { displayName: "State" } });
    const undone = applyBaseEdits({ "Work.base": changes["Work.base"]! }, [
      { kind: "formula", base: "Work.base", name: "late", expression: null },
      { kind: "display-name", base: "Work.base", property: "note.status", displayName: null },
    ]);
    expect(parseBase(undone["Work.base"]!).formulas).toEqual({});
    expect(parseBase(undone["Work.base"]!).properties).toEqual({});
  });

  it("sets a note's property and leaves its prose byte for byte", () => {
    const changes = applyBaseEdits(FILES, [
      { kind: "property", file: "Alpha.md", property: "note.status", value: "closed" },
      { kind: "property", file: "Beta.md", property: "tags", value: ["area", "draft"] },
    ]);
    expect(changes["Alpha.md"]).toBe(
      '---\nstatus: closed\nowner: "[[Priya]]"\n---\n# Alpha\n\nBody stays.\n',
    );
    expect(changes["Beta.md"]).toBe(
      "---\ntags:\n  - area\n  - draft\n---\n\n# Beta\n\nNo properties yet.\n",
    );
  });

  it("removes a note's frontmatter with its last property", () => {
    expect(setNoteProperty("---\ndone: true\n---\n# A\n", "done", null)).toBe("# A\n");
    expect(setNoteProperty("# A\n", "owner", "[[Sam]]")).toBe(
      '---\nowner: "[[Sam]]"\n---\n\n# A\n',
    );
  });

  it("writes a new note with its properties, and never over one", () => {
    expect(
      applyBaseEdits(FILES, [
        { kind: "create", file: "Gamma.md", properties: { status: "open", owner: null } },
      ]),
    ).toEqual({ "Gamma.md": "---\nstatus: open\n---\n" });
    expect(() =>
      applyBaseEdits(FILES, [{ kind: "create", file: "alpha.md", properties: {} }]),
    ).toThrow("alpha already exists.");
  });

  it("refuses files in folders, worked-out properties and missing files", () => {
    expect(() =>
      applyBaseEdits(FILES, [
        { kind: "property", file: "projects/Delta.md", property: "status", value: "x" },
      ]),
    ).toThrow(BaseError);
    expect(() =>
      applyBaseEdits(FILES, [
        { kind: "property", file: "Alpha.md", property: "file.name", value: "x" },
      ]),
    ).toThrow("can't be edited");
    expect(() =>
      applyBaseEdits(FILES, [{ kind: "property", file: "Nope.md", property: "x", value: 1 }]),
    ).toThrow("No note Nope.md to edit.");
  });

  it("lands as a transform, as a change request saves it", () => {
    expect(
      planTransform(
        FILES,
        {
          kind: "base-edits",
          edits: [{ kind: "property", file: "Alpha.md", property: "status", value: "done" }],
        },
        { amendment: "a", at: "2026-11-03T12:00:00Z" },
      ),
    ).toEqual({
      "Alpha.md": '---\nstatus: done\nowner: "[[Priya]]"\n---\n# Alpha\n\nBody stays.\n',
    });
  });
});

describe("previewing edits", () => {
  it("runs a view over the corpus with the edits applied", () => {
    const corpus = baseCorpus(Object.entries(FILES).map(([file, source]) => ({ file, source })));
    const changes = applyBaseEdits(FILES, [
      { kind: "property", file: "Beta.md", property: "status", value: "open" },
      { kind: "create", file: "Gamma.md", properties: { status: "open" } },
    ]);
    const result = queryBase(
      corpusWithChanges(corpus, changes),
      parseBase('filters: status == "open"\n'),
      { now: NOW },
    );
    expect(result.rows.map((row) => row.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("what a view draws", () => {
  const corpus = baseCorpus([
    {
      file: "Paris.md",
      source:
        '---\nwhere: "48.85837, 2.294481"\nicon: landmark\ncover: "[[tower.png]]"\ndue: 2026-01-05\n---\n',
    },
    { file: "Rome.md", source: '---\nwhere:\n  - 41.9\n  - 12.5\ncover: "#ff0000"\n---\n' },
    { file: "Nowhere.md", source: "---\nwhere: north\n---\n" },
    { file: "attachments/tower.png", size: 10 },
  ]);

  it("gives a map view's markers from its coordinates property", () => {
    const result = queryBase(
      corpus,
      parseBase(
        'filters: file.ext == "md"\nviews:\n  - type: map\n    name: Map\n    coordinates: note.where\n    markerIcon: note.icon\n    defaultZoom: 6\n',
      ),
      { now: NOW },
    );
    expect(result.settings).toEqual({
      coordinates: "note.where",
      markerIcon: "note.icon",
      defaultZoom: 6,
    });
    expect(result.rows.map((row) => [row.name, row.marker])).toEqual([
      ["Nowhere", undefined],
      ["Paris", { lat: 48.85837, lng: 2.294481, icon: "landmark" }],
      ["Rome", { lat: 41.9, lng: 12.5 }],
    ]);
  });

  it("gives a card its cover: a file in the repository, a URL or a colour", () => {
    const result = queryBase(
      corpus,
      parseBase(
        'filters: file.ext == "md"\nviews:\n  - type: cards\n    image: note.cover\n    imageFit: contain\n    cardSize: 240\n',
      ),
      { now: NOW },
    );
    expect(result.settings).toMatchObject({
      image: "note.cover",
      imageFit: "contain",
      cardSize: 240,
    });
    expect(result.rows.map((row) => row.cover)).toEqual([
      undefined,
      { kind: "file", path: "attachments/tower.png" },
      { kind: "color", color: "#ff0000" },
    ]);
  });

  it("marks cells that aren't plain text: dates, HTML, icons and errors", () => {
    const result = queryBase(
      corpus,
      parseBase(
        [
          'filters: file.name == "Paris"',
          "formulas:",
          '  bold: html("<b>" + file.name + "</b>")',
          '  arrow: icon("arrow-right")',
          "  wrong: owner.linksTo(file)",
          '  site: link("https://obsidian.md")',
          "views:",
          "  - type: table",
          "    order: [file.name, due, formula.bold, formula.arrow, formula.wrong, formula.site]",
        ].join("\n"),
      ),
      { now: NOW },
    );
    expect(result.rows[0]?.display).toEqual({
      due: { kind: "date", date: "2026-01-05" },
      "formula.bold": { kind: "html", html: "<b>Paris</b>" },
      "formula.arrow": { kind: "icon", name: "arrow-right" },
      "formula.site": { kind: "url", href: "https://obsidian.md", text: "https://obsidian.md" },
    });
  });

  it("lists every property a view could show", () => {
    const result = queryBase(corpus, parseBase("formulas:\n  two: 1 + 1\n"), { now: NOW });
    const ids = result.properties.map((property) => property.id);
    expect(ids.slice(0, 5)).toEqual([
      "note.cover",
      "note.due",
      "note.icon",
      "note.where",
      "formula.two",
    ]);
    expect(ids).toContain("file.name");
    expect(ids).not.toContain("file.properties");
  });
});

it("reads a link to a web address as no note's name", () => {
  const source = 'formulas:\n  site: link("https://obsidian.md")\n  note: link("Missing")\n';
  expect(baseProblems(source, () => false)).toEqual([
    "Names “Missing”, but no note is called that or links to it.",
  ]);
});
