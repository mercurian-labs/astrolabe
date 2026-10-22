import { afterEach, describe, expect, it } from "vite-plus/test";
import { cursorCharLeft, cursorCharRight } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { revealActive } from "./reveal.ts";
import { caret, destroyViews, line, mount, select, sourceText } from "./testSupport.ts";

afterEach(destroyViews);

describe("reveal model", () => {
  it("A1. `**bold** text`, unfocused editor, selection at 0: no markers visible", () => {
    const view = mount("**bold** text");
    expect(sourceText(line(view, 1))).toBe("bold text");
  });

  it("A2. after a focus event, `**` shows at carets 0, 2, and 8 and hides at 9", async () => {
    const view = mount("**bold** text");
    view.focus();
    select(view, 0);
    // CodeMirror delivers the focus change as its own transaction on the next microtask.
    await Promise.resolve();
    expect(view.state.field(revealActive)).toBe(true);
    for (const pos of [0, 2, 8]) {
      select(view, pos);
      expect(sourceText(line(view, 1)), `caret at ${pos}`).toBe("**bold** text");
    }
    select(view, 9);
    expect(sourceText(line(view, 1))).toBe("bold text");
  });

  it("A3. `# Title/body`, focused: caret on `body` hides `#`; caret at end of line 1 shows `# `", () => {
    const view = mount("# Title\nbody", { focused: true, selection: [9] });
    expect(sourceText(line(view, 1))).toBe("Title");
    select(view, 7);
    expect(sourceText(line(view, 1))).toBe("# Title");
  });

  it("A4. `plain **bold** plain`, caret at 0 on the same line: `**` hidden", () => {
    const view = mount("plain **bold** plain", { focused: true, selection: [0] });
    expect(sourceText(line(view, 1))).toBe("plain bold plain");
  });

  it("A5. `**a *b* c**`, caret in `a`: outer `**` and inner `*` both visible; caret two characters past the closing `**`: all hidden", () => {
    const view = mount("**a *b* c** xyz", { focused: true, selection: [3] });
    expect(sourceText(line(view, 1))).toBe("**a *b* c** xyz");
    select(view, 13);
    expect(sourceText(line(view, 1))).toBe("a b c xyz");
  });

  it("A6. a partial selection over `**bold**` reveals it; a selection ending at column 0 of line 4 does not reveal line 4", () => {
    const view = mount("x **bold** y", { focused: true, selection: [[0, 4]] });
    expect(sourceText(line(view, 1))).toBe("x **bold** y");

    const lines = mount("a\nb\nc\n# H", { focused: true, selection: [[0, 6]] });
    expect(sourceText(line(lines, 4))).toBe("H");
  });

  it("A7. two carets on two bold spans reveal both; one caret elsewhere hides both", () => {
    const view = mount("**a** and **b**", { focused: true, selection: [0, 15] });
    expect(sourceText(line(view, 1))).toBe("**a** and **b**");
    select(view, 7);
    expect(sourceText(line(view, 1))).toBe("a and b");
  });

  it("A8. editor blurs after focus: reveal state unchanged", async () => {
    const view = mount("**bold** text", { selection: [0] });
    view.focus();
    select(view, 0);
    await Promise.resolve();
    expect(sourceText(line(view, 1))).toBe("**bold** text");
    view.contentDOM.blur();
    select(view, 0);
    await Promise.resolve();
    expect(view.hasFocus).toBe(false);
    expect(sourceText(line(view, 1))).toBe("**bold** text");
  });

  it("A9. `# First/second`, fresh editor, no focus: `#` not visible", () => {
    const view = mount("# First\nsecond");
    expect(sourceText(line(view, 1))).toBe("First");
  });
});

describe("text is never atomic", () => {
  it("A10. landing inside `bold` from the next line puts the caret on that character, not a span edge", () => {
    const view = mount("abc **bold** def\nnext", { focused: true, selection: [19] });
    // The vertical motion's landing point, as a keyboard selection.
    select(view, 7);
    expect(caret(view)).toBe(7);
    for (const source of view.state.facet(EditorView.atomicRanges)) {
      source(view).between(0, view.state.doc.length, (from, to) => {
        expect(from >= 10 || to <= 6, `atomic ${from}-${to} covers text`).toBe(true);
      });
    }
  });

  // Needs a browser, so not tested here: A11. clicking the letter `o` in rendered `bold` puts the
  // caret after `b`

  it("A12. `abc**bold**def`, caret at 6: ArrowRight goes to 7, ArrowLeft returns to 6", () => {
    const view = mount("abc**bold**def", { focused: true, selection: [6] });
    cursorCharRight(view);
    expect(caret(view)).toBe(7);
    cursorCharLeft(view);
    expect(caret(view)).toBe(6);
  });
});
