import { describe, expect, it } from "vite-plus/test";

import {
  baseViewNames,
  noteBlocks,
  noteHeadings,
  noteSection,
  noteWithBlockId,
} from "./canvasNote";

const note = [
  "---",
  "status: open",
  "---",
  "# Top",
  "intro",
  "## Two",
  "in two ^block1",
  "",
  "### Deeper",
  "still two",
  "```",
  "# not a heading",
  "```",
  "## Three",
  "- a list item ^item",
  "- another",
].join("\n");

describe("noteSection", () => {
  it("shows a whole note with its properties apart", () => {
    const { properties, text } = noteSection(note, undefined);
    expect(properties).toBe("status: open");
    expect(text?.startsWith("# Top")).toBe(true);
  });

  it("narrows to a heading, through deeper headings, up to the next at its level", () => {
    const { text, properties } = noteSection(note, "#Two");
    expect(properties).toBeNull();
    expect(text).toContain("still two");
    expect(text).toContain("# not a heading");
    expect(text).not.toContain("Three");
  });

  it("narrows to a block, without its id", () => {
    expect(noteSection(note, "#^block1").text).toBe("in two");
    expect(noteSection(note, "#^item").text).toBe("- a list item");
  });

  it("finds nothing for a heading or block the note doesn't hold", () => {
    expect(noteSection(note, "#Gone").text).toBeNull();
    expect(noteSection(note, "#^gone").text).toBeNull();
  });
});

describe("narrowing a card", () => {
  const NOTE = [
    "---",
    "status: open",
    "---",
    "# One",
    "",
    "First paragraph",
    "runs on.",
    "",
    "- an item ^named",
    "- another",
    "",
    "```",
    "# not a heading",
    "```",
    "",
    "## Two",
  ].join("\n");

  it("lists headings, outside code", () => {
    expect(noteHeadings(NOTE)).toEqual(["One", "Two"]);
  });

  it("lists blocks with their ids", () => {
    expect(noteBlocks(NOTE).map(({ text, id }) => [text, id])).toEqual([
      ["First paragraph runs on.", null],
      ["- an item", "named"],
      ["- another", null],
    ]);
  });

  it("writes a new id on a block's last line, which then reads back", () => {
    const [paragraph] = noteBlocks(NOTE);
    const written = noteWithBlockId(NOTE, paragraph!.line, "d74163");
    expect(written).toContain("runs on. ^d74163\n");
    expect(noteBlocks(written)[0]?.id).toBe("d74163");
    expect(noteSection(written, "#^d74163").text).toBe("First paragraph\nruns on.");
  });

  it("reads a base's view names, without its YAML parser", () => {
    const base =
      'filters:\n  name: not a view\nviews:\n  - type: table\n    name: Table\n  - type: cards\n    name: "Cards Two"\n';
    expect(baseViewNames(base)).toEqual(["Table", "Cards Two"]);
  });
});
