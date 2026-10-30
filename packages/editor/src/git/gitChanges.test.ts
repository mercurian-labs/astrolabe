import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { vimMode, type VimHistory } from "../vim.ts";
import {
  expandedHunks,
  gitChanges,
  gitHunks,
  hunkBeside,
  hunksTouching,
  runHunkCommand,
  setGitBase,
  type Hunk,
} from "./gitChanges.ts";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function stateOf(base: string, doc: string, extensions: Extension = []) {
  const state = EditorState.create({ doc, extensions: [gitChanges(), extensions] });
  return state.update({ effects: setGitBase(base) }).state;
}

function mount(base: string, doc: string, extensions: Extension = []) {
  view = new EditorView({ parent: document.body, state: stateOf(base, doc, extensions) });
  return view;
}

/** Each hunk as its kind and its lines in the document, 1-based. */
function shape(state: EditorState, hunks: readonly Hunk[] = gitHunks(state)) {
  return hunks.map((hunk) => [
    hunk.kind,
    state.doc.lineAt(hunk.from).number,
    state.doc.lineAt(hunk.to).number,
  ]);
}

function cursorOnLine(state: EditorState, line: number) {
  return state.update({ selection: EditorSelection.cursor(state.doc.line(line).from) }).state;
}

function oldBlocks(editor: EditorView) {
  return [...editor.contentDOM.querySelectorAll(".atlas-git-old-lines")].map((block) =>
    [...block.querySelectorAll(".atlas-old-line")].map((row) => row.textContent),
  );
}

const lines = (...text: string[]) => text.map((line) => `${line}\n`).join("");

describe("hunks against the base", () => {
  it("marks changed, added and deleted lines, and none without a base", () => {
    const changed = stateOf(lines("a", "b", "c"), lines("a", "B", "c", "d"));
    expect(shape(changed)).toEqual([
      ["modified", 2, 2],
      ["added", 4, 4],
    ]);
    const deleted = stateOf(lines("a", "b", "c"), lines("a", "c"));
    // A deletion sits on the line after the lines it took.
    expect(shape(deleted)).toEqual([["deleted", 2, 2]]);
    const plain = EditorState.create({ doc: "a\n", extensions: gitChanges() });
    expect(gitHunks(plain)).toEqual([]);
  });

  it("follows edits: a deletion typed back in turns modified, and undoing the edit clears it", () => {
    let state = stateOf(lines("a", "b", "c"), lines("a", "c"));
    const at = state.doc.line(2).from;
    state = state.update({ changes: { from: at, insert: "x\n" } }).state;
    expect(shape(state)).toEqual([["modified", 2, 2]]);
    state = state.update({ changes: { from: at, to: at + 1, insert: "b" } }).state;
    expect(gitHunks(state)).toEqual([]);
  });

  it("compares against a new base when one is set, and against none once cleared", () => {
    let state = stateOf(lines("a", "b"), lines("a", "b", "c"));
    expect(shape(state)).toEqual([["added", 3, 3]]);
    state = state.update({ effects: setGitBase(lines("a", "b", "c")) }).state;
    expect(gitHunks(state)).toEqual([]);
    state = state.update({ effects: setGitBase(null) }).state;
    expect(gitHunks(state)).toEqual([]);
  });

  it("finds the hunks under a selection, and a deletion from the line on either side of it", () => {
    const state = stateOf(lines("1", "2", "3", "4", "5", "6"), lines("1", "2", "3", "5", "6"));
    // Line 4 took line "4"'s place: lines 3 and 4 touch the deletion, line 6 does not.
    expect(shape(state, hunksTouching(cursorOnLine(state, 3)))).toEqual([["deleted", 4, 4]]);
    expect(shape(state, hunksTouching(cursorOnLine(state, 4)))).toEqual([["deleted", 4, 4]]);
    expect(hunksTouching(cursorOnLine(state, 5))).toEqual([]);
  });

  it("steps to the hunk after or before the cursor's line, wrapping at the ends", () => {
    const base = Array.from({ length: 16 }, (_, i) => `line ${i}`);
    const doc = [...base];
    doc[14] = "line 14 changed";
    doc.splice(9, 1, "line 9 changed");
    doc.splice(5, 1);
    doc[2] = "line 2 changed";
    const state = stateOf(lines(...base), lines(...doc));
    const starts = gitHunks(state).map((hunk) => state.doc.lineAt(hunk.from).number);
    expect(starts).toEqual([3, 6, 9, 14]);
    const step = (from: number, direction: 1 | -1) =>
      state.doc.lineAt(hunkBeside(state, state.doc.line(from).from, direction)!.from).number;
    expect([step(1, 1), step(3, 1), step(6, 1), step(9, 1), step(14, 1)]).toEqual([3, 6, 9, 14, 3]);
    expect([step(3, -1), step(14, -1)]).toEqual([14, 9]);
  });
});

