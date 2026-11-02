import { describe, expect, it } from "@effect/vitest";
import type { ProjectSearchContentsInput } from "@t3tools/contracts";

import { withUnsavedTexts } from "./unsavedSearch.ts";

const input: ProjectSearchContentsInput = {
  cwd: "/repo",
  query: "todo",
  limit: 100,
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  contextLines: 1,
};

const diskMatch = (path: string, lineNumber: number) => ({
  path,
  lineNumber,
  lineContent: "todo on disk",
  matchRanges: [{ start: 0, end: 4 }],
});

describe("withUnsavedTexts", () => {
  it("searches an open document's text in place of its file on disk", () => {
    const page = {
      matches: [diskMatch("a.ts", 3), diskMatch("b.ts", 1)],
      truncated: true,
      nextCursor: "next",
    };
    const result = withUnsavedTexts(input, page, [
      { relativePath: "b.ts", text: "one\nTODO: typed\nthree" },
    ]);
    expect(result.matches).toEqual([
      {
        path: "b.ts",
        lineNumber: 2,
        lineContent: "TODO: typed",
        matchRanges: [{ start: 0, end: 4 }],
        contextBefore: ["one"],
        contextAfter: ["three"],
      },
      diskMatch("a.ts", 3),
    ]);
    expect(result.nextCursor).toBe("next");
  });

  it("leaves an open document's disk matches out of later pages without adding it again", () => {
    const page = { matches: [diskMatch("b.ts", 9), diskMatch("c.ts", 1)], truncated: false };
    const result = withUnsavedTexts({ ...input, cursor: "next" }, page, [
      { relativePath: "b.ts", text: "todo" },
    ]);
    expect(result.matches).toEqual([diskMatch("c.ts", 1)]);
  });

  it("respects the include and exclude globs", () => {
    const page = { matches: [], truncated: false };
    const result = withUnsavedTexts({ ...input, exclude: "*.md" }, page, [
      { relativePath: "notes.md", text: "todo" },
    ]);
    expect(result.matches).toEqual([]);
  });
});
