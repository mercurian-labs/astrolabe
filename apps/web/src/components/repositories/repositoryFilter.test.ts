import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_REPOSITORY_FILTER,
  filterRepositoryKeys,
  filterWorktrees,
  parseRepositoryFilter,
  setWorktreeHidden,
  toggleFilterRepository,
} from "./repositoryFilter";

const keys = ["env:shop", "env:docs", "env:api"];

const worktrees = [
  { key: "env:/shop", worktree: { name: "main", changedFiles: 0 } },
  { key: "env:/t3-1", worktree: { name: "feature/login", changedFiles: 2 } },
  { key: "env:/t3-2", worktree: { name: "feature/billing", changedFiles: 0 } },
];
const names = (shown: ReturnType<typeof filterWorktrees<{ name: string; changedFiles: number }>>) =>
  shown.map(({ worktree, outside }) => (outside ? `${worktree.name} (outside)` : worktree.name));

describe("the repositories filter", () => {
  it("keeps the rest when one repository is unticked, and every one when all are", () => {
    const next = toggleFilterRepository(EMPTY_REPOSITORY_FILTER, "env:docs", keys);
    expect(filterRepositoryKeys(next, keys)).toEqual(new Set(["env:shop", "env:api"]));
    expect(filterRepositoryKeys(toggleFilterRepository(next, "env:docs", keys), keys)).toBeNull();
  });

  it("drops hidden worktrees and, asked for changes, clean ones", () => {
    const hidden = setWorktreeHidden(EMPTY_REPOSITORY_FILTER, "env:/t3-2", true);
    expect(names(filterWorktrees(hidden, worktrees, null))).toEqual(["main", "feature/login"]);
    expect(names(filterWorktrees({ ...hidden, changed: true }, worktrees, null))).toEqual([
      "feature/login",
    ]);
    expect(
      names(filterWorktrees(setWorktreeHidden(hidden, "env:/t3-2", false), worktrees, null)),
    ).toHaveLength(3);
  });

  it("shows the focused tab's worktree whatever the filter says, marked outside it", () => {
    const filter = {
      ...setWorktreeHidden(EMPTY_REPOSITORY_FILTER, "env:/t3-2", true),
      changed: true,
    };
    expect(names(filterWorktrees(filter, worktrees, "env:/t3-2"))).toEqual([
      "feature/login",
      "feature/billing (outside)",
    ]);
  });

  it("reads back only what it understands", () => {
    expect(parseRepositoryFilter('{"repositories":["env:shop",3],"changed":true}')).toEqual({
      repositories: ["env:shop"],
      hidden: [],
      changed: true,
    });
    expect(parseRepositoryFilter("not json")).toBeNull();
  });
});
