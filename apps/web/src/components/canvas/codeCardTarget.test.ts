import { EnvironmentId, ProjectId, RootKey, type ProjectRootCheckout } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { codeCardTarget } from "./codeCardTarget";

const environmentId = EnvironmentId.make("env");
const projectId = ProjectId.make("proj");
const root = (
  key: string,
  path: string,
  checkout: string | null,
  kind: ProjectRootCheckout["kind"] = "tracked",
): ProjectRootCheckout => ({
  key: RootKey.make(key),
  name: key,
  path,
  kind,
  state: "git",
  hostBacked: false,
  checkout,
  writable: checkout !== null,
});

// A thread in its own worktree, with a worktree of `api` too, and `docs` left out of it.
const roots = [
  root("app", "/dev/app", "/wt/task/app", "workspace"),
  root("lib", "/dev/app/packages/lib", "/wt/task/app/packages/lib"),
  root("api", "/dev/api", "/wt/task/api"),
  root("docs", "/dev/docs", null),
];
const target = (code: { root?: string; path: string }, from = roots) =>
  codeCardTarget({ environmentId, projectId, roots: from, code });

describe("codeCardTarget", () => {
  it("opens the thread's own folder's card in its file panel", () => {
    expect(target({ path: "src/a.ts" })).toEqual({ kind: "panel", path: "src/a.ts" });
    expect(target({ root: "app", path: "src/a.ts" })).toEqual({ kind: "panel", path: "src/a.ts" });
    expect(target({ root: "lib", path: "x.ts" })).toEqual({
      kind: "panel",
      path: "packages/lib/x.ts",
    });
  });

  it("opens another folder's card in that folder's file, never the thread's same path", () => {
    expect(target({ root: "api", path: "src/a.ts" })).toEqual({
      kind: "tab",
      tab: {
        kind: "file",
        environmentId,
        wikiId: "proj:api",
        checkout: { cwd: "/wt/task/api" },
        path: "src/a.ts",
      },
    });
    expect(target({ root: "docs", path: "Plan.md" })).toMatchObject({
      kind: "tab",
      tab: { checkout: { cwd: "/dev/docs" }, path: "Plan.md" },
    });
  });

  it("finds nothing for a folder the project doesn't have, or before the folders are read", () => {
    expect(target({ root: "nope", path: "a.ts" })).toBeNull();
    expect(
      codeCardTarget({ environmentId, projectId, roots: null, code: { root: "api", path: "a" } }),
    ).toBeNull();
  });
});
