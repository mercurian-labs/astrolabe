import { describe, expect, it } from "@effect/vitest";

import { countStatusFiles, parseWorktreeList } from "./worktreeList.ts";

describe("parseWorktreeList", () => {
  it("reads branches and detached heads, first record as the main checkout", () => {
    const stdout = [
      "worktree /repo\0HEAD aaa\0branch refs/heads/main\0",
      "worktree /wt/one\0HEAD bbb\0detached\0",
      "worktree /wt/gone\0HEAD ccc\0branch refs/heads/old\0prunable gitdir file points to non-existent location\0",
      "",
    ].join("\0");
    expect(parseWorktreeList(stdout)).toEqual([
      { path: "/repo", isMain: true, branch: "main", head: "aaa" },
      { path: "/wt/one", isMain: false, branch: null, head: "bbb" },
    ]);
  });

  it("counts a rename once", () => {
    expect(countStatusFiles("R  new.txt\0old.txt\0?? added.txt\0")).toBe(2);
  });
});
