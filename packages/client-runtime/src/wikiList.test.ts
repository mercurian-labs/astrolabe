import type {
  EnvironmentId,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
  WikiIndexResult,
  WikiSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WikiOverview } from "./state/wiki.ts";
import { searchWikiListEntries, wikiListEntries, wikiScopeKey } from "./wikiList.ts";

const environmentId = "env-1" as EnvironmentId;

const wiki = (id: string, name: string): WikiSummary =>
  ({
    wikiId: id as WikiId,
    name,
    root: `/w/${id}`,
    projectIds: [] as WikiSummary["projectIds"],
  }) as WikiSummary;

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
  title: string,
  status: WikiChangeRequest["status"],
  updatedAt: string,
  files: string[],
): WikiChangeRequest =>
  ({
    changeRequestId: id as WikiChangeRequestId,
    title,
    status,
    updatedAt,
    amendments: [{ files }],
  }) as unknown as WikiChangeRequest;

const overviews: WikiOverview[] = [
  {
    environmentId,
    wiki: wiki("a", "Almagest"),
    index: index([
      { name: "Old", editedAt: "2026-10-01T00:00:00Z" },
      { name: "New", editedAt: "2026-10-03T00:00:00Z" },
    ]),
    changeRequests: [
      changeRequest("cr-open", "Grow Old", "open", "2026-10-04T00:00:00Z", ["Old.md"]),
      changeRequest("cr-merged", "Trim New", "merged", "2026-10-05T00:00:00Z", ["New.md"]),
    ],
  },
  {
    environmentId,
    wiki: wiki("b", "Notes"),
    index: index([{ name: "Middle", editedAt: "2026-10-02T00:00:00Z" }]),
    changeRequests: null,
  },
];

describe("wikiListEntries", () => {
  it("lists every wiki's documents newest first, open changes apart from settled ones", () => {
    const { changes, documents, settled } = wikiListEntries(overviews, null);
    expect(documents.map((document) => document.name)).toEqual(["New", "Middle", "Old"]);
    expect(changes.map((change) => change.changeRequest.changeRequestId)).toEqual(["cr-open"]);
    expect(settled.map((change) => change.changeRequest.changeRequestId)).toEqual(["cr-merged"]);
    expect(documents.find((document) => document.name === "Old")?.changes).toHaveLength(1);
    expect(documents.find((document) => document.name === "New")?.changes).toHaveLength(0);
  });

  it("keeps to the filtered wiki", () => {
    const { changes, documents } = wikiListEntries(
      overviews,
      wikiScopeKey(environmentId, "b" as WikiId),
    );
    expect(documents.map((document) => document.name)).toEqual(["Middle"]);
    expect(changes).toEqual([]);
  });

  it("searches names and titles as the wiki compares note names", () => {
    const found = searchWikiListEntries(wikiListEntries(overviews, null), "  OLD ");
    expect(found.documents.map((document) => document.name)).toEqual(["Old"]);
    expect(found.changes.map((change) => change.changeRequest.title)).toEqual(["Grow Old"]);
    expect(found.settled).toEqual([]);
  });
});
