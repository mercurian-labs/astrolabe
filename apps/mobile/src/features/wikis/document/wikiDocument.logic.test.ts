import type { WikiChangeRequest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isSkillMapFile,
  isWikiBaseFile,
  wikiBaseTitle,
  wikiDocumentAuthor,
  wikiDocumentSubtitle,
} from "./wikiDocument.logic";

const amendment = (actor: string, commit: string, at: string, files: string[]) =>
  ({ actor, commit, at, files }) as unknown as WikiChangeRequest["amendments"][number];

describe("wikiDocumentSubtitle", () => {
  it("names the wiki and where the document is read from", () => {
    expect(
      wikiDocumentSubtitle({
        wikiName: "almagest",
        changeRequest: null,
        readsChangeRequest: false,
        agentWorking: false,
      }),
    ).toBe("almagest · Main");
    expect(
      wikiDocumentSubtitle({
        wikiName: "almagest",
        changeRequest: { title: "Grow Atlas" },
        readsChangeRequest: true,
        agentWorking: true,
      }),
    ).toBe("almagest · In “Grow Atlas” · agent working");
    expect(
      wikiDocumentSubtitle({
        wikiName: null,
        changeRequest: null,
        readsChangeRequest: true,
        agentWorking: false,
      }),
    ).toBe("In a change request");
  });
});

describe("wikiDocumentAuthor", () => {
  const changeRequest = {
    amendments: [
      amendment("claude", "c1", "2026-10-01T00:00:00Z", ["Atlas.md"]),
      amendment("You", "c2", "2026-10-02T00:00:00Z", ["Atlas.md"]),
      amendment("claude", "c3", "2026-10-03T00:00:00Z", ["Other.md"]),
    ],
  };

  it("attributes the newest amendment of the file, within the running turn", () => {
    expect(wikiDocumentAuthor({ changeRequest, file: "Atlas.md", runId: "r1" })).toMatchObject({
      name: "You, elsewhere",
      turnId: "run:r1",
    });
    expect(wikiDocumentAuthor({ changeRequest, file: "Other.md", runId: null })).toMatchObject({
      name: "claude",
      turnId: "amendment:c3",
    });
  });

  it("falls back to an unnamed agent, coloured the same each time", () => {
    const first = wikiDocumentAuthor({ changeRequest: undefined, file: "A.md", runId: null });
    const second = wikiDocumentAuthor({ changeRequest: undefined, file: "B.md", runId: null });
    expect(first.name).toBe("Agent");
    expect(first.color).toBe(second.color);
  });
});

describe("isSkillMapFile", () => {
  it("tells skill maps from notes", () => {
    expect(isSkillMapFile("Product.skillmap.md")).toBe(true);
    expect(isSkillMapFile("Atlas.md")).toBe(false);
  });
});

describe("wiki base files", () => {
  it("opens a .base file as its view, titled without the extension", () => {
    expect(isWikiBaseFile("Projects.base")).toBe(true);
    expect(isWikiBaseFile("Projects")).toBe(false);
    expect(isWikiBaseFile("Database notes")).toBe(false);
    expect(wikiBaseTitle("Projects.base")).toBe("Projects");
    expect(wikiBaseTitle("plans/Open work.base")).toBe("plans/Open work");
  });
});
