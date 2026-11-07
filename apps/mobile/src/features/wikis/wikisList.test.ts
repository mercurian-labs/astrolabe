import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { wikiListEntries, wikiScopeKey } from "@t3tools/client-runtime/wikiList";
import type {
  EnvironmentId,
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
  wikiFolderKey,
  resolveWikiScope,
  wikiChangeFooter,
  wikiDocumentFooter,
  wikiScopeChoices,
} from "./wikisList";

const local = "env-local" as EnvironmentId;
const remote = "env-remote" as EnvironmentId;

const wiki = (id: string, name: string): WikiSummary =>
  ({ wikiId: id as WikiId, name, root: `/w/${id}`, projectIds: [] }) as unknown as WikiSummary;

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
    files: [...new Set(amendments.flatMap((amendment) => amendment.files))],
  }) as unknown as WikiChangeRequest;

const overviews: WikiOverview[] = [
  {
    environmentId: local,
    wiki: wiki("a", "Almagest"),
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

describe("the Wikis list", () => {
  it("lists the documents under a row counting the open changes", () => {
    const items = buildWikiListItems(wikiListEntries(overviews, null));
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

  it("puts a wiki's draft first, and lists it apart in Change requests", () => {
    const draft = {
      ...overviews[0]!.changeRequests![0]!,
      changeRequestId: "cr-draft",
      title: "Edit Old",
      draft: true,
    } as WikiChangeRequest;
    const entries = wikiListEntries(
      [{ ...overviews[0]!, changeRequests: [...overviews[0]!.changeRequests!, draft] }],
      null,
    );
    expect(buildWikiListItems(entries)[0]).toMatchObject({ type: "draft-link" });
    expect(
      buildWikiChangeItems(entries, { settledExpanded: false }).flatMap((item) =>
        item.type === "section" ? [item.label] : [],
      ),
    ).toEqual(["Your drafts · 1", "Wiki changes · 1"]);
  });

  it("lists a canvas as a document", () => {
    const withCanvas: WikiOverview = {
      ...overviews[0]!,
      index: {
        ...index([]),
        canvases: [{ file: "Board.canvas", outgoing: 0, incoming: 0 }],
      } as unknown as WikiIndexResult,
    };
    const documents = buildWikiListItems(wikiListEntries([withCanvas], null)).filter(
      (item) => item.type === "document",
    );
    expect(documents.map((item) => item.entry.title)).toEqual(["Board"]);
  });

  it("leaves out the link when no change is open", () => {
    const scope = wikiScopeKey(remote, "b" as WikiId);
    const items = buildWikiListItems(wikiListEntries(overviews, scope));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "document" });
  });
});

describe("the Wikis tree", () => {
  const tree = (expanded: ReadonlySet<string>) => {
    const entries = wikiListEntries(
      [
        {
          ...overviews[0]!,
          index: {
            ...overviews[0]!.index!,
            notes: ["a/deep/Plan.md", "a/One.md", "Top.md"].map((file) => ({
              ...overviews[0]!.index!.notes[0]!,
              file,
              name: file.replace(/\.md$/, ""),
            })),
          },
        },
      ],
      null,
    );
    return buildWikiListItems(entries, expanded).flatMap((item) =>
      item.type === "tree" ? [item.row] : [],
    );
  };

  it("lists folders first, folded until opened", () => {
    expect(tree(new Set()).map((row) => row.item.node.path)).toEqual(["a", "Top.md"]);
    const opened = tree(new Set()).find((row) => row.item.node.path === "a")!;
    const open = tree(new Set([wikiFolderKey(opened.wiki, "a")]));
    expect(open.map((row) => [row.item.node.path, row.item.depth])).toEqual([
      ["a", 0],
      ["a/deep", 1],
      ["a/One.md", 1],
      ["Top.md", 0],
    ]);
    expect(open[0]?.entry).toBeNull();
    expect(open[2]?.entry?.file).toBe("a/One.md");
  });

  it("names each wiki above its tree only when several show", () => {
    const headers = (shown: WikiOverview[]) =>
      buildWikiListItems(wikiListEntries(shown, null), new Set()).flatMap((item) =>
        item.type === "section" ? [item.label] : [],
      );
    expect(headers(overviews)).toEqual(["Almagest", "Notes"]);
    expect(headers(overviews.slice(0, 1))).toEqual([]);
  });
});

describe("the Changes tab's wiki group", () => {
  it("lists the open changes under a label, then the merged and closed shelf", () => {
    const items = buildWikiChangeItems(wikiListEntries(overviews, null), {
      settledExpanded: false,
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
    });
    const last = items.at(-1);
    expect(last?.type === "change" && last.entry.changeRequest.title).toBe("Trim the roadmap");
    expect(
      buildWikiChangeItems(wikiListEntries(overviews, wikiScopeKey(remote, "b" as WikiId)), {
        settledExpanded: false,
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
    expect(wikiDocumentFooter({ ...byName("Inbox"), name: "Tasks.base", base: true })).toEqual({
      inChange: false,
      text: "Base",
    });
    expect(wikiDocumentFooter({ ...byName("Inbox"), name: "Board.canvas", canvas: true })).toEqual({
      inChange: false,
      text: "Canvas",
    });
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
