import { afterEach, describe, expect, it } from "vite-plus/test";
import { runScopeHandlers, type EditorView } from "@codemirror/view";
import { previewExclusions, type CodeBlockRenderer } from "./config.ts";
import { destroyViews, line, mount, select, sourceText } from "./testSupport.ts";

afterEach(destroyViews);

const mac = /Mac/.test(navigator.platform);

function press(view: EditorView, binding: string) {
  const parts = binding.split("-");
  const key = parts.pop() ?? "";
  const shift = parts.includes("Shift");
  const mod = parts.includes("Mod");
  const event = new KeyboardEvent("keydown", {
    key: shift && key.length === 1 ? key.toUpperCase() : key,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
    shiftKey: shift,
    metaKey: mod && mac,
    ctrlKey: mod && !mac,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, "editor");
}

const docOf = (view: EditorView) => view.state.doc.toString();

describe("host-drawn ranges", () => {
  it("a link inside an excluded range keeps its brackets and gets no link styling", () => {
    const doc = "see [a.ts](src/a.ts) now";
    const view = mount(doc, { extensions: previewExclusions.of([{ from: 4, to: 20 }]) });
    expect(sourceText(line(view, 1))).toBe(doc);
    expect(view.contentDOM.querySelector(".cm-md-link")).toBeNull();
  });

  it("syntax around an excluded range still renders", () => {
    const doc = "**bold [a](b) text** and [c](d)";
    const view = mount(doc, { extensions: previewExclusions.of([{ from: 7, to: 13 }]) });
    expect(sourceText(line(view, 1))).toBe("bold [a](b) text and c");
    expect(view.contentDOM.querySelector(".cm-md-strong")).not.toBeNull();
  });

  it("an excluded image is not replaced by an image widget", () => {
    const doc = "![shot](pic.png) after";
    const view = mount(doc, { extensions: previewExclusions.of([{ from: 0, to: 16 }]) });
    expect(sourceText(line(view, 1))).toBe(doc);
    expect(view.contentDOM.querySelector("img:not(.cm-widgetBuffer)")).toBeNull();
  });

  it("a table holding an excluded range stays source", () => {
    const doc = "| a | b |\n| - | - |\n| [x](y) | c |";
    const from = doc.indexOf("[x]");
    const view = mount(doc, { extensions: previewExclusions.of([{ from, to: from + 6 }]) });
    expect(view.contentDOM.querySelector(".cm-md-table-widget")).toBeNull();
    expect(sourceText(line(view, 3))).toContain("[x](y)");
  });
});

describe("host-drawn code blocks", () => {
  const recorder = () => {
    const removed: string[] = [];
    const render: CodeBlockRenderer = (source, element) => {
      element.textContent = `rows for ${source}`;
      return () => removed.push(source);
    };
    return { codeBlocks: { base: render }, removed };
  };

  it("draws a block of the host's language in its place, and its source while being edited", () => {
    const { codeBlocks, removed } = recorder();
    const doc = "intro\n```base\nviews: []\n```\n```js\nlet x;\n```";
    const view = mount(doc, { focused: true, options: { codeBlocks } });
    const drawn = view.contentDOM.querySelectorAll(".cm-md-host-block");
    expect([...drawn].map((element) => element.textContent)).toEqual(["rows for views: []"]);
    expect(view.contentDOM.textContent).toContain("let x;");

    select(view, doc.indexOf("views"));
    expect(view.contentDOM.querySelector(".cm-md-host-block")).toBeNull();
    expect(sourceText(line(view, 3))).toBe("views: []");
    expect(removed).toEqual(["views: []"]);
  });

  it("leaves an unclosed block as source", () => {
    const { codeBlocks } = recorder();
    const view = mount("```base\nviews: []", { options: { codeBlocks } });
    expect(view.contentDOM.querySelector(".cm-md-host-block")).toBeNull();
  });
});

describe("host key options", () => {
  it("reserved keys stay unbound while the other formatting keys work", () => {
    const view = mount("hello", {
      focused: true,
      selection: [[0, 5]],
      options: { reservedKeys: ["Mod-Shift-x"] },
    });
    expect(press(view, "Mod-Shift-x")).toBe(false);
    expect(docOf(view)).toBe("hello");
    expect(press(view, "Mod-b")).toBe(true);
    expect(docOf(view)).toBe("**hello**");
  });

  it("formatting commands take the host's keys in place of their defaults", () => {
    const view = mount("hello", {
      focused: true,
      selection: [[0, 5]],
      options: { keys: { bold: ["Mod-Shift-b"], code: [] } },
    });
    expect(press(view, "Mod-b")).toBe(false);
    expect(press(view, "Mod-e")).toBe(false);
    expect(docOf(view)).toBe("hello");
    expect(press(view, "Mod-Shift-b")).toBe(true);
    expect(docOf(view)).toBe("**hello**");
    // A command the host does not name keeps its default.
    expect(press(view, "Mod-Shift-x")).toBe(true);
    expect(docOf(view)).toBe("**~~hello~~**");
  });

  it("with prose indentation off, Tab in prose falls through and changes nothing", () => {
    const view = mount("hello", {
      focused: true,
      selection: [2],
      options: { tabIndentsProse: false },
    });
    expect(press(view, "Tab")).toBe(false);
    expect(press(view, "Shift-Tab")).toBe(false);
    expect(docOf(view)).toBe("hello");
  });

  it("with prose indentation off, Tab still indents list items and code", () => {
    const list = mount("- a\n- b", {
      focused: true,
      selection: [7],
      options: { tabIndentsProse: false },
    });
    expect(press(list, "Tab")).toBe(true);
    expect(docOf(list)).toBe("- a\n  - b");

    const code = mount("```\nx\n```", {
      focused: true,
      selection: [4],
      options: { tabIndentsProse: false },
    });
    expect(press(code, "Tab")).toBe(true);
    expect(docOf(code)).toBe("```\n  x\n```");
  });
});
