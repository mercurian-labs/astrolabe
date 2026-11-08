import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CanvasMarkdown } from "./CanvasMarkdown";

const html = (text: string, onOpenUrl: ((href: string) => void) | null = () => undefined) =>
  renderToStaticMarkup(<CanvasMarkdown text={text} host={{ onOpenUrl: onOpenUrl ?? undefined }} />);

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
      '<p>See <span class="cv-wikilink">the alpha</span> and <span class="cv-wikilink">Beta</span></p>',
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

  it("shows syntax it can't draw as its source, not nothing", () => {
    expect(html("<div>raw</div>")).toContain("&lt;div&gt;raw&lt;/div&gt;");
  });

  it("draws a table, a callout and a tag", () => {
    expect(html("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    const callout = html("> [!warning] Careful\n> Body");
    expect(callout).toContain('data-callout="warning"');
    expect(callout).toContain("Careful");
    expect(callout).toContain("<p>Body</p>");
    expect(callout).not.toContain("[!warning]");
    expect(html("A #tag here")).toContain('<span class="cv-tag">#tag</span>');
  });

  it("dims a link to nothing, opens one to something, and shows its alias", () => {
    const markup = (text: string) =>
      renderToStaticMarkup(
        <CanvasMarkdown
          text={text}
          host={{ onOpenLink: () => undefined, isResolved: (name) => name === "Here" }}
        />,
      );
    expect(markup("[[Here|shown]]")).toContain(">shown</button>");
    expect(markup("[[Here|shown]]")).not.toContain("data-missing");
    expect(markup("[[Gone]]")).toContain("data-missing");
  });

  it("hands a diagram and an embed to its host, and shows them as text without one", () => {
    const host = {
      renderMermaid: (source: string) => <i>{source}</i>,
      renderEmbed: (target: string) => <b>{target}</b>,
    };
    const fence = "```mermaid\ngraph TD\n```";
    expect(renderToStaticMarkup(<CanvasMarkdown text={fence} host={host} />)).toContain(
      "<i>graph TD</i>",
    );
    expect(html(fence)).toBe("<pre>graph TD</pre>");
    expect(renderToStaticMarkup(<CanvasMarkdown text="![[Note#H]]" host={host} />)).toBe(
      '<div class="cv-md-paragraph"><span><b>Note#H</b></span></div>',
    );
  });

  it("drops an escape's backslash and a comment", () => {
    expect(html("\\*plain\\* %%hidden%% shown")).toBe("<p>*plain*  shown</p>");
  });
});
