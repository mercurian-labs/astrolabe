import { afterEach, describe, expect, it } from "vite-plus/test";
import { destroyViews, line, mount, select, sourceText, texts } from "./testSupport.ts";

afterEach(destroyViews);

describe("inline extras", () => {
  it("A38. `==mark==`: highlight span, markers hidden off-range", () => {
    const view = mount("==mark==");
    expect(texts(view, ".cm-md-highlight")).toEqual(["mark"]);
    expect(sourceText(line(view, 1))).toBe("mark");
  });

  it("A39. `\\*literal\\*`: backslashes hidden with the caret on another line, dimmed with the caret anywhere on the line", () => {
    const doc = "\\*literal\\* and far away\nnext";
    const view = mount(doc, { focused: true, selection: [doc.length] });
    expect(sourceText(line(view, 1))).toBe("*literal* and far away");
    expect(view.contentDOM.querySelector(".cm-md-em")).toBeNull();
    // Far from the escape, but on its line.
    select(view, 22);
    expect(sourceText(line(view, 1))).toBe("\\*literal\\* and far away");
    expect(texts(view, ".cm-md-syntax")).toEqual(["\\", "\\"]);
  });

  it("A40. `[^1]` is a superscript badge with `[^1]` fully visible in every state; the definition keeps its label", () => {
    const view = mount("a[^1]\n\n[^1]: text");
    expect(texts(view, ".cm-md-footnote-ref")).toEqual(["[^1]"]);
    expect(sourceText(line(view, 1))).toBe("a[^1]");
    const focused = mount("a[^1]\n\n[^1]: text", { focused: true, selection: [2] });
    expect(texts(focused, ".cm-md-footnote-ref")).toEqual(["[^1]"]);
    expect(focused.contentDOM.querySelector(".cm-md-syntax")).toBeNull();
    expect(texts(view, ".cm-md-footnote-label")).toEqual(["[^1]:"]);
    expect(sourceText(line(view, 3))).toBe("[^1]: text");
  });

  it("A41. `#tag` and `#a/b` are chips; `# heading` is not a tag; `#1` is not a tag", () => {
    const view = mount("#tag #a/b\n\n# heading\n\n#1 and x#y");
    expect(texts(view, ".cm-md-tag")).toEqual(["#tag", "#a/b"]);
    expect(line(view, 3).classList.contains("cm-md-heading")).toBe(true);
    expect(line(view, 3).querySelector(".cm-md-tag")).toBeNull();
    expect(line(view, 5).querySelector(".cm-md-tag")).toBeNull();
  });

  it("A42. `%%hidden%%`: dimmed span off-range, plain on-range", () => {
    const view = mount("%%hidden%%");
    expect(texts(view, ".cm-md-comment")).toEqual(["%%hidden%%"]);
    const focused = mount("%%hidden%%", { focused: true, selection: [0] });
    expect(focused.contentDOM.querySelector(".cm-md-comment")).toBeNull();
    expect(sourceText(line(focused, 1))).toBe("%%hidden%%");
  });

  it("A43. `$E=mc^2$`: math span, dollars hidden off-range", () => {
    const view = mount("$E=mc^2$ costs $5 and $10");
    expect(texts(view, ".cm-md-math")).toEqual(["E=mc^2"]);
    expect(sourceText(line(view, 1))).toBe("E=mc^2 costs $5 and $10");
  });

  it("A44. `line  /next` (two trailing spaces): return glyph off-range", () => {
    const view = mount("line  \nnext");
    expect(line(view, 1).querySelector(".cm-md-hard-break")).not.toBeNull();
    const focused = mount("line  \nnext", { focused: true, selection: [6] });
    expect(line(focused, 1).querySelector(".cm-md-hard-break")).toBeNull();
  });
});
