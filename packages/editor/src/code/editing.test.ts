import { afterEach, describe, expect, it } from "vite-plus/test";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";

import { vimMode, type VimHistory } from "../vim.ts";
import {
  CODE_EDITING_ATTRIBUTE,
  codeEditing,
  hasCodeEditing,
  runCodeEditing,
  setSoftWrap,
  softWrapOn,
  type CodeEditingCommand,
} from "./editing.ts";

const mac = /Mac/.test(navigator.platform);

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

/** `//` comments, as a language would give them. */
const lineComments = EditorState.languageData.of(() => [{ commentTokens: { line: "//" } }]);

/**
 * An editor on `doc`, where `|` marks a cursor and `[` `]` a selection (several of either);
 * the last one marked is the main selection.
 */
function mount(doc: string, extensions: Extension = codeEditing()) {
  const ranges: Array<{ anchor: number; head: number }> = [];
  let text = "";
  let open: number | null = null;
  for (const char of doc) {
    if (char === "|") ranges.push({ anchor: text.length, head: text.length });
    else if (char === "[") open = text.length;
    else if (char === "]" && open !== null) {
      ranges.push({ anchor: open, head: text.length });
      open = null;
    } else text += char;
  }
  const selection = EditorSelection.create(
    ranges.length
      ? ranges.map((range) => EditorSelection.range(range.anchor, range.head))
      : [EditorSelection.cursor(0)],
    Math.max(ranges.length - 1, 0),
  );
  view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc: text, selection, extensions }),
  });
  view.focus();
  return view;
}

/** The document with its selections marked as `mount` reads them. */
function marked(editor: EditorView): string {
  const { doc, selection } = editor.state;
  let out = doc.toString();
  for (const range of [...selection.ranges].reverse()) {
    out = range.empty
      ? `${out.slice(0, range.from)}|${out.slice(range.from)}`
      : `${out.slice(0, range.from)}[${out.slice(range.from, range.to)}]${out.slice(range.to)}`;
  }
  return out;
}

const run = (editor: EditorView, command: CodeEditingCommand) => runCodeEditing(editor, command);

const KEY_CODES: Readonly<Record<string, number>> = { "/": 191, "'": 222, "[": 219, "]": 221 };

/** Presses `binding` (`Mod-`, `Alt-`, `Shift-` then a key; Mod is Cmd on macOS, else Ctrl). */
function press(editor: EditorView, binding: string) {
  const parts = binding.split("-");
  const key = parts.pop() ?? "";
  const mod = parts.includes("Mod");
  const event = new KeyboardEvent("keydown", {
    key,
    keyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0),
    shiftKey: parts.includes("Shift"),
    altKey: parts.includes("Alt"),
    ctrlKey: mod && !mac,
    metaKey: mod && mac,
    bubbles: true,
    cancelable: true,
  });
  editor.contentDOM.dispatchEvent(event);
  return event;
}

