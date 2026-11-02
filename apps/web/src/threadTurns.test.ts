import { describe, expect, it } from "vite-plus/test";

import { askedLine, replyLine } from "./threadTurns";

describe("askedLine", () => {
  it("takes the first line with real text, past lines that only link an attachment", () => {
    expect(askedLine("\n  Find the bug\nin the ledger")).toBe("Find the bug");
    expect(
      askedLine(
        "[image.png](t3-attachment://a1/image.png)\n" +
          "![shot](t3-attachment://a2/shot.png) [log.txt](t3-attachment://a3/log.txt)\n" +
          "Why does this crash?",
      ),
    ).toBe("Why does this crash?");
    // Attachments and annotations ahead of the text on its own line are passed over too.
    expect(
      askedLine(
        "![image.png](t3-context://v1/image/i1) [Astrolabe (Dev)](t3-context://v1/preview-annotation/a4) Should steer go here?",
      ),
    ).toBe("Should steer go here?");
    expect(
      askedLine("Add a surface behind it like this ![image.png](t3-context://v1/image/i2)"),
    ).toBe("Add a surface behind it like this");
    // A link inside a sentence is part of what was asked.
    expect(askedLine("Read [the spec](https://example.com/spec) first")).toBe(
      "Read [the spec](https://example.com/spec) first",
    );
  });

  it("falls back to the first link's text when the message is only links", () => {
    expect(askedLine("![](t3-attachment://a1/blank.png)\n[image.png](t3-attachment://a2)")).toBe(
      "image.png",
    );
    expect(askedLine("![](t3-attachment://a1/blank.png)")).toBeNull();
    expect(askedLine("  \n ")).toBeNull();
  });
});

describe("replyLine", () => {
  it("reads a reply's first line with text as plain words", () => {
    expect(replyLine("\n## Done\nThe rest")).toBe("Done");
    expect(replyLine("- **Fixed** the [ledger](src/ledger.ts) in `main`")).toBe(
      "Fixed the ledger in main",
    );
    expect(replyLine("  \n")).toBeNull();
  });
});
