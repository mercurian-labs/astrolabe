import { describe, expect, it } from "vite-plus/test";

import { wikiDocumentLink } from "./wikiRoutes";

describe("wikiDocumentLink", () => {
  it.each([
    ["wikis/e/w/documents/a/deep/Plan.md", "wikis/e/w/documents/a%2Fdeep%2FPlan.md"],
    ["/wikis/e/w/documents/a/Plan.md?x=1/2", "/wikis/e/w/documents/a%2FPlan.md?x=1/2"],
    ["wikis/e/w/changes/c/canvases/a/B.canvas", "wikis/e/w/changes/c/canvases/a%2FB.canvas"],
    ["wikis/e/w/documents/a%2FPlan.md", "wikis/e/w/documents/a%2FPlan.md"],
    ["wikis/e/w/documents/Plan", "wikis/e/w/documents/Plan"],
    ["wikis/e/w/changes/c", "wikis/e/w/changes/c"],
    ["repositories/file/a/b.ts", "repositories/file/a/b.ts"],
  ])("%s", (path, expected) => {
    expect(wikiDocumentLink(path)).toBe(expected);
  });
});
