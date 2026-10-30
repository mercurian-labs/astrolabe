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
    ];
    for (const tab of tabs) expect(parseRepositoryTabKey(repositoryTabKey(tab))).toEqual(tab);
  });

  it("leave other keys alone", () => {
    expect(parseRepositoryTabKey("chat:env:thread")).toBeNull();
    expect(parseRepositoryTabKey("repo-diff:a:b:c:sideways")).toBeNull();
    expect(parseRepositoryTabKey("repo-file:a:b")).toBeNull();
    expect(parseRepositoryTabKey("repo-file:a:b:folder:main:c.ts")).toBeNull();
    expect(parseRepositoryTabKey("repo-diff:a:b:c:working-tree~main")).toBeNull();
  });

  it("name a file's folder", () => {
    expect(folderOf("apps/web/src/main.tsx")).toBe("apps/web/src");
    expect(folderOf("README.md")).toBe("");
  });
});