describe("the gutter", () => {
  it("draws a strip on each added or changed line, and a notch where lines were deleted", () => {
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];
    const editor = mount(
      lines(...words),
      lines("alpha", "BRAVO", "CHARLIE", "delta", "echo", "foxtrot", "golf", "hotel"),
    );
    const kinds = (kind: string) =>
      editor.dom.querySelectorAll(`.atlas-git-gutter .atlas-git-${kind}`).length;
    expect([kinds("modified"), kinds("added"), kinds("deleted")]).toEqual([2, 1, 0]);
    // Deleting "echo" leaves a notch on "foxtrot", the line after it.
    const echo = editor.state.doc.line(5);
    editor.dispatch({ changes: { from: echo.from, to: echo.to + 1 } });
    expect([kinds("modified"), kinds("added"), kinds("deleted")]).toEqual([2, 1, 1]);
  });
});

describe("restoring a hunk", () => {
  it("puts back only the hunks the cursor touches, as one undoable edit", () => {
    const base = lines("a", "b", "c", "d");
    const editor = mount(base, lines("a", "B", "c", "d", "e"), history());
    editor.dispatch({ selection: { anchor: editor.state.doc.line(2).from } });
    expect(runHunkCommand(editor, "restore")).toBe(true);
    expect(editor.state.doc.toString()).toBe(lines("a", "b", "c", "d", "e"));
    expect(shape(editor.state)).toEqual([["added", 5, 5]]);
    undo(editor);
    expect(editor.state.doc.toString()).toBe(lines("a", "B", "c", "d", "e"));
  });

  it("brings deleted lines back, at the end of a file without a final line break too", () => {
    const editor = mount("a\nb\nc", "a\nb");
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
    expect(runHunkCommand(editor, "restore")).toBe(true);
    expect(editor.state.doc.toString()).toBe("a\nb\nc");
    expect(gitHunks(editor.state)).toEqual([]);
  });

  it("refuses in a read-only editor", () => {
    const editor = mount(lines("a"), lines("b"), EditorState.readOnly.of(true));
    expect(runHunkCommand(editor, "restore")).toBe(false);
    expect(editor.state.doc.toString()).toBe(lines("b"));
  });
});

