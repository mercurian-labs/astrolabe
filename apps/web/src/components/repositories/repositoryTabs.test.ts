import { EnvironmentId, ProjectId, WikiId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  folderOf,
  parseRepositoryTabKey,
  repositoryTabKey,
  type RepositoryTab,
} from "./repositoryTabs";

const environmentId = EnvironmentId.make("env:1");
const projectId = ProjectId.make("project-1");

describe("Repositories tab keys", () => {
  it("read back as the tab they name, whatever the path holds", () => {
    const tabs: RepositoryTab[] = [
      {
        kind: "file",
        environmentId,
        projectId,
        checkout: { cwd: "/Users/me/dev/app" },
        path: "src/a b:c.ts",
      },
      {
        kind: "file",
        environmentId,
        projectId,
        checkout: { branch: "feature/a:b" },
        path: "src/main.ts",
      },
      {
        kind: "diff",
        environmentId,
        projectId,
        checkout: { cwd: "/tmp/wt" },
        source: "branch-range",
      },
      {
        kind: "diff",
        environmentId,
        projectId,
        checkout: { branch: "main" },
        source: "working-tree",
      },
      {
        kind: "diff",
        environmentId,
        projectId,
        checkout: { branch: "feature/a" },
        source: "branch-range",
        base: "release/2.0",
      },
      {
        kind: "file",
        environmentId,
        wikiId: WikiId.make("wiki-1"),
        checkout: { branch: "cr/abc" },
        path: "AGENTS.md",
      },
      { kind: "graph", environmentId, projectId, checkout: { cwd: "/tmp/wt" }, path: null },
      {
        kind: "graph",
        environmentId,
        projectId,
        checkout: { branch: "feature/a" },
        path: "src/a b:c.ts",
      },
      { kind: "graph", environmentId, projectId, checkout: { branch: "feature/a" }, path: null },
      {
        kind: "search",
        environmentId,
        projectId,
        cwd: "/tmp/wt",
        search: {
          query: "a: b",
          caseSensitive: true,
          wholeWord: false,
          useRegex: false,
          include: "src/**",
        },
      },
      { kind: "problems", environmentId, projectId, cwd: "/tmp/wt" },
      { kind: "locations", environmentId, projectId, cwd: "/tmp/wt", id: "refs-1" },
    ];
    for (const tab of tabs) expect(parseRepositoryTabKey(repositoryTabKey(tab))).toEqual(tab);
  });

  it("leave other keys alone", () => {
    expect(parseRepositoryTabKey("chat:env:thread")).toBeNull();
    expect(parseRepositoryTabKey("repo-diff:a:b:c:sideways")).toBeNull();
    expect(parseRepositoryTabKey("repo-file:a:b")).toBeNull();
    expect(parseRepositoryTabKey("repo-file:a:b:folder:main:c.ts")).toBeNull();
    expect(parseRepositoryTabKey("repo-diff:a:b:c:working-tree~main")).toBeNull();
    expect(parseRepositoryTabKey("repo-graph:a:b")).toBeNull();
    expect(parseRepositoryTabKey("repo-graph:a:b:c:d:e")).toBeNull();
  });

  it("keep a following graph and a pinned one apart", () => {
    const following = repositoryTabKey({
      kind: "graph",
      environmentId,
      projectId,
      checkout: { branch: "main" },
      path: null,
    });
    const pinned = repositoryTabKey({
      kind: "graph",
      environmentId,
      projectId,
      checkout: { branch: "main" },
      path: "a.ts",
    });
    expect(following).not.toBe(pinned);
    expect(parseRepositoryTabKey(following)).toMatchObject({ kind: "graph", path: null });
  });

  it("name a file's folder", () => {
    expect(folderOf("apps/web/src/main.tsx")).toBe("apps/web/src");
    expect(folderOf("README.md")).toBe("");
  });
});
