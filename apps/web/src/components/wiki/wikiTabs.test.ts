import type {
  EnvironmentId,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
  WikiIndexResult,
  WikiSummary,
} from "@t3tools/contracts";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { allTabs, focusedPane, startingArrangement } from "~/panes/arrangement";
import { leaves } from "~/panes/tree";
import { openWikiTab, replaceWikiTab, showWikiTab, stepWikiTab, wikiPanes } from "./wikiPanes";
import {
  parseWikiTabKey,
  sameWikiTab,
  searchWikiSidebarItems,
  wikiScopeKey,
  wikiSidebarItems,
  wikiTabKey,
  type WikiTab,
} from "./wikiTabs";

const environmentId = "env-1" as EnvironmentId;
const wikiId = "wiki-1" as WikiId;

const note = (name: string, changeRequestId?: string): WikiTab => ({
  kind: "note",
  environmentId,
  wikiId,
  name,
  changeRequestId: changeRequestId as WikiChangeRequestId | undefined,
});

describe("wiki tab keys", () => {
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

  it("name one document whatever the case of its name, but not across change requests", () => {
    expect(sameWikiTab(note("Atlas"), note("atlas"))).toBe(true);
    expect(sameWikiTab(note("Atlas"), note("Atlas", "cr-1"))).toBe(false);
  });
});

const wiki = (id: string, name: string): WikiSummary =>
  ({ wikiId: id as WikiId, name, root: `/w/${id}`, projectId: null }) as WikiSummary;

const index = (notes: Array<{ name: string; editedAt?: string }>): WikiIndexResult =>
  ({
    notes: notes.map((entry) => ({
      name: entry.name,
      file: `${entry.name}.md`,
      outgoing: 0,
      incoming: 0,
      ...(entry.editedAt ? { editedAt: entry.editedAt } : {}),
    })),
  }) as unknown as WikiIndexResult;

const changeRequest = (
  id: string,
  status: WikiChangeRequest["status"],
  updatedAt: string,
  files: string[],
): WikiChangeRequest =>
  ({
    changeRequestId: id as WikiChangeRequestId,
    status,
    updatedAt,
    amendments: [{ files }],
  }) as unknown as WikiChangeRequest;

describe("wikiSidebarItems", () => {
  const overviews: WikiOverview[] = [
    {
      environmentId,
      wiki: wiki("a", "Almagest"),
      index: index([
        { name: "Old", editedAt: "2026-10-01T00:00:00Z" },
        { name: "New", editedAt: "2026-10-03T00:00:00Z" },
      ]),
      changeRequests: [
        changeRequest("cr-open", "open", "2026-10-04T00:00:00Z", ["Old.md"]),
        changeRequest("cr-merged", "merged", "2026-10-05T00:00:00Z", ["New.md"]),
      ],
    },
    {
      environmentId,
      wiki: wiki("b", "Notes"),
      index: index([{ name: "Middle", editedAt: "2026-10-02T00:00:00Z" }]),
      changeRequests: null,
    },
  ];

  it("lists every wiki's documents newest first, with open change requests apart from settled ones", () => {
    const { changes, documents, settled } = wikiSidebarItems(overviews, null);
    expect(documents.map((document) => document.name)).toEqual(["New", "Middle", "Old"]);
    expect(changes.map((change) => change.changeRequest.changeRequestId)).toEqual(["cr-open"]);
    expect(settled.map((change) => change.changeRequest.changeRequestId)).toEqual(["cr-merged"]);
    expect(documents.find((document) => document.name === "Old")?.changes).toHaveLength(1);
    expect(documents.find((document) => document.name === "New")?.changes).toHaveLength(0);
  });

  it("keeps to the filtered wiki", () => {
    const { changes, documents } = wikiSidebarItems(
      overviews,
      wikiScopeKey(environmentId, "b" as WikiId),
    );
    expect(documents.map((document) => document.name)).toEqual(["Middle"]);
    expect(changes).toEqual([]);
  });

  it("searches documents by name and change requests by title, in the lists' order", () => {
    const titled: WikiOverview[] = [
      {
        ...overviews[0]!,
        changeRequests: [
          { ...changeRequest("cr-open", "open", "2026-10-04T00:00:00Z", []), title: "Older notes" },
          { ...changeRequest("cr-merged", "merged", "2026-10-05T00:00:00Z", []), title: "Tidy" },
        ],
      },
      overviews[1]!,
    ];
    const lists = wikiSidebarItems(titled, null);
    const found = (query: string) =>
      searchWikiSidebarItems(lists, query).map((entry) =>
        entry.kind === "document" ? entry.item.name : entry.item.changeRequest.title,
      );
    expect(found(" OLD ")).toEqual(["Older notes", "Old"]);
    expect(found("d")).toEqual(["Older notes", "Middle", "Old", "Tidy"]);
    expect(found("   ")).toEqual([]);
  });
});