describe("selecting occurrences", () => {
  it("selects the word at the cursor, then adds each next occurrence, so typing edits them all", () => {
    const editor = mount("let fo|o = foo + food;\nfoo();");
    expect(run(editor, "selectNextOccurrence")).toBe(true);
    expect(marked(editor)).toBe("let [foo] = foo + food;\nfoo();");
    run(editor, "selectNextOccurrence");
    run(editor, "selectNextOccurrence");
    // Whole words only, from a word: `food` is passed over.
    expect(marked(editor)).toBe("let [foo] = [foo] + food;\n[foo]();");
    editor.dispatch(editor.state.replaceSelection("bar"));
    expect(editor.state.doc.toString()).toBe("let bar = bar + food;\nbar();");
  });

  it("wraps round to the start, and stops once every occurrence is selected", () => {
    const editor = mount("one two [one] two one");
    run(editor, "selectNextOccurrence");
    run(editor, "selectNextOccurrence");
    expect(marked(editor)).toBe("[one] two [one] two [one]");
    expect(run(editor, "selectNextOccurrence")).toBe(false);
  });

  it("skips the occurrence added last for the next one, keeping the others", () => {
    const editor = mount("[a] x a x a x a");
    run(editor, "selectNextOccurrence");
    expect(marked(editor)).toBe("[a] x [a] x a x a");
    expect(run(editor, "skipOccurrence")).toBe(true);
    expect(marked(editor)).toBe("[a] x a x [a] x a");
    // A further next occurrence carries on from the one the skip landed on.
    run(editor, "selectNextOccurrence");
    expect(marked(editor)).toBe("[a] x a x [a] x [a]");
  });

  it("selects every occurrence of the selection, or of the word at the cursor", () => {
    const editor = mount("ab|c abc abcd abc");
    expect(run(editor, "selectAllOccurrences")).toBe(true);
    expect(marked(editor)).toBe("[abc] [abc] abcd [abc]");
    expect(editor.state.selection.mainIndex).toBe(0);

    const partial = mount("x [ab]c abc");
    run(partial, "selectAllOccurrences");
    expect(marked(partial)).toBe("x [ab]c [ab]c");
  });
});

describe("line commands", () => {
  it("joins a cursor's line with the next, dropping the next line's indentation", () => {
    const editor = mount("if (a) {|   \n    call();\n}");
    expect(run(editor, "joinLines")).toBe(true);
    expect(editor.state.doc.toString()).toBe("if (a) { call();\n}");
  });

  it("joins every line a selection covers, with no space before an empty line", () => {
    const editor = mount("[one\n  two\n\nthree]\nfour");
    run(editor, "joinLines");
    expect(editor.state.doc.toString()).toBe("one two three\nfour");
  });

  it("joins each cursor's line with the next, cursors on neighbouring lines included", () => {
    const editor = mount("a|\nb|\nc\nd");
    run(editor, "joinLines");
    expect(editor.state.doc.toString()).toBe("a b c\nd");
  });

  it("sorts the lines each selection covers, leaving a line it only touches the start of", () => {
    const editor = mount("[pear\napple\nBanana\n]zebra\nant");
    expect(run(editor, "sortLines")).toBe(true);
    expect(editor.state.doc.toString()).toBe("Banana\napple\npear\nzebra\nant");
    // A single line has nothing to sort.
    const single = mount("b|\na");
    expect(run(single, "sortLines")).toBe(false);
  });

  it("sorts with several selections, each on its own lines", () => {
    const editor = mount("[c\nb]\nx\n[z\ny]");
    run(editor, "sortLines");
    expect(editor.state.doc.toString()).toBe("b\nc\nx\ny\nz");
  });
});

describe("case and duplication", () => {
  it("converts the selection, or the word at each cursor, keeping it selected", () => {
    const editor = mount("[hello] wor|ld again");
    run(editor, "upperCase");
    expect(marked(editor)).toBe("[HELLO] WOR|LD again");
    run(editor, "lowerCase");
    expect(marked(editor)).toBe("[hello] wor|ld again");
  });

  it("duplicates each selection after itself with the original still selected", () => {
    const editor = mount("[ab] cd [ef]");
    expect(run(editor, "duplicateSelection")).toBe(true);
    expect(marked(editor)).toBe("[ab]ab cd [ef]ef");
  });

  it("duplicates the line when there are only cursors", () => {
    const editor = mount("on|e\ntwo");
    run(editor, "duplicateSelection");
    expect(editor.state.doc.toString()).toBe("one\none\ntwo");
  });

  it("leaves a read-only file's text alone", () => {
    const editor = mount("[abc] def", [codeEditing(), EditorState.readOnly.of(true)]);
    for (const command of ["upperCase", "joinLines", "sortLines", "duplicateSelection"] as const) {
      expect(run(editor, command)).toBe(false);
    }
    expect(editor.state.doc.toString()).toBe("abc def");
  });
});

