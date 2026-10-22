import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { wikiListEntries, wikiScopeKey } from "@t3tools/client-runtime/wikiList";
import type {
  EnvironmentId,
  ProjectId,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
  WikiIndexResult,
  WikiSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildWikiChangeItems,
  buildWikiListItems,
  resolveWikiScope,
  wikiChangeFooter,
  wikiDocumentFooter,
  wikiScopeChoices,
} from "./wikisList";

const local = "env-local" as EnvironmentId;
const remote = "env-remote" as EnvironmentId;

const wiki = (id: string, name: string, projectId: string | null = null): WikiSummary =>
  ({
    wikiId: id as WikiId,
    name,
    root: `/w/${id}`,
    projectId: projectId as ProjectId | null,
  }) as WikiSummary;

const index = (
  notes: Array<{ name: string; editedAt: string; outgoing?: number; incoming?: number }>,
) =>
  ({
    notes: notes.map((note) => ({
      name: note.name,
      file: `${note.name}.md`,
      outgoing: note.outgoing ?? 0,
      incoming: note.incoming ?? 0,
      editedAt: note.editedAt,
    })),
  }) as unknown as WikiIndexResult;

const changeRequest = (
  id: string,
  title: string,
  status: WikiChangeRequest["status"],
  updatedAt: string,
  amendments: Array<{ actor: string; files: string[] }>,
) =>
  ({
    changeRequestId: id as WikiChangeRequestId,
    title,
    status,
    updatedAt,
    amendments,
  }) as unknown as WikiChangeRequest;

const overviews: WikiOverview[] = [
  {
    environmentId: local,
    wiki: wiki("a", "Almagest", "project-a"),
    index: index([
      { name: "Roadmap", editedAt: "2026-10-03T00:00:00Z", outgoing: 1 },
      { name: "Glossary", editedAt: "2026-10-01T00:00:00Z", outgoing: 3, incoming: 2 },
    ]),
    changeRequests: [
      changeRequest("cr-1", "Grow the glossary", "open", "2026-10-04T00:00:00Z", [
        { actor: "You", files: ["Glossary.md"] },
        { actor: "claude", files: ["Glossary.md", "Roadmap.md"] },
      ]),
      changeRequest("cr-2", "Trim the roadmap", "merged", "2026-10-05T00:00:00Z", [
        { actor: "codex", files: ["Roadmap.md"] },
      ]),
    ],
  },
  {
    environmentId: remote,
    wiki: wiki("b", "Notes"),
    index: index([{ name: "Inbox", editedAt: "2026-10-02T00:00:00Z" }]),
    changeRequests: [],
  },
];

const project = { id: "project-a", title: "Almagest" } as unknown as EnvironmentProject;
const projects = new Map([[`${local}:project-a`, project]]);

describe("the Wikis list", () => {
  it("lists the documents under a row counting the open changes", () => {
    const items = buildWikiListItems(wikiListEntries(overviews, null), { projects });
    expect(items.map((item) => item.type)).toEqual([
      "changes-link",
      "document",
      "document",
      "document",
    ]);
    expect(items[0]).toMatchObject({ type: "changes-link", count: 1 });
    // Hairlines run between rows only.
    expect(
      items.flatMap((item) => (item.type === "document" ? [item.showTrailingDivider] : [])),
    ).toEqual([true, true, false]);
  });

  it("leaves out the link when no change is open, and finds each wiki's project", () => {
    const scope = wikiScopeKey(remote, "b" as WikiId);
    const items = buildWikiListItems(wikiListEntries(overviews, scope), { projects });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "document", project: null });
    const almagest = buildWikiListItems(
      wikiListEntries(overviews, wikiScopeKey(local, "a" as WikiId)),
      { projects },
    ).find((item) => item.type === "document");
    expect(almagest?.type === "document" && almagest.project).toBe(project);
  });
});

describe("the Changes tab's wiki group", () => {
  it("lists the open changes under a label, then the merged and closed shelf", () => {
    const items = buildWikiChangeItems(wikiListEntries(overviews, null), {
      settledExpanded: false,
      projects,
    });
    expect(items.map((item) => (item.type === "section" ? item.label : item.type))).toEqual([
      "Wiki changes · 1",
      "change",
      "settled-shelf",
    ]);
    expect(items.at(-1)).toMatchObject({ type: "settled-shelf", count: 1, expanded: false });
  });

  it("opens the shelf onto the merged and closed, and is empty with no changes at all", () => {
    const items = buildWikiChangeItems(wikiListEntries(overviews, null), {
      settledExpanded: true,
      projects,
    });
    const last = items.at(-1);
    expect(last?.type === "change" && last.entry.changeRequest.title).toBe("Trim the roadmap");
    expect(
      buildWikiChangeItems(wikiListEntries(overviews, wikiScopeKey(remote, "b" as WikiId)), {
        settledExpanded: false,
        projects,
      }),
    ).toEqual([]);
  });
});

describe("wiki filters and footers", () => {
  it("drops a filter whose wiki is gone", () => {
    const scope = wikiScopeKey(remote, "b" as WikiId);
    expect(resolveWikiScope(overviews, scope)).toBe(scope);
    expect(resolveWikiScope(overviews.slice(0, 1), scope)).toBeNull();
    expect(resolveWikiScope(overviews, null)).toBeNull();
  });

  it("names each wiki's server in the filter only when the list reads more than one", () => {
    const one = new Map([[local, "MacBook"]]);
    const two = new Map([
      [local, "MacBook"],
      [remote, "Studio"],
    ]);
    expect(wikiScopeChoices(overviews, one).map((choice) => choice.label)).toEqual([
      "Almagest",
      "Notes",
    ]);
    expect(wikiScopeChoices(overviews, two).map((choice) => choice.label)).toEqual([
      "Almagest · MacBook",
      "Notes · Studio",
    ]);
  });

  it("words the footers as web does", () => {
    const { documents, changes, settled } = wikiListEntries(overviews, null);
    const byName = (name: string) => documents.find((document) => document.name === name)!;
    expect(wikiDocumentFooter(byName("Glossary"))).toEqual({
      inChange: true,
      text: "In “Grow the glossary”",
    });
    expect(wikiDocumentFooter(byName("Inbox")).text).toBe("0 links");
    expect(wikiDocumentFooter({ ...byName("Inbox"), links: 1, backlinks: 4 }).text).toBe(
      "1 link · linked from 4",
    );
    expect(
      wikiDocumentFooter({
        ...byName("Glossary"),
        changes: [changes[0]!.changeRequest, settled[0]!.changeRequest],
      }).text,
    ).toBe("In 2 open changes");
    expect(wikiChangeFooter(changes[0]!)).toEqual({
      summary: "2 amendments · 2 documents",
      actors: "You, claude",
    });
    expect(wikiChangeFooter(settled[0]!)).toEqual({
      summary: "Merged · 1 amendment · 1 document",
      actors: "codex",
    });
  });
});
