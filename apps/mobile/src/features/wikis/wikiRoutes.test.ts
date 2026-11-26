import { describe, expect, it } from "vite-plus/test";
import { ProjectId, projectRootId, RootKey } from "@t3tools/contracts";

import { legacyWikiRedirect, wikiDocumentLink } from "./wikiRoutes";

describe("wikiDocumentLink", () => {
  it.each([
    ["wikis/e/w/documents/a/deep/Plan.md", "wikis/e/w/documents/a%2Fdeep%2FPlan.md"],
    ["/wikis/e/w/documents/a/Plan.md?x=1/2", "/wikis/e/w/documents/a%2FPlan.md?x=1/2"],
    ["wikis/e/w/changes/c/canvases/a/B.canvas", "wikis/e/w/changes/c/canvases/a%2FB.canvas"],
    ["wikis/e/w/documents/a%2FPlan.md", "wikis/e/w/documents/a%2FPlan.md"],
    ["wikis/e/w/documents/Plan", "wikis/e/w/documents/Plan"],
    ["wikis/e/w/changes/c", "wikis/e/w/changes/c"],
    ["projects/e/p/app/documents/a/Plan.md", "projects/e/p/app/documents/a%2FPlan.md"],
    [
      "projects/e/p/app/documents/Plan.md?checkout=/w/t",
      "projects/e/p/app/documents/Plan.md?checkout=/w/t",
    ],
    ["repositories/file/a/b.ts", "repositories/file/a/b.ts"],
  ])("%s", (path, expected) => {
    expect(wikiDocumentLink(path)).toBe(expected);
  });
});

describe("legacyWikiRedirect", () => {
  const rootId = projectRootId(ProjectId.make("project-1"), RootKey.make("app"));

  it("opens a project root's document straight from its root id", () => {
    expect(
      legacyWikiRedirect({ environmentId: "e", wikiId: rootId, name: "a/Plan" }, null),
    ).toEqual({
      kind: "document",
      params: { environmentId: "e", projectId: "project-1", rootKey: "app", name: "a/Plan.md" },
    });
  });

  it("opens an old wiki's document in the root the server moved it to", () => {
    expect(
      legacyWikiRedirect(
        { environmentId: "e", wikiId: "wiki-old", name: "Board.canvas", changeRequestId: "c1" },
        rootId,
      ),
    ).toEqual({
      kind: "document",
      params: {
        environmentId: "e",
        projectId: "project-1",
        rootKey: "app",
        name: "Board.canvas",
        changeRequestId: "c1",
      },
    });
  });

  it("sends a change request to its project's Projects", () => {
    expect(
      legacyWikiRedirect({ environmentId: "e", wikiId: "wiki-old", changeRequestId: "c1" }, rootId),
    ).toEqual({ kind: "projects", projectId: "project-1" });
  });

  it("lands on Projects when the wiki can't be found", () => {
    expect(
      legacyWikiRedirect({ environmentId: "e", wikiId: "wiki-old", name: "Plan" }, null),
    ).toEqual({ kind: "projects", projectId: null });
  });
});