describe("the editor's keys", () => {
  it("runs each command on the keys the host gives it", () => {
    const editor = mount("|x = 1", [
      codeEditing({ keys: { toggleComment: ["Mod-'"], selectNextOccurrence: ["Mod-d"] } }),
      lineComments,
    ]);
    expect(press(editor, "Mod-'").defaultPrevented).toBe(true);
    expect(editor.state.doc.toString()).toBe("// x = 1");
    press(editor, "Mod-d");
    expect(marked(editor)).toBe("// [x] = 1");
  });

  it("frees CodeMirror's own key for a command the host moved elsewhere", () => {
    const editor = mount("|x = 1", [
      codeEditing({ keys: { toggleComment: ["Mod-'"] } }),
      lineComments,
    ]);
    // Mod-/ is the default keymap's comment key; without it the app's own command can have it.
    expect(press(editor, "Mod-/").defaultPrevented).toBe(false);
    expect(editor.state.doc.toString()).toBe("x = 1");
  });

  it("leaves mod+u to the app, rather than undoing a selection", () => {
    const editor = mount("a|bc");
    run(editor, "selectNextOccurrence");
    expect(press(editor, "Mod-u").defaultPrevented).toBe(false);
    expect(marked(editor)).toBe("[abc]");
  });

  it("marks the editor so the app can tell a code editor from a note", () => {
    const editor = mount("x");
    expect(editor.dom.hasAttribute(CODE_EDITING_ATTRIBUTE)).toBe(true);
    expect(hasCodeEditing(editor.state)).toBe(true);
    const note = mount("x", []);
    expect(note.dom.hasAttribute(CODE_EDITING_ATTRIBUTE)).toBe(false);
    expect(runCodeEditing(note, "sortLines")).toBe(false);
  });
});

describe("soft wrap", () => {
  it("starts as asked and switches per editor", () => {
    const editor = mount("long line", codeEditing({ softWrap: false }));
    expect(softWrapOn(editor.state)).toBe(false);
    expect(run(editor, "toggleSoftWrap")).toBe(true);
    expect(softWrapOn(editor.state)).toBe(true);
    expect(editor.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
    setSoftWrap(editor, false);
    expect(editor.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
    expect(setSoftWrap(mount("x", []), true)).toBe(false);
  });
});

describe("with Vim", () => {
  const history: VimHistory = {
    undo: () => {},
    redo: () => {},
    stopCapturing: () => {},
    groupExplicitly: () => {},
  };
  /** Presses a key as Vim reads it from the page. */
  const vimKey = (editor: EditorView, key: string) =>
    editor.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        keyCode: key === "Escape" ? 27 : key.toUpperCase().charCodeAt(0),
        bubbles: true,
        cancelable: true,
      }),
    );

  it("takes several occurrences into visual mode, and changes them all with c", () => {
    const editor = mount("fo|o bar foo baz", [vimMode(history), codeEditing()]);
    run(editor, "selectNextOccurrence");
    run(editor, "selectNextOccurrence");
    expect(marked(editor)).toBe("[foo] bar [foo] baz");
    expect(getCM(editor)?.state.vim?.visualMode).toBe(true);
    vimKey(editor, "c");
    expect(getCM(editor)?.state.vim?.insertMode).toBe(true);
    editor.dispatch(editor.state.replaceSelection("qux"));
    expect(editor.state.doc.toString()).toBe("qux bar qux baz");
    vimKey(editor, "Escape");
    // Back in normal mode, both cursors stay.
    expect(editor.state.selection.ranges).toHaveLength(2);
  });

  it("keeps Vim's normal-mode keys, and the editor's Mod keys where Vim leaves them", () => {
    const editor = mount("fo|o foo", [
      vimMode(history),
      codeEditing({ keys: { selectNextOccurrence: ["Mod-d"] } }),
    ]);
    press(editor, "Mod-d");
    // Mod is Cmd on macOS, which Vim leaves alone; elsewhere normal mode's Ctrl-d is Vim's scroll.
    expect(editor.state.selection.main.empty).toBe(!mac);
  });
});
