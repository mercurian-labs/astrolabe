import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { MemoryMarkdown } from "./memoryMarkdown";

describe("MemoryMarkdown", () => {
  it("renders resolved and unresolved wikilinks while leaving code untouched", () => {
    const markup = renderToStaticMarkup(
      <MemoryMarkdown
        markdown={"Open [[Written|the note]] and [[Future]]. `[[Code]]`"}
        links={[
          { name: "Written", exists: true },
          { name: "Future", exists: false },
        ]}
        onOpenNote={vi.fn()}
      />,
    );

    expect(markup).toContain(">the note</button>");
    expect(markup).toContain('aria-label="Future, not yet written"');
    expect(markup).toContain(">Future</button>");
    expect(markup).toContain("<code>[[Code]]</code>");
  });

  it("keeps external links as ordinary anchors", () => {
    const markup = renderToStaticMarkup(
      <MemoryMarkdown
        markdown={"[Docs](https://example.com/docs)"}
        links={[]}
        onOpenNote={vi.fn()}
      />,
    );
    expect(markup).toContain('<a href="https://example.com/docs">Docs</a>');
  });
});
