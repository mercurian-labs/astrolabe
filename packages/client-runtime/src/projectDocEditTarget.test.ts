import { describe, expect, it } from "vite-plus/test";

import { locateProjectRoot, projectDocEditTarget } from "./projectDocEditTarget.ts";

const hosted = { path: "/work/app", state: "git", hostBacked: true } as const;

describe("projectDocEditTarget", () => {
  it("drafts a document in a hosted repository's main checkout on its default branch", () => {
    expect(
      projectDocEditTarget({
        root: hosted,
        checkout: null,
        onDefaultBranch: true,
        file: "docs/Plan.md",
      }),
    ).toEqual({ kind: "draft" });
    expect(
      projectDocEditTarget({
        root: hosted,
        checkout: "/work/app/",
        onDefaultBranch: true,
        file: "Board.canvas",
      }),
    ).toEqual({ kind: "draft" });
  });

  it("waits to hear the branch before it picks a draft", () => {
    expect(
      projectDocEditTarget({
        root: hosted,
        checkout: null,
        onDefaultBranch: null,
        file: "Plan.md",
      }),
    ).toEqual({ kind: "pending" });
  });

  it("writes on disk on another branch, in a worktree, without a host, or without Git", () => {
    const disk = { kind: "disk", folder: "/work/app" };
    expect(
      projectDocEditTarget({ root: hosted, checkout: null, onDefaultBranch: false, file: "a.md" }),
    ).toEqual(disk);
    expect(
      projectDocEditTarget({
        root: hosted,
        checkout: "/work/.t3/worktrees/app/t1",
        onDefaultBranch: null,
        file: "a.md",
      }),
    ).toEqual({ kind: "disk", folder: "/work/.t3/worktrees/app/t1" });
    expect(
      projectDocEditTarget({
        root: { ...hosted, hostBacked: false },
        checkout: null,
        onDefaultBranch: true,
        file: "a.md",
      }),
    ).toEqual(disk);
    expect(
      projectDocEditTarget({
        root: { ...hosted, state: "plain", hostBacked: false },
        checkout: null,
        onDefaultBranch: null,
        file: "a.base",
      }),
    ).toEqual(disk);
  });

  it("always writes code on disk", () => {
    expect(
      projectDocEditTarget({
        root: hosted,
        checkout: null,
        onDefaultBranch: true,
        file: "src/main.ts",
      }),
    ).toEqual({ kind: "disk", folder: "/work/app" });
  });
});

describe("locateProjectRoot", () => {
  const roots = [
    { key: "app", path: "/work/app", checkout: "/work/app" },
    { key: "api", path: "/work/app/services/api", checkout: "/work/app/services/api" },
    { key: "docs", path: "/elsewhere/docs", checkout: "/wt/docs" },
  ];

  it("picks the deepest root, with the path from it", () => {
    expect(locateProjectRoot(roots, "/work/app/services/api/README.md")).toMatchObject({
      root: { key: "api" },
      path: "README.md",
    });
    expect(locateProjectRoot(roots, "/work/app/services/web/Plan.md")).toMatchObject({
      root: { key: "app" },
      path: "services/web/Plan.md",
    });
  });

  it("finds a root by its checkout or its own folder", () => {
    expect(locateProjectRoot(roots, "/wt/docs/a/Plan.md")).toMatchObject({
      root: { key: "docs" },
      folder: "/wt/docs",
      path: "a/Plan.md",
    });
    expect(locateProjectRoot(roots, "/elsewhere/docs/Plan.md")).toMatchObject({
      root: { key: "docs" },
      folder: "/elsewhere/docs",
    });
  });

  it("finds nothing outside every root, nor in a folder sharing a prefix", () => {
    expect(locateProjectRoot(roots, "/work/application/Plan.md")).toBeNull();
    expect(locateProjectRoot(roots, "/tmp/Plan.md")).toBeNull();
  });

  it("reads Windows paths", () => {
    expect(
      locateProjectRoot(
        [{ key: "app", path: "C:\\work\\app", checkout: null }],
        "C:\\work\\app\\a\\Plan.md",
      ),
    ).toMatchObject({ root: { key: "app" }, path: "a/Plan.md" });
  });
});
