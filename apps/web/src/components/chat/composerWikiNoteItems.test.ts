import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import type { EnvironmentId, ProjectId, WikiId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { composerWikiNoteItems } from "./composerWikiNoteItems";

const environmentId = "env-1" as EnvironmentId;
const projectId = "project-1" as ProjectId;
const project = { id: projectId, title: "Checkout" };

const overview = (
  wikiId: string,
  name: string,
  notes: ReadonlyArray<string>,
  projectIds: ReadonlyArray<ProjectId> = [],
): WikiOverview =>
  ({
    environmentId,
    wiki: { wikiId: wikiId as WikiId, name, projectIds },
    index: {
      notes: notes.map((note) => ({ name: note, file: `${note}.md`, outgoing: 0, incoming: 0 })),
    },
    changeRequests: [],
  }) as unknown as WikiOverview;

const labels = (items: ReadonlyArray<{ readonly label: string }>) =>
  items.map((item) => item.label);

describe("composerWikiNoteItems", () => {
  it("lists linked wikis' notes first, then other wikis', each naming its wiki", () => {
    const items = composerWikiNoteItems({
      overviews: [
        overview("research", "Research", ["Pricing"]),
        overview("plans", "Plans", ["Login flow"], [projectId]),
      ],
      project,
      query: "",
      canLink: true,
    });
    expect(items.map((item) => [item.label, item.description])).toEqual([
      ["Login flow", "Plans"],
      ["Pricing", "Research"],
    ]);
  });

  it("narrows by the query, names that start with it first within each rank", () => {
    const items = composerWikiNoteItems({
      overviews: [
        overview("research", "Research", ["Login research", "Old login"]),
        overview("plans", "Plans", ["Fix login", "Login flow", "Pricing"], [projectId]),
      ],
      project,
      query: "login",
      canLink: true,
    });
    expect(labels(items)).toEqual(["Login flow", "Fix login", "Login research", "Old login"]);
  });

  it("offers to link each wiki while the project has none linked and nothing is typed", () => {
    const overviews = [
      overview("plans", "Plans", ["Login flow"]),
      overview("research", "Research", []),
    ];
    const items = composerWikiNoteItems({ overviews, project, query: "", canLink: true });
    expect(items.map((item) => [item.type, item.label])).toEqual([
      ["wiki-link", "Link Plans to Checkout"],
      ["wiki-link", "Link Research to Checkout"],
      ["wiki-note", "Login flow"],
    ]);
    expect(
      composerWikiNoteItems({ overviews, project, query: "lo", canLink: true }).map(
        (item) => item.type,
      ),
    ).toEqual(["wiki-note"]);
    expect(
      composerWikiNoteItems({ overviews, project, query: "", canLink: false }).map(
        (item) => item.type,
      ),
    ).toEqual(["wiki-note"]);
    expect(
      composerWikiNoteItems({ overviews, project: null, query: "", canLink: true }).map(
        (item) => item.type,
      ),
    ).toEqual(["wiki-note"]);
  });

  it("stops offering links once one wiki is linked", () => {
    const items = composerWikiNoteItems({
      overviews: [
        overview("plans", "Plans", [], [projectId]),
        overview("research", "Research", ["Pricing"]),
      ],
      project,
      query: "",
      canLink: true,
    });
    expect(items.map((item) => item.type)).toEqual(["wiki-note"]);
  });

  it("offers notes only, never a wiki's .base files", () => {
    const plans = overview("plans", "Plans", ["Tasks"], [projectId]);
    const withBase = {
      ...plans,
      index: { ...plans.index, bases: [{ file: "Tasks.base" }] },
    } as unknown as WikiOverview;
    const items = composerWikiNoteItems({
      overviews: [withBase],
      project,
      query: "tasks",
      canLink: true,
    });
    expect(labels(items)).toEqual(["Tasks"]);
  });
});
