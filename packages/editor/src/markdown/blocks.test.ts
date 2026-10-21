import { afterEach, describe, expect, it } from "vite-plus/test";
import { cursorCharRight } from "@codemirror/commands";
import { type EditorView, keymap } from "@codemirror/view";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  caret,
  destroyViews,
  line,
  lines,
  mount,
  select,
  sourceText,
  texts,
} from "./testSupport.ts";
import { previewDecorations, previewFolds } from "./preview.ts";

afterEach(destroyViews);

describe("block markers", () => {
  it("A13. `- item` draws a bullet in place of `-`; the literal `-` shows dimmed only with the caret at the line start or just after it; the text does not move", () => {
    const view = mount("- item\nx");
    const bullet = line(view, 1).querySelector(".cm-md-bullet");
    // The bullet renders the marker's own character, so it takes exactly the marker's width.
    expect(bullet?.textContent).toBe("-");
    expect(sourceText(line(view, 1))).toBe(" item");

    const focused = mount("- item\nx", { focused: true, selection: [0] });
    for (const pos of [0, 1]) {
      select(focused, pos);
      expect(line(focused, 1).querySelector(".cm-md-bullet"), `caret at ${pos}`).toBeNull();
      expect(texts(focused, ".cm-md-syntax")).toEqual(["-"]);
      expect(sourceText(line(focused, 1))).toBe("- item");
    }
    // With the caret in `item` the bullet stays, in the same one-character slot.
    for (const pos of [2, 4, 6]) {
      select(focused, pos);
      expect(line(focused, 1).querySelector(".cm-md-bullet")?.textContent, `caret at ${pos}`).toBe(
        "-",
      );
      expect(sourceText(line(focused, 1))).toBe(" item");
    }
  });

  it("A14. `* item` and `+ item` render the same bullet; `1. item` and `1) item` keep their numbers", () => {
    const view = mount("* item\n\n+ item\n\n1. item\n\n1) item");
    expect(texts(view, ".cm-md-bullet")).toEqual(["*", "+"]);
    expect(texts(view, ".cm-md-list-number")).toEqual(["1.", "1)"]);
    expect(sourceText(line(view, 5))).toBe("1. item");
  });

  it("A15. `- [ ] a/- [x] b/- [-] c`: unchecked, checked, cancelled; `b` and `c` struck and muted", () => {
    const view = mount("- [ ] a\n- [x] b\n- [-] c");
    const boxes = [...view.contentDOM.querySelectorAll<HTMLInputElement>("input.cm-md-checkbox")];
    expect(boxes.map((box) => box.checked)).toEqual([false, true, true]);
    expect(boxes.map((box) => box.classList.contains("cm-md-checkbox-cancelled"))).toEqual([
      false,
      false,
      true,
    ]);
    expect(texts(view, ".cm-md-task-done").map((text) => text.trim())).toEqual(["b", "c"]);
    expect(view.contentDOM.querySelectorAll(".cm-md-task-cancelled")).toHaveLength(1);

    // With the caret just after the `]` of line 1 the literal `- [ ]` shows dimmed.
    const prefix = mount("- [ ] a\n- [x] b\n- [-] c", { focused: true, selection: [5] });
    expect(line(prefix, 1).querySelector("input.cm-md-checkbox")).toBeNull();
    expect(
      [...line(prefix, 1).querySelectorAll(".cm-md-syntax")].map((e) => e.textContent),
    ).toEqual(["-", "[ ]"]);
    expect(sourceText(line(prefix, 1))).toBe("- [ ] a");
    // With the caret in `a` the checkbox shows, and the text sits where it did at rest.
    select(prefix, 7);
    expect(line(prefix, 1).querySelector("input.cm-md-checkbox")).not.toBeNull();
    expect(sourceText(line(prefix, 1))).toBe(" a");
  });

  it("A16. clicking the first checkbox yields `- [x] a`; caret and scroll unchanged; one undo restores it", () => {
    const doc = new Y.Doc();
    const text = doc.getText("note");
    text.insert(0, "- [ ] a\n- [ ] b");
    const undoManager = new Y.UndoManager(text);
    const view = mount(text.toString(), {
      focused: true,
      selection: [15],
      extensions: [
        yCollab(text, new Awareness(doc), { undoManager }),
        keymap.of(yUndoManagerKeymap),
      ],
    });
    const scrollTop = view.scrollDOM.scrollTop;
    const box = view.contentDOM.querySelector("input.cm-md-checkbox");
    box?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(view.state.doc.toString()).toBe("- [x] a\n- [ ] b");
    expect(text.toString()).toBe("- [x] a\n- [ ] b");
    expect(caret(view)).toBe(15);
    expect(view.scrollDOM.scrollTop).toBe(scrollTop);
    undoManager.undo();
    expect(view.state.doc.toString()).toBe("- [ ] a\n- [ ] b");
  });

  it.todo("A17. `> q`: text x-position unchanged between hidden and revealed states (browser)");

  it("quote lines hide `>` behind a bar of the marker's own width", () => {
    const view = mount("> q");
    expect(line(view, 1).classList.contains("cm-md-quote")).toBe(true);
    // The spacer keeps the marker's width; its bar is the border.
    expect(line(view, 1).querySelector(".cm-md-quote-spacer")?.textContent).toBe("> ");
    expect(sourceText(line(view, 1))).toBe("q");
  });

  it("A18. `> a/> b`, caret on line 1 at any position: both lines show the rail, neither a literal `>`; the `>` stays in the document", () => {
    const view = mount("> a\n> b", { focused: true, selection: [0] });
    for (const pos of [0, 1, 2, 3]) {
      select(view, pos);
      for (const n of [1, 2]) {
        expect(
          line(view, n).querySelector(".cm-md-quote-spacer"),
          `line ${n}, caret ${pos}`,
        ).not.toBeNull();
        expect(line(view, n).querySelector(".cm-md-syntax")).toBeNull();
      }
      expect(sourceText(line(view, 1))).toBe("a");
      expect(sourceText(line(view, 2))).toBe("b");
    }
    expect(view.state.doc.toString()).toBe("> a\n> b");
  });

  it("A19. callout header with title and bordered body; a `-` callout folds off-line and unfolds with a caret in the body", () => {
    const view = mount("> [!note] Title\n> body");
    const header = line(view, 1);
    expect(header.classList.contains("cm-md-callout-title")).toBe(true);
    expect(header.querySelector(".cm-md-callout-icon")).not.toBeNull();
    expect(sourceText(header)).toBe("Title");
    expect(line(view, 2).classList.contains("cm-md-callout")).toBe(true);
    expect(line(view, 2).getAttribute("data-callout")).toBe("note");

    const doc = "> [!warning]- T\n> hidden\n\nafter";
    const shows = (view: EditorView, text: string) =>
      lines(view).some((element) => sourceText(element).includes(text));
    const folded = mount(doc, { focused: true, selection: [doc.length] });
    expect(folded.contentDOM.querySelector(".cm-md-callout-fold")).not.toBeNull();
    expect(shows(folded, "hidden")).toBe(false);
    select(folded, 24);
    expect(shows(folded, "hidden")).toBe(true);
    expect(folded.contentDOM.querySelector(".cm-md-callout-fold")).toBeNull();
  });

  it("A20. `text//---//text`: rule rendered; caret on the rule line shows dimmed `---`", () => {
    const view = mount("text\n\n---\n\ntext");
    expect(line(view, 3).classList.contains("cm-md-hr")).toBe(true);
    expect(sourceText(line(view, 3))).toBe("");
    const focused = mount("text\n\n---\n\ntext", { focused: true, selection: [6] });
    expect(texts(focused, ".cm-md-syntax")).toEqual(["---"]);
    expect(line(focused, 3).classList.contains("cm-md-hr")).toBe(false);
  });

  it("A21. fenced code: fences hidden with a `js` label off-block, lines kept; caret in the body shows both fences dimmed", () => {
    const doc = "```js\nconst x = 1;\n```";
    const view = mount(doc);
    expect(lines(view)).toHaveLength(3);
    expect(sourceText(line(view, 1))).toBe("");
    expect(sourceText(line(view, 3))).toBe("");
    expect(texts(view, ".cm-md-code-label")).toEqual(["js"]);
    expect(lines(view).every((element) => element.classList.contains("cm-md-code"))).toBe(true);

    const focused = mount(doc, { focused: true, selection: [8] });
    expect(texts(focused, ".cm-md-syntax")).toEqual(["```js", "```"]);
  });

  it("A22. an unclosed fence treats only its opening line as a fence; styling runs to the document end", () => {
    const view = mount("```js\nconst x = 1;\nmore");
    expect(lines(view).every((element) => element.classList.contains("cm-md-code"))).toBe(true);
    expect(sourceText(line(view, 1))).toBe("");
    expect(sourceText(line(view, 3))).toBe("more");
    expect(line(view, 3).classList.contains("cm-md-code-last")).toBe(true);
  });

  it("A23. `---/title: x/---/body` at document start: folded properties block, no rule", () => {
    const view = mount("---\ntitle: x\n---\nbody");
    const properties = view.contentDOM.querySelector(".cm-md-properties");
    expect(properties?.querySelector(".cm-md-properties-count")?.textContent).toBe("1");
    expect(view.contentDOM.querySelector(".cm-md-hr")).toBeNull();
    expect(lines(view).map((element) => sourceText(element))).toEqual(["", "body"]);

    const open = mount("---\ntitle: x\n---\nbody", { focused: true, selection: [5] });
    expect(open.contentDOM.querySelector(".cm-md-properties")).toBeNull();
    expect(texts(open, ".cm-md-syntax")).toEqual(["---", "---"]);
  });

  it("keeps a document that opens with an unclosed `---` a rule, not frontmatter", () => {
    const view = mount("---\n\ntext");
    expect(view.contentDOM.querySelector(".cm-md-properties")).toBeNull();
    expect(line(view, 1).classList.contains("cm-md-hr")).toBe(true);
  });

  it("keeps a `$$` block together and hides its fences off-block", () => {
    const view = mount("$$\n\\int x\n$$\n\nafter");
    expect(
      lines(view)
        .slice(0, 3)
        .every((element) => element.classList.contains("cm-md-math-block")),
    ).toBe(true);
    expect(
      lines(view)
        .slice(0, 3)
        .map((element) => sourceText(element)),
    ).toEqual(["", "\\int x", ""]);
  });

  it("moves a caret that lands on a heading's hidden `# ` to the first text character", () => {
    const view = mount("# Title\nbody", { focused: true, selection: [9] });
    select(view, 0);
    expect(caret(view)).toBe(2);
  });

  it("closes frontmatter only on a `---` line", () => {
    const view = mount("---\nprose\n...\nbody");
    expect(view.contentDOM.querySelector(".cm-md-properties")).toBeNull();
    expect(line(view, 1).classList.contains("cm-md-hr")).toBe(true);
    expect(sourceText(line(view, 2))).toBe("prose");
  });

  it("clicking a callout's chevron unfolds it without touching the selection; clicking again refolds", () => {
    const doc = "> [!warning]- T\n> hidden\n\na\nb";
    const view = mount(doc, { focused: true, selection: [26, 28] });
    const ranges = () => view.state.selection.ranges.map((range) => [range.from, range.to]);
    const shows = () => lines(view).some((element) => sourceText(element).includes("hidden"));
    const chevron = () => view.contentDOM.querySelector(".cm-md-callout-fold");
    const click = (element: Element | null) =>
      element?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
    expect(shows()).toBe(false);

    click(chevron());
    expect(shows()).toBe(true);
    expect(ranges()).toEqual([
      [26, 26],
      [28, 28],
    ]);
    // A manually unfolded block stays open while the caret moves elsewhere.
    select(view, 27);
    expect(shows()).toBe(true);

    click(chevron());
    expect(shows()).toBe(false);
    expect(ranges()).toEqual([[27, 27]]);
  });

  it("clicking Properties unfolds frontmatter without moving the caret", () => {
    const view = mount("---\ntitle: x\n---\nbody", { focused: true, selection: [20] });
    view.contentDOM
      .querySelector(".cm-md-properties")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(caret(view)).toBe(20);
    expect(lines(view).map((element) => sourceText(element))).toEqual([
      "---",
      "title: x",
      "---",
      "body",
    ]);
    expect(view.contentDOM.querySelector(".cm-md-fold-open")).not.toBeNull();
  });

  it("adds no fold during an IME composition, and adds it on the next transaction", () => {
    const view = mount("---\na: 1\nbody");
    const folded = () => view.contentDOM.querySelector(".cm-md-properties") !== null;
    expect(folded()).toBe(false);
    view.dispatch({ changes: { from: 9, insert: "---\n" }, userEvent: "input.type.compose" });
    expect(view.state.doc.toString()).toBe("---\na: 1\n---\nbody");
    expect(folded()).toBe(false);
    view.dispatch({});
    expect(folded()).toBe(true);
  });

  it("draws a task's checkbox in its list marker's slot, so task text starts where bullet text does", () => {
    const doc = "- a\n- [ ] b";
    for (const selection of [0, doc.length]) {
      const view = mount(doc, { focused: true, selection: [selection] });
      const box = line(view, 2).querySelector("input.cm-md-checkbox");
      // The checkbox replaced the `-` itself: no spacer, no literal marker, `[ ]` collapsed.
      expect(box?.parentElement?.classList.contains("cm-md-task-box")).toBe(true);
      expect(box?.parentElement?.textContent).toBe("-");
      expect(line(view, 2).querySelector(".cm-md-bullet, .cm-md-syntax")).toBeNull();
      expect(sourceText(line(view, 2))).toBe(" b");
    }
    // With the bullet hidden too, both lines show one marker-width slot, a space, and text.
    const view = mount(doc, { focused: true, selection: [doc.length] });
    expect(line(view, 1).querySelector(".cm-md-bullet")?.textContent).toBe("-");
    expect(sourceText(line(view, 1))).toBe(" a");
    expect(sourceText(line(view, 2))).toBe(" b");
  });

  it("gives quote lines a hanging indent so wrapped rows align with the text after the rails", () => {
    // happy-dom substitutes the custom properties but leaves calc() unevaluated; the
    // default indent is 1.1em of the 16px test font.
    const indent = "17.6px";
    for (const [doc, depth] of [
      ["> q", 1],
      ["> > q", 2],
    ] as const) {
      const quoted = line(mount(doc), 1);
      const style = getComputedStyle(quoted);
      expect(style.paddingLeft, doc).toBe(`calc(6px + ${depth} * ${indent})`);
      expect(style.textIndent, doc).toBe(`calc(-1 * ${depth} * ${indent})`);
      const spacers = [...quoted.querySelectorAll<HTMLElement>(".cm-md-quote-spacer")];
      expect(spacers).toHaveLength(depth);
      spacers.forEach((spacer, level) => {
        expect(spacer.textContent).toBe("> ");
        expect(getComputedStyle(spacer).width).toBe(indent);
        expect(spacer.style.getPropertyValue("--atlas-md-quote-level").trim()).toBe(String(level));
      });
    }

    const long = mount(`> ${"a long quoted sentence that wraps ".repeat(12)}`);
    expect(line(long, 1).style.getPropertyValue("--atlas-md-quote-depth").trim()).toBe("1");

    // A quote that does not open its line keeps an inline slot and no hanging indent.
    const listed = line(mount("- > q"), 1);
    expect(listed.querySelector(".cm-md-quote-spacer-inline")?.textContent).toBe("> ");
    expect(listed.style.getPropertyValue("--atlas-md-quote-depth")).toBe("");
  });
});

