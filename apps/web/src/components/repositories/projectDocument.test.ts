import {
  EnvironmentId,
  ProjectId,
  RootKey,
  ProjectRootId,
  type ProjectRootCheckout,
  type WikiIndexResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  locateProjectDocument,
  opensAsProjectDocument,
  projectBacklinks,
  projectDocumentOwner,
  projectDocumentTab,
} from "./projectDocument";

const environmentId = EnvironmentId.make("env");
const projectId = ProjectId.make("proj");

const root = (
  key: string,
  path: string,
  extra: Partial<ProjectRootCheckout> = {},
): ProjectRootCheckout => ({
  key: RootKey.make(key),
  name: key,
  path,
  kind: "tracked",
  state: "git",
  hostBacked: true,
  checkout: path,
  writable: true,
  ...extra,
});

const roots = [
  root("app", "/dev/app", { kind: "workspace" }),
  root("lib", "/dev/app/packages/lib"),
  root("docs", "/dev/docs", { hostBacked: false }),
  root("gone", "/dev/gone", { state: "missing" }),
];

describe("projectDocumentOwner", () => {
  it("reads a project's tab as its own folder's and a root id as that root's", () => {
    expect(projectDocumentOwner({ projectId })).toEqual({ projectId, rootKey: null });
    expect(projectDocumentOwner({ wikiId: ProjectRootId.make("proj:docs") })).toEqual({
      projectId,
      rootKey: "docs",
    });
    expect(projectDocumentOwner({ wikiId: ProjectRootId.make("almagest") })).toBeNull();
  });
});

describe("opensAsProjectDocument", () => {
  it("takes notes, canvases and bases; a skill map and code stay files", () => {
    expect(["a/Plan.md", "Board.canvas", "Open.base"].map(opensAsProjectDocument)).toEqual([
      true,
      true,
      true,
    ]);
    expect(["a.skillmap.md", "src/a.ts"].map(opensAsProjectDocument)).toEqual([false, false]);
  });
});

describe("locateProjectDocument", () => {
  it("gives a doc in a nested repository to that repository", () => {
    expect(locateProjectDocument(roots, null, "/dev/app", "packages/lib/notes/Plan.md")).toEqual({
      root: roots[1],
      file: "notes/Plan.md",
      checkout: "/dev/app/packages/lib",
      prefix: "packages/lib",
    });
    expect(locateProjectDocument(roots, null, "/dev/app/", "README.md")).toMatchObject({
      root: roots[0],
      file: "README.md",
      checkout: "/dev/app",
      prefix: "",
    });
  });

  it("reads a worktree as its own root's, and a tracked folder's tab as that folder's", () => {
    expect(locateProjectDocument(roots, null, "/wt/app-2", "packages/lib/Plan.md")).toEqual({
      root: roots[0],
      file: "packages/lib/Plan.md",
      checkout: "/wt/app-2",
      prefix: "",
    });
    expect(locateProjectDocument(roots, RootKey.make("docs"), "/dev/docs", "a/B.md")).toEqual({
      root: roots[2],
      file: "a/B.md",
      checkout: "/dev/docs",
      prefix: "",
    });
    expect(locateProjectDocument(roots, RootKey.make("nope"), "/dev/x", "B.md")).toBeNull();
  });
});

describe("projectDocumentTab", () => {
  const current: Parameters<typeof projectDocumentTab>[0]["current"] = {
    owner: { projectId },
    checkout: { branch: "feature" },
    located: { root: roots[0]!, file: "Plan.md", checkout: "/wt/app-2", prefix: "" },
  };
  const tabFor = (target: { root: string; file: string }, from = current) =>
    projectDocumentTab({ environmentId, projectId, roots, target, current: from });

  it("opens the current root's document in the tab's own checkout", () => {
    expect(tabFor({ root: "app", file: "a/Spec.md" })).toEqual({
      kind: "file",
      environmentId,
      projectId,
      checkout: { branch: "feature" },
      path: "a/Spec.md",
    });
    const nested = {
      owner: { projectId },
      checkout: { cwd: "/dev/app" },
      located: {
        root: roots[1]!,
        file: "Plan.md",
        checkout: "/dev/app/packages/lib",
        prefix: "packages/lib",
      },
    };
    expect(tabFor({ root: "lib", file: "x/Y.md" }, nested)?.path).toBe("packages/lib/x/Y.md");
  });

  it("opens another root's document in its own live checkout", () => {
    expect(tabFor({ root: "lib", file: "Y.md" })).toEqual({
      kind: "file",
      environmentId,
      projectId,
      checkout: { cwd: "/dev/app" },
      path: "packages/lib/Y.md",
    });
    expect(tabFor({ root: "docs", file: "Y.md" })).toEqual({
      kind: "file",
      environmentId,
      wikiId: "proj:docs",
      checkout: { cwd: "/dev/docs" },
      path: "Y.md",
    });
    expect(tabFor({ root: "gone", file: "Y.md" })).toBeNull();
  });
});

describe("projectBacklinks", () => {
  const index = (
    notes: ReadonlyArray<string>,
    links: ReadonlyArray<{ from: string; to: string }>,
  ) =>
    ({
      notes: notes.map((file) => ({ name: file.replace(/\.md$/, ""), file })),
      canvases: [],
      bases: [],
      maps: [],
      links,
    }) as unknown as WikiIndexResult;

  it("finds links to a document from its own root and from every other", () => {
    const indexes = new Map([
      [
        "app",
        index(
          ["Plan.md", "a/Notes.md"],
          [
            { from: "a/Notes", to: "Plan" },
            { from: "Plan", to: "Plan" },
          ],
        ),
      ],
      [
        "docs",
        index(
          ["Guide.md", "Other.md", "Plan.md"],
          [
            { from: "Guide", to: "app:Plan" },
            { from: "Other", to: "Plan" },
          ],
        ),
      ],
      ["lib", index(["Read.md"], [{ from: "Read", to: "Plan" }])],
    ]);
    expect(projectBacklinks(indexes, { root: "app", file: "Plan.md" })).toEqual([
      { root: "app", file: "a/Notes.md" },
      { root: "docs", file: "Guide.md" },
    ]);
    expect(projectBacklinks(indexes, { root: "docs", file: "Plan.md" })).toEqual([
      { root: "docs", file: "Other.md" },
    ]);
  });
});
