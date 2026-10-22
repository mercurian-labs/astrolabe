import { describe, expect, it } from "vite-plus/test";

import { parseRecentFiles } from "./ReviewService.ts";

const MARK = "\u001e";

describe("parseRecentFiles", () => {
  it("lists each file once, at its newest commit, newest first", () => {
    const stdout = [
      `${MARK}2026-10-19T10:00:00-04:00\tfeat: the filter`,
      "",
      "apps/web/a.ts",
      "docs/b.md",
      `${MARK}2026-10-18T09:00:00-04:00\tfix: tabs`,
      "",
      "apps/web/a.ts",
      "apps/web/c.ts",
      "",
    ].join("\n");
    expect(parseRecentFiles(stdout, 10)).toEqual([
      {
        path: "apps/web/a.ts",
        changedAt: "2026-10-19T10:00:00-04:00",
        subject: "feat: the filter",
      },
      { path: "docs/b.md", changedAt: "2026-10-19T10:00:00-04:00", subject: "feat: the filter" },
      { path: "apps/web/c.ts", changedAt: "2026-10-18T09:00:00-04:00", subject: "fix: tabs" },
    ]);
  });

  it("stops at the limit", () => {
    const stdout = `${MARK}2026-10-19T10:00:00Z\ts\n\na\nb\nc\n`;
    expect(parseRecentFiles(stdout, 2).map((file) => file.path)).toEqual(["a", "b"]);
  });
});
