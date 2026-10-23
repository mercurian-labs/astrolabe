import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { katexLoaded, loadKatex } from "./math.ts";
import { destroyViews, line, lines, mount, select, sourceText, texts } from "./testSupport.ts";

afterEach(destroyViews);

const widgets = (element: ParentNode) => [
  ...element.querySelectorAll<HTMLElement>(".cm-md-math-widget"),
];

// KaTeX loads once per module; this block runs first, before anything has loaded it.
describe("math before KaTeX loads", () => {
  it("A72. a math node renders as styled source until the loader resolves; the rebuild then shows the widget", async () => {
    expect(katexLoaded()).toBe(false);
    const doc = "L $E=mc^2$ R\n\n$$\nx\n$$";
    const view = mount(doc);
    expect(widgets(view.contentDOM)).toEqual([]);
    expect(texts(view, ".cm-md-math")).toEqual(["E=mc^2"]);
    expect(sourceText(line(view, 1))).toBe("L E=mc^2 R");
    expect(line(view, 4).classList.contains("cm-md-math-block")).toBe(true);

    // The view asked for KaTeX when it met math; its arrival rebuilt the decorations.
    await loadKatex();
    expect(line(view, 1).querySelector(".cm-md-math-widget .katex")).not.toBeNull();
    expect(sourceText(line(view, 1))).toBe("L  R");
    expect(view.contentDOM.querySelector(".cm-md-math-display .katex-display")).not.toBeNull();
  });
});

describe("rendered math", () => {
  beforeAll(async () => {
    await loadKatex();
  });

  it("A67. `L $E=mc^2$ R` at rest: the source is replaced by a rendered KaTeX widget; `L` and `R` remain", () => {
    const view = mount("L $E=mc^2$ R");
    const [widget] = widgets(line(view, 1));
    expect(widget?.querySelector(".katex")).not.toBeNull();
    expect(sourceText(line(view, 1))).toBe("L  R");
    expect(sourceText(line(view, 1))).not.toContain("$");
  });

  it("A68. touching the formula swaps the widget for the source with dimmed `$`; moving away brings it back", () => {
    const doc = "L $E=mc^2$ R";
    const view = mount(doc, { focused: true, selection: [0] });
    // The element is `[2, 10)`: adjacent at 2 and 10, inside at 4 (section 2.1).
    for (const pos of [2, 4, 10]) {
      select(view, pos);
      expect(widgets(view.contentDOM), `caret at ${pos}`).toEqual([]);
      expect(sourceText(line(view, 1))).toBe(doc);
      expect(texts(view, ".cm-md-syntax")).toEqual(["$", "$"]);
    }
    for (const pos of [1, 11, 12]) {
      select(view, pos);
      expect(widgets(view.contentDOM), `caret at ${pos}`).toHaveLength(1);
      expect(sourceText(line(view, 1))).toBe("L  R");
    }
  });

  it("A69. a `$$` block at rest is one block widget with display markup replacing all three lines", () => {
    const view = mount("$$\n\\int_0^1 x\\,dx\n$$\n\nafter");
    const blocks = [...view.contentDOM.querySelectorAll(".cm-md-math-display")];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.querySelector(".katex-display")).not.toBeNull();
    expect(lines(view).map((element) => sourceText(element))).toEqual(["", "after"]);
    expect(texts(view, ".cm-line").join("")).not.toContain("$$");
  });

  it("A70. with the caret in the block, the source shows with dimmed `$$` and a preview after the closing fence", () => {
    const doc = "$$\n\\int_0^1 x\\,dx\n$$\n\nafter";
    const view = mount(doc, { focused: true, selection: [5] });
    expect(
      lines(view)
        .slice(0, 3)
        .map((element) => sourceText(element)),
    ).toEqual(["$$", "\\int_0^1 x\\,dx", "$$"]);
    expect(texts(view, ".cm-md-syntax")).toEqual(["$$", "$$"]);
    const preview = line(view, 3).nextElementSibling;
    expect(preview?.classList.contains("cm-md-math-preview")).toBe(true);
    expect(preview?.querySelector(".katex-display")).not.toBeNull();

    select(view, doc.length);
    expect(view.contentDOM.querySelector(".cm-md-math-preview")).toBeNull();
    expect(view.contentDOM.querySelectorAll(".cm-md-math-display")).toHaveLength(1);
    expect(lines(view).map((element) => sourceText(element))).toEqual(["", "after"]);
  });

  it("A71. invalid TeX renders KaTeX's error markup with the error class and the message as a title", () => {
    const view = mount("$\\frac{$");
    const [widget] = widgets(line(view, 1));
    expect(widget?.querySelector(".katex-error")).not.toBeNull();
    expect(widget?.classList.contains("cm-md-math-error")).toBe(true);
    expect(widget?.title).toContain("KaTeX parse error");
  });

  it("A73. `$5 and $10` renders no math; `$$x$$` on one line renders block math", () => {
    const prices = mount("$5 and $10");
    expect(widgets(prices.contentDOM)).toEqual([]);
    expect(sourceText(line(prices, 1))).toBe("$5 and $10");

    const oneLine = mount("$$x$$\n\nafter");
    const display = oneLine.contentDOM.querySelectorAll(".cm-md-math-display .katex-display");
    expect(display).toHaveLength(1);
    expect(lines(oneLine).map((element) => sourceText(element))).toEqual(["", "after"]);
  });

  it("keeps an unclosed `$$` block as source", () => {
    const view = mount("$$\nx");
    expect(view.contentDOM.querySelector(".cm-md-math-display")).toBeNull();
    expect(line(view, 2).classList.contains("cm-md-math-block")).toBe(true);
  });

  it("does not rebuild a formula's DOM for an edit elsewhere", () => {
    const view = mount("L $E=mc^2$ R\n\nx");
    const before = widgets(view.contentDOM)[0];
    view.dispatch({ changes: { from: view.state.doc.length, insert: "yz" } });
    expect(widgets(view.contentDOM)[0]).toBe(before);
  });
});
