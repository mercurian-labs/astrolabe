import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vite-plus/test";

import { noteExcerpt, typeSuggestions } from "./linkTools";

describe("noteExcerpt", () => {
  it("quotes a note's text without its frontmatter, title, code or markup", () => {
    const source = [
      "---",
      "status: open",
      "---",
      "# Auth",
      "",
      "Sign in with **a key** via [[Passkeys|the @flow]] and [the docs](https://x.dev).",
      "",
      "```",
      "code",
      "```",
      "",
      "Then [[Sessions]].",
    ].join("\n");
    expect(noteExcerpt(source)).toBe(
      "Sign in with a key via the flow and the docs. Then Sessions.",
    );
  });

  it("cuts a long note short", () => {
    const excerpt = noteExcerpt(`${"word ".repeat(100)}\n`);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(241);
  });
});

describe("typeSuggestions", () => {
  const at = (before: string, after = "") =>
    typeSuggestions({ state: EditorState.create({ doc: before + after }), pos: before.length }, [
      "blocks",
      "depends_on",
    ]);

  it("offers the wiki's types on an `@` word in a link's display text", () => {
    expect(at("[[Auth|@")).toMatchObject({ from: 8 });
    expect(at("See [[Auth|the flow @dep", "]]")?.from).toBe(21);
    expect(at("[[Auth|@")?.options.map((option) => option.label)).toEqual(["blocks", "depends_on"]);
  });

  it("stays out of everything else", () => {
    expect(at("mail @sam")).toBeNull();
    expect(at("[[Auth@")).toBeNull();
    expect(at("[[Auth|me@ex")).toBeNull();
    expect(at("[[Auth|text]] @")).toBeNull();
  });
});
