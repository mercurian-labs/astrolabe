import { describe, expect, it } from "vite-plus/test";

import { mergeMarkdown, paragraphs, sentences } from "./merge.ts";

const merged = (base: string, ours: string, theirs: string) => {
  const outcome = mergeMarkdown(base, ours, theirs);
  return outcome.status === "merged" ? outcome.text : "CONFLICT";
};

describe("markdown merge", () => {
  it("tokens round-trip the exact text", () => {
    const text = "# Title\n\nFirst. Second!  Third?\nNext line\n\n\n- item\n- item two\nNo newline";
    expect(paragraphs(text).join("")).toBe(text);
    for (const block of paragraphs(text)) expect(sentences(block).join("")).toBe(block);
  });

  it("merges edits to different paragraphs", () => {
    const base = "# A\n\nOne.\n\nTwo.\n";
    expect(merged(base, "# A\n\nOne, edited.\n\nTwo.\n", "# A\n\nOne.\n\nTwo, edited.\n")).toBe(
      "# A\n\nOne, edited.\n\nTwo, edited.\n",
    );
  });

  it("merges edits to different sentences of one paragraph, which a line merge calls a conflict", () => {
    const base = "Alpha is first. Beta is second. Gamma is third.\n";
    const ours = "Alpha comes first. Beta is second. Gamma is third.\n";
    const theirs = "Alpha is first. Beta is second. Gamma comes last.\n";
    expect(merged(base, ours, theirs)).toBe(
      "Alpha comes first. Beta is second. Gamma comes last.\n",
    );
  });

  it("reports a conflict when both sides change the same sentence differently", () => {
    const base = "The sky is blue. Grass is green.\n";
    expect(
      merged(base, "The sky is grey. Grass is green.\n", "The sky is black. Grass is green.\n"),
    ).toBe("CONFLICT");
  });

  it("takes an identical change once, and keeps additions from both sides", () => {
    const base = "One.\n\nTwo.\n";
    expect(merged(base, "One.\n\nTwo!\n", "One.\n\nTwo!\n")).toBe("One.\n\nTwo!\n");
    expect(merged(base, "Zero.\n\nOne.\n\nTwo.\n", "One.\n\nTwo.\n\nThree.\n")).toBe(
      "Zero.\n\nOne.\n\nTwo.\n\nThree.\n",
    );
  });

  it("keeps a deletion on one side when the other edited a paragraph further away", () => {
    const base = "One.\n\nTwo.\n\nThree.\n\nFour.\n";
    expect(
      merged(base, "One.\n\nThree.\n\nFour.\n", "One.\n\nTwo.\n\nThree.\n\nFour, edited.\n"),
    ).toBe("One.\n\nThree.\n\nFour, edited.\n");
  });

  it("treats changes to touching paragraphs as a conflict, as diff3 and git do", () => {
    const base = "One.\n\nTwo.\n\nThree.\n";
    expect(merged(base, "One.\n\nThree.\n", "One.\n\nTwo.\n\nThree, edited.\n")).toBe("CONFLICT");
  });

  it("conflicts when one side deletes a paragraph the other edited", () => {
    const base = "One.\n\nTwo.\n\nThree.\n";
    expect(merged(base, "One.\n\nThree.\n", "One.\n\nTwo, edited.\n\nThree.\n")).toBe("CONFLICT");
  });
});
