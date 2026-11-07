import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vite-plus/test";

import { linkFiles } from "@mercurian/wiki/resolve-link";

import { noteExcerpt, nameSuggestions, peekOf, typeSuggestions } from "./linkTools";

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

describe("peekOf", () => {
  const scope = { files: linkFiles(["a/Name.md", "b/Name.md"]), from: "a/L.md" };
  const doc = "[[Name|x @one]] [[a/Name|y @two]] [[b/Name|z @three]]";

  it("gathers a link's types by the file it opens, however it's spelled", () => {
    const state = EditorState.create({ doc });
    expect(peekOf(state, "Name", scope)?.types).toEqual(["one", "two"]);
    expect(peekOf(state, "b/Name", scope)?.types).toEqual(["three"]);
    expect(peekOf(state, "Name", null)?.types).toEqual(["one"]);
  });
});

describe("nameSuggestions", () => {
  const at = (before: string, after = "") =>
    nameSuggestions({ state: EditorState.create({ doc: before + after }), pos: before.length }, [
      { label: "Alpha", apply: "Alpha" },
      { label: "x/Board.canvas", apply: "x/Board.canvas|Board.canvas" },
    ]);

  it("offers the wiki's documents on a link's name", () => {
    expect(at("See [[")).toMatchObject({ from: 6 });
    expect(at("See [[Bo", "]]")?.from).toBe(6);
    expect(at("[[")?.options.map((option) => option.apply)).toEqual([
      "Alpha",
      "x/Board.canvas|Board.canvas",
    ]);
  });

  it("stays out of a link's heading, its display text, and everything else", () => {
    expect(at("[[Alpha#")).toBeNull();
    expect(at("[[Alpha|")).toBeNull();
    expect(at("[Alpha")).toBeNull();
    expect(at("[[Alpha]] and")).toBeNull();
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
