import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { WikiNoteContextRecord } from "./composerContext.ts";
import { WikiListResult } from "./wiki.ts";

const decodeList = Schema.decodeUnknownSync(WikiListResult);
const decodeNote = Schema.decodeSync(WikiNoteContextRecord);

const projectRoot = {
  wikiId: "p1:api",
  name: "api",
  root: "/Users/someone/app/api",
  mainBranch: "main",
  openChangeRequests: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  projectId: "p1",
  rootKey: "api",
};

describe("WikiSummary", () => {
  it("reads a project root by its project and root key", () => {
    expect(decodeList({ wikis: [projectRoot] }).wikis[0]).toMatchObject({
      wikiId: "p1:api",
      projectId: "p1",
      rootKey: "api",
    });
  });

  it("reads an older server's registered wiki, dropping its mirror and links", () => {
    const { projectId: _, rootKey: __, ...rest } = projectRoot;
    const older = { ...rest, wikiId: "6ad86f0445ac", mirror: null, projectIds: ["p1"] };
    const [wiki] = decodeList({ wikis: [older] }).wikis;
    expect(wiki?.wikiId).toBe("6ad86f0445ac");
    expect(wiki).not.toHaveProperty("mirror");
    expect(wiki).not.toHaveProperty("projectIds");
  });
});

describe("WikiNoteContextRecord", () => {
  it("still reads a note saved under a registered wiki's old id", () => {
    const record = decodeNote({
      version: 1,
      contextId: "ctx-1",
      label: "Plan",
      kind: "wiki-note",
      wikiId: "6ad86f0445ac",
      wikiName: "Plans",
      name: "Plan",
    });
    expect(record.wikiId).toBe("6ad86f0445ac");
  });
});