describe("expanding hunks", () => {
  const base = lines("one", "two", "three", "four", "five", "six", "seven", "eight");
  const doc = lines("one", "TWO", "three", "four", "six", "seven", "eight", "nine");

  it("shows a hunk's old lines above it once expanded, and hides them when toggled again", () => {
    const editor = mount(base, doc);
    expect(oldBlocks(editor)).toEqual([]);
    editor.dispatch({ selection: { anchor: editor.state.doc.line(2).from } });
    runHunkCommand(editor, "toggle");
    expect(oldBlocks(editor)).toEqual([["two"]]);
    expect(editor.contentDOM.querySelector(".atlas-git-new-line")?.textContent).toBe("TWO");
    runHunkCommand(editor, "toggle");
    expect(oldBlocks(editor)).toEqual([]);
  });

  it("toggles neighbours on their own, expands all at once, and collapses all on Escape", () => {
    const editor = mount(base, doc);
    editor.dispatch({ selection: { anchor: editor.state.doc.line(5).from } });
    runHunkCommand(editor, "toggle");
    // Line 5 touches the deletion of "five" only; "nine" stays collapsed.
    expect(shape(editor.state, expandedHunks(editor.state))).toEqual([["deleted", 5, 5]]);
    expect(oldBlocks(editor)).toEqual([["five"]]);

    runHunkCommand(editor, "expandAll");
    expect(shape(editor.state, expandedHunks(editor.state))).toEqual([
      ["modified", 2, 2],
      ["deleted", 5, 5],
      ["added", 8, 8],
    ]);
    // An addition has no old lines, only its bar.
    expect(oldBlocks(editor)).toEqual([["two"], ["five"]]);
    expect(editor.contentDOM.querySelectorAll(".atlas-git-controls")).toHaveLength(3);

    editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(expandedHunks(editor.state)).toEqual([]);
    expect(oldBlocks(editor)).toEqual([]);
  });

  it("keeps a hunk expanded through edits around it, and grows its old lines as it grows", () => {
    const editor = mount(base, doc);
    editor.dispatch({ selection: { anchor: editor.state.doc.line(5).from } });
    runHunkCommand(editor, "toggle");
    const block = editor.contentDOM.querySelector(".atlas-git-old-lines");
    editor.dispatch({ changes: { from: 0, insert: "zero\n" } });
    // Typing elsewhere leaves the drawn block as it was.
    expect(editor.contentDOM.querySelector(".atlas-git-old-lines")).toBe(block);
    expect(oldBlocks(editor)).toEqual([["five"]]);

    // Deleting the line above the deletion ("four") merges it in.
    const four = editor.state.doc.line(5);
    editor.dispatch({ changes: { from: four.from, to: four.to + 1 } });
    expect(oldBlocks(editor)).toEqual([["four", "five"]]);
  });

  it("re-resolves to the new hunks when the base changes", () => {
    const editor = mount(base, doc);
    runHunkCommand(editor, "expandAll");
    editor.dispatch({
      effects: setGitBase(lines("one", "two!", "three", "four", "six", "seven", "eight", "nine")),
    });
    expect(oldBlocks(editor)).toEqual([["two!"]]);
  });

  it("restores from the bar over an expanded hunk", () => {
    const editor = mount(base, doc);
    editor.dispatch({ selection: { anchor: editor.state.doc.line(2).from } });
    runHunkCommand(editor, "toggle");
    const restoreButton = [...editor.contentDOM.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore",
    );
    restoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.state.doc.line(2).text).toBe("two");
    expect(oldBlocks(editor)).toEqual([]);
  });

  it("colours old lines in the editor's language", () => {
    const editor = mount(lines("# Old title", "body"), lines("# New title", "body"), markdown());
    runHunkCommand(editor, "expandAll");
    const row = editor.contentDOM.querySelector(".atlas-git-old-lines .atlas-old-line");
    expect(row?.textContent).toBe("# Old title");
    expect(row?.querySelector("span[class*='tok-']")).not.toBeNull();
  });

  it("with Vim on, Escape leaves insert mode first, then collapses from normal mode", () => {
    const noHistory: VimHistory = {
      undo() {},
      redo() {},
      stopCapturing() {},
      groupExplicitly() {},
    };
    const editor = mount(base, doc, vimMode(noHistory));
    editor.focus();
    runHunkCommand(editor, "expandAll");
    const key = (name: string, keyCode: number) =>
      editor.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, keyCode, bubbles: true, cancelable: true }),
      );
    key("i", 73);
    key("Escape", 27);
    expect(expandedHunks(editor.state)).toHaveLength(3);
    key("Escape", 27);
    expect(expandedHunks(editor.state)).toEqual([]);
  });

  it("with Vim on, ]c and [c step to the next and previous hunk", () => {
    const noHistory: VimHistory = {
      undo() {},
      redo() {},
      stopCapturing() {},
      groupExplicitly() {},
    };
    const editor = mount(base, doc, vimMode(noHistory));
    editor.focus();
    const type = (...keys: string[]) => {
      for (const key of keys) {
        editor.contentDOM.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      }
    };
    const line = () => editor.state.doc.lineAt(editor.state.selection.main.head).number;
    type("]", "c");
    expect(line()).toBe(2);
    type("]", "c");
    expect(line()).toBe(5);
    type("[", "c", "[", "c");
    expect(line()).toBe(8);
  });
});
