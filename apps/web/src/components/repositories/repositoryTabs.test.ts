import { EnvironmentId, ProjectId } from "@t3tools/contracts";
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
      { kind: "file", environmentId, projectId, cwd: "/Users/me/dev/app", path: "src/a b:c.ts" },
      { kind: "diff", environmentId, projectId, cwd: "/tmp/wt", source: "branch-range" },
      { kind: "graph", environmentId, projectId, cwd: "/tmp/wt", path: null },
      { kind: "graph", environmentId, projectId, cwd: "/tmp/wt", path: "src/a b:c.ts" },
    ];
    for (const tab of tabs) expect(parseRepositoryTabKey(repositoryTabKey(tab))).toEqual(tab);
  });

  it("leave other keys alone", () => {
    expect(parseRepositoryTabKey("chat:env:thread")).toBeNull();
    expect(parseRepositoryTabKey("repo-diff:a:b:c:sideways")).toBeNull();
    expect(parseRepositoryTabKey("repo-file:a:b")).toBeNull();
    expect(parseRepositoryTabKey("repo-graph:a:b")).toBeNull();
    expect(parseRepositoryTabKey("repo-graph:a:b:c:d:e")).toBeNull();
  });

  it("keep a following graph and a pinned one apart", () => {
    const following = repositoryTabKey({
      kind: "graph",
      environmentId,
      projectId,
      cwd: "/r",
      path: null,
    });
    const pinned = repositoryTabKey({
      kind: "graph",
      environmentId,
      projectId,
      cwd: "/r",
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
