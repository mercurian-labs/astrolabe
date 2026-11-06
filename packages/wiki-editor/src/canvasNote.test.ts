import { describe, expect, it } from "vite-plus/test";

import { noteSection } from "./canvasNote";

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
