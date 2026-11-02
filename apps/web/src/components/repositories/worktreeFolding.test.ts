import type { ProjectWorktree } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { foldWorktrees, groupFolded } from "./worktreeFolding";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const worktree = (overrides: Partial<ProjectWorktree>): ProjectWorktree => ({
  path: "/wt/x",
  isMain: false,
  branch: "x",
  head: "abc",
  alias: "x",
  number: null,
  madeBy: "claude-code",
  lastActiveAt: new Date(NOW - 30 * DAY).toISOString(),
  kept: false,
  holds: [],
  changedFiles: null,
  ...overrides,
});

const names = (entries: ReadonlyArray<{ readonly worktree: ProjectWorktree }>) =>
  entries.map((entry) => entry.worktree.alias);

describe("which worktrees a project lists", () => {
  it("lists those in use, opened, open in a tab or recent, and folds the rest", () => {
    const entries = [
      worktree({ alias: "main", isMain: true, madeBy: null }),
      worktree({ alias: "numbered", number: 3 }),
      worktree({ alias: "working", holds: [{ kind: "working", label: "Fix is working here" }] }),
      worktree({ alias: "idle", holds: [{ kind: "thread", label: "Used by Fix" }] }),
      worktree({ alias: "tab", branch: "tab", path: "/wt/tab" }),
      worktree({ alias: "recent", lastActiveAt: new Date(NOW - DAY / 2).toISOString() }),
      worktree({ alias: "yesterday", lastActiveAt: new Date(NOW - 2 * DAY).toISOString() }),
      worktree({ alias: "changed", changedFiles: 2 }),
      worktree({ alias: "external", holds: [{ kind: "external", label: "Made elsewhere" }] }),
      worktree({ alias: "old", lastActiveAt: null }),
    ].map((each) => ({ worktree: each, outside: false }));
    const { listed, rest } = foldWorktrees(entries, {
      openCheckouts: new Set(["branch:tab"]),
      now: NOW,
    });
    expect(names(listed)).toEqual(["main", "numbered", "working", "tab", "recent", "changed"]);
    expect(names(rest)).toEqual(["idle", "yesterday", "external", "old"]);
  });

  it("always lists the focused tab's worktree", () => {
    const { listed } = foldWorktrees([{ worktree: worktree({ alias: "old" }), outside: true }], {
      openCheckouts: new Set(),
      now: NOW,
    });
    expect(names(listed)).toEqual(["old"]);
  });

  it("groups the folded by the tool that made them, newest first, as searched", () => {
    const rest = [
      worktree({ alias: "a", madeBy: "claude-code", lastActiveAt: "2026-10-01T00:00:00Z" }),
      worktree({ alias: "b", madeBy: "astrolabe", lastActiveAt: "2026-10-02T00:00:00Z" }),
      worktree({ alias: "c", madeBy: "claude-code", lastActiveAt: "2026-10-03T00:00:00Z" }),
    ].map((each) => ({ worktree: each }));
    expect(groupFolded(rest, "").map((group) => [group.label, names(group.entries)])).toEqual([
      ["Astrolabe", ["b"]],
      ["Claude Code", ["c", "a"]],
    ]);
    expect(groupFolded(rest, "C").map((group) => names(group.entries))).toEqual([["c"]]);
  });
});
