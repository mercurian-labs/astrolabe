import type {
  EnvironmentId,
  ProjectId,
  ProjectRootCheckout,
  RootKey,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { legacyWikiRoot, projectRootFileTab } from "./projectRootFileTab";
import { parseWikiTabKey, wikiTabKey, type WikiTab } from "./wikiTabs";

const environmentId = "env-1" as EnvironmentId;
const wikiId = "wiki-1" as WikiId;

const note = (name: string, changeRequestId?: string): WikiTab => ({
  kind: "note",
  environmentId,
  wikiId,
  file: `${name}.md`,
  changeRequestId: changeRequestId as WikiChangeRequestId | undefined,
});

describe("old wiki tab keys", () => {
  it("round-trip names holding the separator and other punctuation", () => {
    const tabs: WikiTab[] = [
      note("Graph: a theory / of links?"),
      note("Atlas", "cr-1"),
      {
        kind: "change-request",
        environmentId,
        wikiId,
        changeRequestId: "cr-2" as WikiChangeRequestId,
      },
    ];
    for (const tab of tabs) expect(parseWikiTabKey(wikiTabKey(tab))).toEqual(tab);
  });

  it("are not read from empty tabs or malformed keys", () => {
    expect(parseWikiTabKey("empty/0")).toBeNull();
    expect(parseWikiTabKey("wiki-note:env:wiki")).toBeNull();
    expect(parseWikiTabKey("wiki-note:env:wiki::%E0%A4%A")).toBeNull();
  });

  it("reads a layout saved with a note's bare name as that note's file", () => {
    expect(parseWikiTabKey(`wiki-note:${environmentId}:${wikiId}::Plan`)).toEqual(note("Plan"));
    const board = `wiki-note:${environmentId}:${wikiId}::Board.canvas`;
    expect(parseWikiTabKey(board)).toMatchObject({ file: "Board.canvas" });
  });
});

const projectId = "project-1" as ProjectId;
const root = (
  key: string,
  path: string,
  kind: "workspace" | "tracked" = "tracked",
  state: ProjectRootCheckout["state"] = "git",
): ProjectRootCheckout =>
  ({
    key: key as RootKey,
    name: key,
    path,
    kind,
    state,
    hostBacked: false,
    checkout: path,
    writable: true,
  }) as ProjectRootCheckout;
const roots = [
  root("app", "/work/app", "workspace"),
  root("docs", "/work/app/docs"),
  root("notes", "/work/notes"),
  root("gone", "/work/gone", "tracked", "missing"),
];
const tabFor = (rootKey: string, file: string) =>
  projectRootFileTab({ environmentId, projectId, roots, rootKey: rootKey as RootKey, file });

describe("where an old wiki's document opens in Projects", () => {
  it("reads a root id as it is, else the root the server answered with", () => {
    const rootId = "project-1:notes";
    expect(legacyWikiRoot(rootId, null)).toEqual({ projectId, rootKey: "notes" });
    expect(legacyWikiRoot("almagest", null)).toBeNull();
    expect(legacyWikiRoot("almagest", rootId)).toEqual({ projectId, rootKey: "notes" });
  });

  it("opens a root inside the project's folder as the project's file", () => {
    expect(tabFor("app", "Plan.md")).toEqual({
      kind: "file",
      environmentId,
      projectId,
      checkout: { cwd: "/work/app" },
      path: "Plan.md",
    });
    expect(tabFor("docs", "a/Plan.md")).toMatchObject({ projectId, path: "docs/a/Plan.md" });
  });

  it("opens any other root's file as that root's, and nothing for a root gone or missing", () => {
    expect(tabFor("notes", "Plan.md")).toEqual({
      kind: "file",
      environmentId,
      wikiId: "project-1:notes",
      checkout: { cwd: "/work/notes" },
      path: "Plan.md",
    });
    expect(tabFor("gone", "Plan.md")).toBeNull();
    expect(tabFor("elsewhere", "Plan.md")).toBeNull();
  });
});
