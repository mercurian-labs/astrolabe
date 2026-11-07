import { describe, expect, it } from "vite-plus/test";

import { finderGroups } from "./WikiFinder";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";

const overview = (wikiId: string, notes: ReadonlyArray<string>) =>
  ({
    environmentId: "environment",
    wiki: { wikiId, name: wikiId },
    index: {
      notes: notes.map((name) => ({ name, file: `${name}.md`, outgoing: 0, incoming: 0 })),
    },
  }) as unknown as WikiOverview;

const newDocumentTitles = (overviews: ReadonlyArray<WikiOverview>, scope: string, query: string) =>
  finderGroups({
    overviews,
    scope,
    mode: "new",
    query,
    onPick: () => {},
    showHidden: false,
    placement: { attachments: "root", attachmentFolder: "", newNotes: "root", newNoteFolder: "" },
    from: null,
  })
    .find((group) => group.value === "write")
    ?.items.map((item) => item.title);

describe("finderGroups", () => {
  it("offers a name another wiki holds, and not one this wiki holds", () => {
    const overviews = [overview("mine", ["Held here"]), overview("other", ["Issue"])];
    const scope = "environment:mine";
    expect(newDocumentTitles(overviews, scope, "Issue")).toEqual([
      "Write “Issue”",
      "New canvas “Issue”",
    ]);
    expect(newDocumentTitles(overviews, scope, "Held here")).toEqual(["New canvas “Held here”"]);
  });
});
