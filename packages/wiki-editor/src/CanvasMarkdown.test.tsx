import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CanvasMarkdown } from "./CanvasMarkdown";

const html = (text: string, onOpenUrl: ((href: string) => void) | null = () => undefined) =>
  renderToStaticMarkup(<CanvasMarkdown text={text} onOpenUrl={onOpenUrl ?? undefined} />);

describe("CanvasMarkdown", () => {
  it("draws inline marks without showing their syntax", () => {
    expect(html("**bold** *it* `code` ~~gone~~ ==hi==")).toBe(
      "<p><strong>bold</strong> <em>it</em> <code>code</code> <s>gone</s> <mark>hi</mark></p>",
    );
  });

  it("draws a list without its bullets as text, and a task as a checkbox", () => {
    const list = html("- one\n- two");
    expect(list).toBe("<ul><li><p>one</p></li><li><p>two</p></li></ul>");
    expect(html("- [x] done")).toContain('checked=""');
    expect(html("- [x] done")).not.toContain("[x]");
    expect(html("- [ ] open")).not.toContain('checked=""');
  });

  it("draws a fenced block's code without its fences or language", () => {
    expect(html("```ts\nconst a = 1;\nconst b = 2;\n```")).toBe(
      "<pre>const a = 1;\nconst b = 2;</pre>",
    );
  });

  it("names a heading's level and drops its marks", () => {
    expect(html("## Title")).toBe('<p class="cv-md-heading" data-level="2">Title</p>');
  });

  it("shows a wikilink as its alias, or its target", () => {
    expect(html("See [[Alpha|the alpha]] and [[Beta]]")).toBe(
      "<p>See <span>the alpha</span> and <span>Beta</span></p>",
    );
  });

  it("links web pages but never a script, and stays inert with nowhere to open", () => {
    expect(html("[site](https://example.com)")).toContain('<a href="https://example.com">site</a>');
    expect(html("[x](javascript:alert(1))")).not.toContain("<a");
    expect(html("[site](https://example.com)", null)).not.toContain("<a");
  });

  it("escapes HTML a model or a file writes", () => {
    expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
    expect(html("text <b>bold</b>")).not.toContain("<b>");
  });

  it("shows a table it can't draw as its source, not nothing", () => {
    expect(html("| a |\n| - |\n| b |")).toContain("| a |");
  });
});
