import type { Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";

import { canvasLinkHref, parseCanvasLinkHref } from "./canvasLinks.ts";
import { CHAT_MARKDOWN_REMARK_PLUGINS } from "./markdownPipeline.ts";

const links = (markdown: string) => {
  const processor = unified().use(remarkParse).use(CHAT_MARKDOWN_REMARK_PLUGINS);
  const found: Array<{ readonly url: string; readonly text: string }> = [];
  const visit = (node: Root | RootContent) => {
    if (node.type === "link") {
      found.push({
        url: node.url,
        text: node.children.map((child) => (child.type === "text" ? child.value : "")).join(""),
      });
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(processor.runSync(processor.parse(markdown), markdown) as Root);
  return found.map(({ url, text }) => ({ target: parseCanvasLinkHref(url), text }));
};

describe("canvas links in chat Markdown", () => {
  it("reads embeds and links of a board and its frames, in prose and lists", () => {
    expect(
      links(
        "First the cart:\n\n![[Checkout Flow.canvas#Storefront]]\n\n- then [[checkout flow#Payments|pay]]\n- and ![[Checkout Flow.canvas]] whole.",
      ),
    ).toEqual([
      {
        target: { name: "Checkout Flow.canvas", frame: "Storefront", embed: true },
        text: "Checkout Flow.canvas › Storefront",
      },
      { target: { name: "checkout flow", frame: "Payments", embed: false }, text: "pay" },
      {
        target: { name: "Checkout Flow.canvas", frame: undefined, embed: true },
        text: "Checkout Flow.canvas",
      },
    ]);
  });

  it("leaves code, and links already written, as they are", () => {
    expect(
      links("`![[A.canvas]]`\n\n```\n[[A.canvas]]\n```\n\n[see [[A.canvas]]](https://x.y)"),
    ).toEqual([{ target: null, text: "see [[A.canvas]]" }]);
  });

  it("round-trips names and frames that need escaping", () => {
    const target = { name: "Flow #2?.canvas", frame: "A/B & C", embed: true };
    expect(parseCanvasLinkHref(canvasLinkHref(target))).toEqual(target);
    expect(parseCanvasLinkHref("t3-canvas:link/%E0")).toBeNull();
    expect(parseCanvasLinkHref("https://example.com")).toBeNull();
  });
});
