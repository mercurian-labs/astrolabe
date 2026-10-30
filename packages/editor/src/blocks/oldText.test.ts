import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { lineBlocks, setLineBlocks } from "./lineBlocks.ts";
import {
  closeOldTextPopover,
  oldLinesBlock,
  oldTextInline,
  oldTextPopoverStale,
  oldTextStyles,
  type OldText,
} from "./oldText.ts";

let view: EditorView | null = null;
afterEach(() => {
  closeOldTextPopover();
  view?.destroy();
  view = null;
});

function mount(doc: string, extensions: Extension = []) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: [lineBlocks, oldTextStyles, extensions] }),
  });
  return view;
}

function old(overrides: Partial<OldText> = {}): OldText {
  return {
    key: "hunk-1",
    text: "const a = 1;\n\nconst b = 2;",
    tint: "red",
    actions: [],
    ...overrides,
  };
}

function press(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function popoverActions() {
  return [...document.querySelectorAll(".atlas-old-text-popover .atlas-old-text-action")].map(
    (button) => button.textContent,
  );
}

describe("old lines between lines", () => {
  it("draws each old line as its own row above the line that replaced them", () => {
    const editor = mount("const a = 10;\nconst c = 3;");
    editor.dispatch({
      effects: setLineBlocks("git", [oldLinesBlock(old(), 0, "above")]),
    });
    const [first, ...rest] = editor.contentDOM.children;
    expect(first?.classList.contains("atlas-line-block")).toBe(true);
    const rows = [...(first?.querySelectorAll(".atlas-old-line") ?? [])].map(
      (row) => row.textContent,
    );
    // The blank old line keeps a row of its own.
    expect(rows).toEqual(["const a = 1;", "​", "const b = 2;"]);
    expect(rest.map((line) => line.textContent)).toEqual(["const a = 10;", "const c = 3;"]);
    expect(
      first
        ?.querySelector<HTMLElement>(".atlas-old-text")
        ?.style.getPropertyValue("--atlas-old-text-tint"),
    ).toBe("red");
  });

  it("offers its actions when pressed, and runs the chosen one on its editor", () => {
    const restore = vi.fn();
    const editor = mount("new line");
    editor.dispatch({
      effects: setLineBlocks("git", [
        oldLinesBlock(
          old({
            text: "old line",
            actions: [
              { label: "Restore", run: restore },
              { label: "Stage", run: () => {} },
            ],
          }),
          0,
          "above",
        ),
      ]),
    });
    press(editor.contentDOM.querySelector(".atlas-old-lines")!);
    expect(popoverActions()).toEqual(["Restore", "Stage"]);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(restore).toHaveBeenCalledWith(editor);
    expect(popoverActions()).toEqual([]);
  });

  it("knows its popover is stale once the old text it was opened for has gone", () => {
    const editor = mount("new line");
    const actions = [{ label: "Restore", run: () => {} }];
    editor.dispatch({
      effects: setLineBlocks("git", [oldLinesBlock(old({ actions }), 0, "above")]),
    });
    press(editor.contentDOM.querySelector(".atlas-old-lines")!);
    expect(oldTextPopoverStale(editor, (key) => key === "hunk-1")).toBe(false);
    expect(oldTextPopoverStale(editor, () => false)).toBe(true);
  });
});

describe("old text inside a line", () => {
  it("shows a long text whole when its source cannot expand it, and no popover without actions", () => {
    const long = "a deleted sentence that runs on well past the length that would collapse it";
    const text = old({ key: "words", text: `${long}\nand more` });
    const editor = mount(
      "keep this",
      EditorView.decorations.of(Decoration.set([oldTextInline(text, 5, 1)])),
    );
    const shown = editor.contentDOM.querySelector<HTMLElement>(".atlas-old-text");
    expect(shown?.classList.contains("atlas-old-text-collapsed")).toBe(false);
    expect(shown?.textContent).toBe(`${long}\nand more`);
    expect(editor.posAtDOM(shown!)).toBe(5);

    press(shown!);
    expect(document.querySelector(".atlas-old-text-popover")).toBeNull();
  });
});
