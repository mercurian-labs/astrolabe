import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import type { EnvironmentId, ProjectId, ProjectRootId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { composerWikiNoteItems } from "./composerWikiNoteItems";

const environmentId = "env-1" as EnvironmentId;
const projectId = "project-1" as ProjectId;

const overview = (
  rootKey: string,
  root: string,
  notes: ReadonlyArray<string>,
  owner: ProjectId = projectId,
): WikiOverview =>
  ({
    environmentId,
    wiki: {
      wikiId: `${owner}:${rootKey}` as ProjectRootId,
      name: rootKey,
      root,
      projectIds: [],
      projectId: owner,
      rootKey,
    },
    index: {
      notes: notes.map((note) => ({ name: note, file: `${note}.md`, outgoing: 0, incoming: 0 })),
    },
    changeRequests: [],
  }) as unknown as WikiOverview;

const labels = (items: ReadonlyArray<{ readonly label: string }>) =>
  items.map((item) => item.label);

describe("composerWikiNoteItems", () => {
  it("lists the project's documents across its folders, linked as files", () => {
    const items = composerWikiNoteItems({
      overviews: [
        overview("app", "/work/app", ["docs/Login flow"]),
        overview("notes", "/work/notes", ["Pricing"]),
        overview("other", "/work/other", ["Elsewhere"], "project-2" as ProjectId),
      ],
      projectId,
      cwd: "/work/app",
      query: "",
    });
    expect(items.map((item) => [item.label, item.description, item.path])).toEqual([
      ["docs/Login flow", "app", "docs/Login flow.md"],
      ["Pricing", "notes", "/work/notes/Pricing.md"],
    ]);
  });

  it("narrows by the query, names that start with it first", () => {
    const items = composerWikiNoteItems({
      overviews: [overview("app", "/work/app", ["Fix login", "Login flow", "Pricing"])],
      projectId,
      cwd: null,
      query: "login",
    });
    expect(labels(items)).toEqual(["Login flow", "Fix login"]);
    expect(items[0]?.path).toBe("/work/app/Login flow.md");
  });

  it("offers notes only, never a .base file", () => {
    const app = overview("app", "/work/app", ["Tasks"]);
    const withBase = {
      ...app,
      index: { ...app.index, bases: [{ file: "Tasks.base" }] },
    } as unknown as WikiOverview;
    const items = composerWikiNoteItems({
      overviews: [withBase],
      projectId,
      cwd: "/work/app",
      query: "tasks",
    });
    expect(labels(items)).toEqual(["Tasks"]);
  });
});