describe("opening documents", () => {
  beforeEach(() => {
    wikiPanes.update(() => startingArrangement());
  });
  const arrangement = () => wikiPanes.getSnapshot()!.arrangement;

  it("opens into the empty tab, and brings an open document forward rather than twice", () => {
    openWikiTab(note("Alpha"));
    openWikiTab(note("Beta"));
    openWikiTab(note("alpha"));
    expect(allTabs(arrangement())).toEqual([wikiTabKey(note("Alpha")), wikiTabKey(note("Beta"))]);
    expect(focusedPane(arrangement()).active).toBe(wikiTabKey(note("Alpha")));
  });

  it("opens beside in a new pane", () => {
    openWikiTab(note("Alpha"));
    openWikiTab(note("Beta"), "beside");
    expect(leaves(arrangement().root).map((pane) => pane.tabs)).toEqual([
      [wikiTabKey(note("Alpha"))],
      [wikiTabKey(note("Beta"))],
    ]);
  });

  it("follows a link in place, or to the tab already showing it", () => {
    openWikiTab(note("Alpha"));
    openWikiTab(note("Gamma"));
    replaceWikiTab(wikiTabKey(note("Alpha")), note("Beta"));
    expect(allTabs(arrangement())).toEqual([wikiTabKey(note("Beta")), wikiTabKey(note("Gamma"))]);
    replaceWikiTab(wikiTabKey(note("Beta")), note("Gamma"));
    expect(allTabs(arrangement())).toHaveLength(2);
    expect(focusedPane(arrangement()).active).toBe(wikiTabKey(note("Gamma")));
  });
});

describe("a wiki tab's history", () => {
  beforeEach(() => {
    wikiPanes.update(() => startingArrangement());
  });
  const arrangement = () => wikiPanes.getSnapshot()!.arrangement;
  const front = () => focusedPane(arrangement()).active;
  const key = (name: string) => wikiTabKey(note(name));

  it("shows a clicked document in the tab in front, which steps back and forward", () => {
    showWikiTab(note("Alpha"));
    showWikiTab(note("Beta"));
    showWikiTab(note("Gamma"));
    expect(allTabs(arrangement())).toEqual([key("Gamma")]);
    stepWikiTab("back");
    expect(allTabs(arrangement())).toEqual([key("Beta")]);
    stepWikiTab("back");
    expect(front()).toBe(key("Alpha"));
    // Nothing further back: the tab stays.
    stepWikiTab("back");
    expect(front()).toBe(key("Alpha"));
    stepWikiTab("forward");
    stepWikiTab("forward");
    expect(front()).toBe(key("Gamma"));
  });

  it("clears the way forward when it shows something new, and links join the history", () => {
    showWikiTab(note("Alpha"));
    showWikiTab(note("Beta"));
    stepWikiTab("back");
    replaceWikiTab(key("Alpha"), note("Delta"));
    stepWikiTab("forward");
    expect(front()).toBe(key("Delta"));
    stepWikiTab("back");
    expect(front()).toBe(key("Alpha"));
  });

  it("brings a document open in another tab forward, rather than showing it twice", () => {
    showWikiTab(note("Alpha"));
    openWikiTab(note("Beta"));
    expect(allTabs(arrangement())).toEqual([key("Alpha"), key("Beta")]);
    showWikiTab(note("Alpha"));
    expect(allTabs(arrangement())).toEqual([key("Alpha"), key("Beta")]);
    expect(front()).toBe(key("Alpha"));
  });

  it("keeps the history of a note saved into a change request, and forgets a closed tab's", () => {
    showWikiTab(note("Alpha"));
    showWikiTab(note("Beta"));
    replaceWikiTab(key("Beta"), note("Beta", "cr-1"), { rekey: true });
    stepWikiTab("back");
    expect(front()).toBe(key("Alpha"));
    openWikiTab(note("Gamma"));
    wikiPanes.update(() => startingArrangement());
    showWikiTab(note("Alpha"));
    stepWikiTab("back");
    expect(allTabs(arrangement())).toEqual([key("Alpha")]);
  });
});
