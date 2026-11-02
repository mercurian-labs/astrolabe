import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vite-plus/test";

import { repositoryFileReveal, revealLine } from "./repositoryFileReveal";

describe("revealing a line in a Repositories file", () => {
  const state = EditorState.create({ doc: "one\ntwo\nthree" });
  const anchorOf = (line: number) => {
    const spec = revealLine(state, line);
    return state.update(spec).state.selection.main.head;
  };

  it("puts the cursor at the start of the line, and on the last line past the end", () => {
    expect(anchorOf(1)).toBe(0);
    expect(anchorOf(3)).toBe("one\ntwo\n".length);
    expect(anchorOf(40)).toBe("one\ntwo\n".length);
  });

  it("puts it at a column when asked, and at the line's end past it", () => {
    const at = (line: number, column: number) =>
      state.update(revealLine(state, line, column)).state.selection.main.head;
    expect(at(2, 2)).toBe("one\nt".length);
    expect(at(2, 40)).toBe("one\ntwo".length);
  });

  it("is shown once: a tab opened again after it does not jump back", () => {
    repositoryFileReveal.request("tab", 3);
    const first = repositoryFileReveal.get()!;
    repositoryFileReveal.done(first.id);
    expect(repositoryFileReveal.get()).toBeNull();

    repositoryFileReveal.request("tab", 3);
    const again = repositoryFileReveal.get()!;
    expect(again.id).not.toBe(first.id);
    // A view finishing an older request leaves a newer one standing.
    repositoryFileReveal.done(first.id);
    expect(repositoryFileReveal.get()).toBe(again);
  });
});
