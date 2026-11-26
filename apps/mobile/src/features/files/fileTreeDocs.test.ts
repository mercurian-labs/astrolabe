import type { ProjectRootCheckout } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { docsTreeEntries, projectDocumentParams } from "./fileTreeDocs";

describe("docsTreeEntries", () => {
  it("keeps the documents, the files they link and the folders holding them", () => {
    expect(docsTreeEntries(["docs/Plan.md", "docs/img/a.png", "Board.canvas"], null)).toEqual([
      { path: "docs", kind: "directory" },
      { path: "docs/img", kind: "directory" },
      { path: "docs/Plan.md", kind: "file" },
      { path: "docs/img/a.png", kind: "file" },
      { path: "Board.canvas", kind: "file" },
    ]);
  });

  it("keeps the open file, so the filter never hides it", () => {
    expect(docsTreeEntries(["Plan.md"], "src/main.ts")).toEqual([
      { path: "src", kind: "directory" },
      { path: "Plan.md", kind: "file" },
      { path: "src/main.ts", kind: "file" },
    ]);
    expect(docsTreeEntries([], null)).toEqual([]);
  });
});

describe("projectDocumentParams", () => {
  const root = (key: string, path: string, checkout: string | null = path): ProjectRootCheckout =>
    ({
      key,
      name: key,
      path,
      kind: "tracked",
      state: "git",
      hostBacked: true,
      checkout,
      writable: true,
    }) as ProjectRootCheckout;
  const roots = [root("app", "/w/app"), root("api", "/w/app/api", "/wt/api")];

  it("opens a document in the deepest root, from its own folder", () => {
    expect(
      projectDocumentParams({
        environmentId: "e",
        projectId: "p",
        roots,
        absolutePath: "/w/app/api/docs/Plan.md",
      }),
    ).toEqual({ environmentId: "e", projectId: "p", rootKey: "api", name: "docs/Plan.md" });
  });

  it("names the checkout it was opened in when that isn't the root's own folder", () => {
    expect(
      projectDocumentParams({
        environmentId: "e",
        projectId: "p",
        roots,
        absolutePath: "/wt/api/Board.canvas",
      }),
    ).toEqual({
      environmentId: "e",
      projectId: "p",
      rootKey: "api",
      name: "Board.canvas",
      checkout: "/wt/api",
    });
  });

  it("leaves code and files outside every root to the file screen", () => {
    expect(
      projectDocumentParams({
        environmentId: "e",
        projectId: "p",
        roots,
        absolutePath: "/w/app/a.ts",
      }),
    ).toBeNull();
    expect(
      projectDocumentParams({
        environmentId: "e",
        projectId: "p",
        roots,
        absolutePath: "/x/Plan.md",
      }),
    ).toBeNull();
  });
});
