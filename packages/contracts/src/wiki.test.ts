import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { WikiListResult } from "./wiki.ts";

const decodeList = Schema.decodeUnknownSync(WikiListResult);
const encodeList = Schema.encodeSync(WikiListResult);

// A wiki as a server from before wikis linked to several projects sends it.
const olderWiki = (projectId: string | null) => ({
  wikiId: "w1",
  name: "Plans",
  root: "/Users/someone/plans",
  mainBranch: "main",
  projectId,
  mirror: null,
  openChangeRequests: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
});

describe("WikiSummary", () => {
  it("reads an older server's wiki, folding its one project into the linked ones", () => {
    const { wikis } = decodeList({ wikis: [olderWiki("p1"), olderWiki(null)] });
    expect(wikis.map((wiki) => wiki.projectIds)).toEqual([["p1"], []]);
    expect(wikis[0]).not.toHaveProperty("projectId");
  });

  it("reads a wiki with neither field as linked to no project", () => {
    const { projectId: _, ...bare } = olderWiki(null);
    expect(decodeList({ wikis: [bare] }).wikis[0]?.projectIds).toEqual([]);
  });

  it("prefers the linked projects when a server sends both", () => {
    const wiki = { ...olderWiki("p1"), projectIds: ["p2", "p3"] };
    expect(decodeList({ wikis: [wiki] }).wikis[0]?.projectIds).toEqual(["p2", "p3"]);
  });

  it("encodes the linked projects only", () => {
    const decoded = decodeList({ wikis: [olderWiki("p1")] });
    const { projectId: _, ...rest } = olderWiki("p1");
    expect(encodeList(decoded).wikis).toStrictEqual([{ ...rest, projectIds: ["p1"] }]);
  });
});
