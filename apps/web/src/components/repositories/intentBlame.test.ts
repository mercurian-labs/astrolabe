import { describe, expect, it } from "vite-plus/test";

import { plainQuote } from "./intentBlame";

describe("plainQuote", () => {
  it.each([
    [
      "Those editor errors are only because the new package's dependencies aren't installed yet.",
      "Those editor errors are only because the new package",
    ],
    [
      "## Plan\n\n1. Writing the device-approval page next, then",
      "Writing the device-approval page next, then",
    ],
    [
      "The page was blank because nothing served `/device` there: auth only had the API.",
      "The page was blank because nothing served",
    ],
    ["- **Done.** Short", null],
    [
      "Updated [IntentBlame.ts](apps/server/src/vcs/IntentBlame.ts) to fix the cache check.",
      "Updated IntentBlame.ts to fix the cache check.",
    ],
    [
      "The same words appear twice here.\nThe same words appear twice here.\nBut this other line is only once.",
      "But this other line is only once.",
    ],
    ["Wait -- this one has a dash pair in its only long run", null],
  ])("quotes words that render as written: %s", (markdown, quote) => {
    expect(plainQuote(markdown)).toBe(quote);
  });

  it("stops at a word boundary", () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`);
    const quote = plainQuote(words.join(" "))!;
    expect(quote.length).toBeLessThanOrEqual(160);
    expect(words).toContain(quote.split(" ").at(-1));
  });
});
