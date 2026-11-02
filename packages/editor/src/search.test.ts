import { afterEach, describe, expect, it } from "vite-plus/test";
import { getSearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { hasInFileSearch, inFileSearch, openInFileSearch } from "./search.ts";
import { enterInsertMode, vimMode, type VimHistory } from "./vim.ts";

const mac = /Mac/.test(navigator.platform);

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function mount(doc: string, extensions: Extension = inFileSearch()) {
  view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc, extensions }),
  });
  view.focus();
  return view;
}

/**
 * Presses `binding` (a key, after any of `Mod-`, `Alt-`, `Shift-`; Mod is Cmd on macOS, else Ctrl)
 * on `target`: the editor's text, or a field of its find bar.
 */
function press(target: Element, binding: string) {
  const parts = binding.split("-");
  const named = parts.pop() ?? "";
  // A keyboard sends Shift with a letter as the capital.
  const key = parts.includes("Shift") && named.length === 1 ? named.toUpperCase() : named;
  const mod = parts.includes("Mod");
  const event = new KeyboardEvent("keydown", {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    keyCode: key === "Enter" ? 13 : key === "Escape" ? 27 : key.toUpperCase().charCodeAt(0),
    shiftKey: parts.includes("Shift"),
    altKey: parts.includes("Alt"),
    ctrlKey: mod && !mac,
    metaKey: mod && mac,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function bar(editor: EditorView) {
  return editor.dom.querySelector<HTMLElement>(".cm-panels-top .cm-search");
}

function field(editor: EditorView, name: "search" | "replace") {
  const input = editor.dom.querySelector<HTMLInputElement>(`.cm-search input[name=${name}]`);
  if (!input) throw new Error(`no ${name} field`);
  return input;
}

/** Types `query` into the bar's search field, as keystrokes would commit it. */
function find(editor: EditorView, query: string) {
  const input = field(editor, "search");
  input.value = query;
  input.dispatchEvent(new KeyboardEvent("keyup", { key: query.at(-1) ?? "", bubbles: true }));
}

const selected = (editor: EditorView) =>
  editor.state.selection.ranges.map((range) => editor.state.sliceDoc(range.from, range.to));
const mainAt = (editor: EditorView) => editor.state.selection.main.from;

describe("in-file search", () => {
  it("opens above the text with the selection as the query, and Escape closes it to the text", () => {
    const editor = mount("alpha beta alpha");
    editor.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(press(editor.contentDOM, "Mod-f").defaultPrevented).toBe(true);
    expect(bar(editor)).not.toBeNull();
    expect(field(editor, "search").value).toBe("alpha");

    field(editor, "search").focus();
    press(field(editor, "search"), "Escape");
    expect(bar(editor)).toBeNull();
    expect(editor.hasFocus).toBe(true);
  });

  it("steps through matches from the bar and from the text, wrapping", () => {
    const editor = mount("one two one two one");
    openInFileSearch(editor);
    find(editor, "one");
    const steps = (target: () => Element, key: string, count: number) =>
      Array.from({ length: count }, () => {
        press(target(), key);
        return mainAt(editor);
      });
    expect(steps(() => field(editor, "search"), "Enter", 4)).toEqual([0, 8, 16, 0]);
    expect(steps(() => field(editor, "search"), "Shift-Enter", 2)).toEqual([16, 8]);
    expect(steps(() => editor.contentDOM, "Mod-g", 2)).toEqual([16, 0]);
    expect(steps(() => editor.contentDOM, "Shift-Mod-g", 1)).toEqual([16]);
  });

  it("switches case, whole words and regex from the keys while the bar is open", () => {
    const editor = mount("Cat cat category");
    openInFileSearch(editor);
    find(editor, "cat");
    const options = () => {
      const { caseSensitive, wholeWord, regexp } = getSearchQuery(editor.state);
      return { caseSensitive, wholeWord, regexp };
    };
    press(field(editor, "search"), "Mod-Alt-c");
    press(editor.contentDOM, "Mod-Alt-w");
    expect(options()).toEqual({ caseSensitive: true, wholeWord: true, regexp: false });
    expect(field(editor, "search").value).toBe("cat");
    press(field(editor, "search"), "Mod-Alt-x");
    press(field(editor, "search"), "Mod-Alt-c");
    expect(options()).toEqual({ caseSensitive: false, wholeWord: true, regexp: true });

    press(field(editor, "search"), "Escape");
    // Closed, the keys are left to whatever else binds them.
    expect(press(editor.contentDOM, "Mod-Alt-c").defaultPrevented).toBe(false);
  });

  it("selects every match with Alt-Enter where several selections are allowed, and not otherwise", () => {
    const multiple = mount("ab ab ab", [
      inFileSearch(),
      EditorState.allowMultipleSelections.of(true),
    ]);
    openInFileSearch(multiple);
    find(multiple, "ab");
    press(field(multiple, "search"), "Alt-Enter");
    expect(selected(multiple)).toEqual(["ab", "ab", "ab"]);
    expect(multiple.hasFocus).toBe(true);
    multiple.destroy();

    const single = mount("ab ab ab");
    openInFileSearch(single);
    find(single, "ab");
    press(field(single, "search"), "Alt-Enter");
    expect(single.state.selection.ranges).toHaveLength(1);
    expect(single.dom.hasAttribute("data-one-selection")).toBe(true);
  });

  it("replaces one match with Enter and every match with Mod-Enter in the replace field", () => {
    const editor = mount("red green red red");
    openInFileSearch(editor);
    find(editor, "red");
    const replace = field(editor, "replace");
    replace.focus();
    replace.value = "blue";
    replace.dispatchEvent(new KeyboardEvent("keyup", { key: "e", bubbles: true }));
    editor.dispatch({ selection: EditorSelection.single(0, 3) });
    press(replace, "Enter");
    expect(editor.state.doc.toString()).toBe("blue green red red");
    press(replace, "Mod-Enter");
    expect(editor.state.doc.toString()).toBe("blue green blue blue");
    // Only in the replace field: from the search field Mod-Enter replaces nothing.
    find(editor, "green");
    field(editor, "search").focus();
    press(field(editor, "search"), "Mod-Enter");
    expect(editor.state.doc.toString()).toBe("blue green blue blue");
  });

  it("lets a read-only editor take focus and open the bar, without a replace row", () => {
    const editor = mount("look but do not touch", [
      inFileSearch(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ]);
    expect(editor.contentDOM.getAttribute("tabindex")).toBe("0");
    editor.contentDOM.focus();
    press(editor.contentDOM, "Mod-f");
    expect(bar(editor)).not.toBeNull();
    expect(editor.dom.querySelector(".cm-search input[name=replace]")).toBeNull();
  });

  it("opens only in an editor that has it", () => {
    const plain = mount("no search here", []);
    expect(hasInFileSearch(plain.state)).toBe(false);
    expect(openInFileSearch(plain)).toBe(false);
    expect(bar(plain)).toBeNull();
    // Its Mod-f stays the page's.
    expect(press(plain.contentDOM, "Mod-f").defaultPrevented).toBe(false);
  });
});

describe("in-file search with Vim", () => {
  const history: VimHistory = {
    undo: () => {},
    redo: () => {},
    stopCapturing: () => {},
    groupExplicitly: () => {},
  };

  it("leaves / to Vim's own prompt in normal mode", () => {
    const editor = mount("one two one", [inFileSearch(), vimMode(history)]);
    press(editor.contentDOM, "/");
    expect(editor.dom.querySelector(".cm-panels-bottom input")).not.toBeNull();
    expect(bar(editor)).toBeNull();
  });

  it("keeps n on Vim's own search, whatever the bar searched for since", () => {
    const editor = mount("one two one two one", [inFileSearch(), vimMode(history)]);
    press(editor.contentDOM, "/");
    const prompt = editor.dom.querySelector<HTMLInputElement>(".cm-panels-bottom input")!;
    prompt.value = "one";
    press(prompt, "Enter");
    expect(mainAt(editor)).toBe(8);

    openInFileSearch(editor);
    find(editor, "two");
    field(editor, "search").focus();
    press(field(editor, "search"), "Escape");
    press(editor.contentDOM, "n");
    expect(editor.state.selection.main.head).toBe(16);
  });

  it("opens the bar from Mod-f unless Vim reads the key itself", () => {
    const editor = mount("one two one", [inFileSearch(), vimMode(history)]);
    press(editor.contentDOM, "Mod-f");
    // Mod is Cmd on macOS, which Vim leaves alone; elsewhere it is Ctrl, and normal mode's
    // Ctrl-f is Vim's page down.
    expect(bar(editor) !== null).toBe(mac);
    enterInsertMode(editor);
    press(editor.contentDOM, "Mod-f");
    expect(bar(editor)).not.toBeNull();
  });
});