/** Every atomic range the live preview holds, from the view plugin and the block field. */
function atomicRanges(view: EditorView) {
  const ranges: [number, number][] = [];
  const collect = (from: number, to: number) => {
    ranges.push([from, to]);
  };
  view.plugin(previewDecorations)?.atomic.between(0, view.state.doc.length, collect);
  view.state.field(previewFolds).atomic.between(0, view.state.doc.length, collect);
  return ranges;
}

/** Each line's classes and shown text, to compare two states of the same document. */
const snapshot = (view: EditorView) =>
  lines(view).map((element) => [element.className, element.textContent]);

describe("HTML shown as code", () => {
  it("A99. an HTML block has code-block lines, an `html` label on its first line only, every character, nothing atomic, and nothing to reveal", () => {
    const doc = "<div>\n  <p>x</p>\n</div>\n\nafter";
    const view = mount(doc);
    const block = lines(view).slice(0, 3);
    for (const element of block) {
      expect(element.classList.contains("cm-md-code")).toBe(true);
      expect(element.classList.contains("cm-md-html")).toBe(true);
    }
    expect(block[0]?.classList.contains("cm-md-code-first")).toBe(true);
    expect(block[2]?.classList.contains("cm-md-code-last")).toBe(true);
    expect(line(view, 4).classList.contains("cm-md-code")).toBe(false);
    expect(texts(view, ".cm-md-code-label")).toEqual(["html"]);
    expect(line(view, 1).querySelector(".cm-md-code-label")).not.toBeNull();
    expect(view.contentDOM.querySelector(".cm-md-copy")).toBeNull();
    expect(block.map((element) => sourceText(element))).toEqual(["<div>", "  <p>x</p>", "</div>"]);
    expect(atomicRanges(view)).toEqual([]);

    // Placing the caret inside changes nothing, and ArrowRight steps one character.
    const rest = snapshot(view);
    const focused = mount(doc, { focused: true, selection: [0] });
    expect(snapshot(focused)).toEqual(rest);
    for (let pos = 1; pos <= 6; pos++) {
      cursorCharRight(focused);
      expect(caret(focused)).toBe(pos);
      expect(snapshot(focused)).toEqual(rest);
    }
  });

  it("A100. each inline HTML tag is its own inline code span, with ordinary Markdown between tags and no reveal on adjacency", () => {
    const doc = "before <span>x</span> after";
    const view = mount(doc);
    expect(texts(view, ".cm-md-inline-code")).toEqual(["<span>", "</span>"]);
    expect(sourceText(line(view, 1))).toBe(doc);
    const focused = mount(doc, { focused: true, selection: [0] });
    for (const pos of [6, 7, 10, 13, 14, 21, 22]) {
      select(focused, pos);
      expect(texts(focused, ".cm-md-inline-code"), `caret at ${pos}`).toEqual([
        "<span>",
        "</span>",
      ]);
      expect(sourceText(line(focused, 1))).toBe(doc);
      expect(focused.contentDOM.querySelector(".cm-md-syntax")).toBeNull();
    }
    expect(atomicRanges(focused)).toEqual([]);

    // Markdown between tags stays Markdown.
    const bold = mount("<span>**b**</span>");
    expect(texts(bold, ".cm-md-inline-code")).toEqual(["<span>", "</span>"]);
    expect(texts(bold, ".cm-md-strong")).toEqual(["b"]);
    expect(sourceText(line(bold, 1))).toBe("<span>b</span>");

    // A `>` inside a quoted attribute belongs to its tag.
    const quoted = mount('<span title="a>b">x</span>');
    expect(texts(quoted, ".cm-md-inline-code")).toEqual(['<span title="a>b">', "</span>"]);

    // Many tags decorate in one linear pass.
    const many = mount(`a ${"<br> ".repeat(400)}b`);
    expect(many.contentDOM.querySelectorAll(".cm-md-inline-code")).toHaveLength(400);
  });

  it("A101. HTML in an `html` fence is fenced code, and an escaped `\\<div>` is plain text", () => {
    const fenced = mount("```html\n<div>\n</div>\n```\n\nafter");
    expect(sourceText(line(fenced, 1))).toBe("");
    expect(texts(fenced, ".cm-md-code-label")).toEqual(["html"]);
    expect(fenced.contentDOM.querySelector(".cm-md-copy")).not.toBeNull();
    expect(fenced.contentDOM.querySelector(".cm-md-html")).toBeNull();

    const escaped = mount("\\<div>\n\nafter");
    expect(sourceText(line(escaped, 1))).toBe("<div>");
    expect(line(escaped, 1).classList.contains("cm-md-code")).toBe(false);
    expect(escaped.contentDOM.querySelector(".cm-md-inline-code, .cm-md-html")).toBeNull();
  });
});
