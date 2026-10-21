import { afterEach, describe, expect, it } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { runScopeHandlers, type EditorView } from "@codemirror/view";
import {
  continueMarkup,
  deleteMarkupBackward,
  indentListItem,
  insertLink,
  outdentListItem,
  toggleSpan,
} from "./keymap.ts";
import { caret, destroyViews, mount } from "./testSupport.ts";

afterEach(destroyViews);

const mac = /Mac/.test(navigator.platform);

/** Presses a key such as `Mod-Shift-x` through the editor's keymaps. */
function press(view: EditorView, binding: string) {
  const parts = binding.split("-");
  const key = parts.pop() ?? "";
  const shift = parts.includes("Shift");
  const mod = parts.includes("Mod");
  const event = new KeyboardEvent("keydown", {
    key: shift && key.length === 1 ? key.toUpperCase() : key,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : key === "Enter" ? 13 : 0,
    shiftKey: shift,
    metaKey: mod && mac,
    ctrlKey: mod && !mac,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, "editor");
}

const docOf = (view: EditorView) => view.state.doc.toString();
const selectionOf = (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  return [from, to];
};

describe("toggles", () => {
  it("A45. `hello`, select all, Mod-b: `**hello**` with `hello` selected; Mod-b again: `hello`", () => {
    const view = mount("hello", { focused: true, selection: [[0, 5]] });
    expect(press(view, "Mod-b")).toBe(true);
    expect(docOf(view)).toBe("**hello**");
    expect(selectionOf(view)).toEqual([2, 7]);
    press(view, "Mod-b");
    expect(docOf(view)).toBe("hello");
    expect(selectionOf(view)).toEqual([0, 5]);
  });

  it("A46. `**hello**`, caret at 0 or at 9: Mod-b unwraps", () => {
    for (const pos of [0, 9]) {
      const view = mount("**hello**", { focused: true, selection: [pos] });
      toggleSpan("**")(view);
      expect(docOf(view), `caret at ${pos}`).toBe("hello");
    }
  });

  it("A47. `hello world`, caret at 7, Mod-b: `hello **world**`, caret at the end of `world`", () => {
    const view = mount("hello world", { focused: true, selection: [7] });
    toggleSpan("**")(view);
    expect(docOf(view)).toBe("hello **world**");
    expect(caret(view)).toBe(13);
  });

  it("A48. `hello  world`, caret at 6, Mod-b: `hello **** world`, caret at 8", () => {
    const view = mount("hello  world", { focused: true, selection: [6] });
    toggleSpan("**")(view);
    expect(docOf(view)).toBe("hello **** world");
    expect(caret(view)).toBe(8);
  });

  it("A49. Mod-i inside `**x**` gives `***x***`; Mod-i inside `***x***` gives `**x**`", () => {
    const view = mount("**x**", { focused: true, selection: [3] });
    press(view, "Mod-i");
    expect(docOf(view)).toBe("***x***");
    const nested = mount("***x***", { focused: true, selection: [4] });
    press(nested, "Mod-i");
    expect(docOf(nested)).toBe("**x**");
  });

  it("A50. Mod-e wraps in backticks; Mod-Shift-x in `~~`; Mod-Shift-h in `==`", () => {
    for (const [binding, expected] of [
      ["Mod-e", "`a`"],
      ["Mod-Shift-x", "~~a~~"],
      ["Mod-Shift-h", "==a=="],
    ] as const) {
      const view = mount("a", { focused: true, selection: [[0, 1]] });
      expect(press(view, binding), binding).toBe(true);
      expect(docOf(view)).toBe(expected);
    }
  });

  it("A51. Mod-Shift-k on selected `docs` gives `[docs](|)`; pasting `https://x` over selected `docs` gives `[docs](https://x)`", () => {
    const view = mount("docs", { focused: true, selection: [[0, 4]] });
    press(view, "Mod-Shift-k");
    expect(docOf(view)).toBe("[docs]()");
    expect(caret(view)).toBe(7);

    const pasted = mount("docs", { focused: true, selection: [[0, 4]] });
    const data = new DataTransfer();
    data.setData("text/plain", "https://x");
    const event = new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    pasted.contentDOM.dispatchEvent(event);
    expect(docOf(pasted)).toBe("[docs](https://x)");

    const url = mount("https://x", { focused: true, selection: [[0, 9]] });
    insertLink(url);
    expect(docOf(url)).toBe("[](https://x)");
    expect(caret(url)).toBe(1);
  });
});

describe("list and quote continuation", () => {
  it("A52. Enter continues lists with the item's own marker and numbering style, never renumbering", () => {
    const bullet = mount("- one", { focused: true, selection: [5] });
    press(bullet, "Enter");
    bullet.dispatch(bullet.state.replaceSelection("two"));
    expect(docOf(bullet)).toBe("- one\n- two");

    const sequential = mount("1. a\n2. b", { focused: true, selection: [9] });
    continueMarkup(sequential);
    expect(docOf(sequential)).toBe("1. a\n2. b\n3. ");
    expect(caret(sequential)).toBe(13);

    const repeated = mount("1. a\n1. b", { focused: true, selection: [9] });
    continueMarkup(repeated);
    expect(docOf(repeated)).toBe("1. a\n1. b\n1. ");

    const middle = mount("1. a\n2. b", { focused: true, selection: [4] });
    continueMarkup(middle);
    expect(docOf(middle)).toBe("1. a\n2. \n2. b");
    expect(caret(middle)).toBe(8);
  });

  it("A53. Enter on an empty item exits one level with no blank line", () => {
    const top = mount("- a\n- ", { focused: true, selection: [6] });
    continueMarkup(top);
    expect(docOf(top)).toBe("- a\n");
    expect(caret(top)).toBe(4);

    const nested = mount("- a\n  - ", { focused: true, selection: [8] });
    continueMarkup(nested);
    expect(docOf(nested)).toBe("- a\n- ");
    expect(caret(nested)).toBe(6);
  });

  it("A54. `- [ ] a|`, Enter: `- [ ] a/- [ ] |`", () => {
    const view = mount("- [ ] a", { focused: true, selection: [7] });
    continueMarkup(view);
    expect(docOf(view)).toBe("- [ ] a\n- [ ] ");
    expect(caret(view)).toBe(14);
  });

  it("A55. `> q|`, Enter: `> q/> |`; `> q/> |`, Enter: `> q/|`", () => {
    const view = mount("> q", { focused: true, selection: [3] });
    continueMarkup(view);
    expect(docOf(view)).toBe("> q\n> ");
    expect(caret(view)).toBe(6);
    continueMarkup(view);
    expect(docOf(view)).toBe("> q\n");
    expect(caret(view)).toBe(4);
  });

  it("A56. Tab indents a list item by its list's unit, children included; Shift-Tab reverses", () => {
    const single = mount("- a", { focused: true, selection: [3] });
    press(single, "Tab");
    expect(docOf(single)).toBe("  - a");
    expect(caret(single)).toBe(5);
    press(single, "Shift-Tab");
    expect(docOf(single)).toBe("- a");

    const view = mount("- a\n- b\n  - c", { focused: true, selection: [7] });
    indentListItem(view);
    expect(docOf(view)).toBe("- a\n  - b\n    - c");
    expect(caret(view)).toBe(9);
    outdentListItem(view);
    expect(docOf(view)).toBe("- a\n- b\n  - c");

    const ordered = mount("1. a\n2. b", { focused: true, selection: [6] });
    indentListItem(ordered);
    expect(docOf(ordered)).toBe("1. a\n   2. b");
  });

  it("A57. `- |text`, Backspace: `|text`", () => {
    const view = mount("- text", { focused: true, selection: [2] });
    press(view, "Backspace");
    expect(docOf(view)).toBe("text");
    expect(caret(view)).toBe(0);

    const task = mount("- [ ] text", { focused: true, selection: [6] });
    deleteMarkupBackward(task);
    expect(docOf(task)).toBe("- text");
  });

  it("A58. inside a fence, Mod-b does nothing to the text", () => {
    const view = mount("```\nhello\n```", { focused: true, selection: [6] });
    expect(press(view, "Mod-b")).toBe(false);
    expect(docOf(view)).toBe("```\nhello\n```");
  });

  it("A59. read-only editor: no toggle changes the document", () => {
    const view = mount("hello", {
      focused: true,
      selection: [[0, 5]],
      extensions: EditorState.readOnly.of(true),
    });
    for (const binding of [
      "Mod-b",
      "Mod-i",
      "Mod-e",
      "Mod-Shift-x",
      "Mod-Shift-h",
      "Mod-Shift-k",
    ]) {
      press(view, binding);
    }
    expect(docOf(view)).toBe("hello");
  });

  it("Enter inside a fenced code block copies the line's indentation", () => {
    const view = mount("```\n  code\n```", { focused: true, selection: [10] });
    continueMarkup(view);
    expect(docOf(view)).toBe("```\n  code\n  \n```");
    expect(caret(view)).toBe(13);
  });

  it("Backspace at the start of an empty quote line removes `> `", () => {
    const view = mount("> q\n> ", { focused: true, selection: [6] });
    deleteMarkupBackward(view);
    expect(docOf(view)).toBe("> q\n");
  });

  it("Enter inside a quoted code block keeps the quote prefix and the indentation", () => {
    const doc = "> ```\n>   code\n> ```";
    const view = mount(doc, { focused: true, selection: [14] });
    continueMarkup(view);
    expect(docOf(view)).toBe("> ```\n>   code\n>   \n> ```");
    expect(caret(view)).toBe(19);
  });

  it("Tab and Shift-Tab with a selection ending at column 0 leave the next item alone", () => {
    for (const binding of ["Tab", "Shift-Tab"]) {
      const view = mount("- a\n- b", { focused: true, selection: [[0, 4]] });
      press(view, binding);
      expect(docOf(view).split("\n")[1], binding).toBe("- b");
    }
  });

  it("Tab and Shift-Tab on a continuation line move the whole item", () => {
    const view = mount("- first\n  continued", { focused: true, selection: [19] });
    press(view, "Tab");
    expect(docOf(view)).toBe("  - first\n    continued");
    press(view, "Shift-Tab");
    expect(docOf(view)).toBe("- first\n  continued");
  });
});
