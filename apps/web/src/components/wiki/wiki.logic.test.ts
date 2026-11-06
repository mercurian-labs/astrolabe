import { describe, expect, it } from "vite-plus/test";

import {
  authorColor,
  describeIndexError,
  describeWikiFailure,
  isTurnRunning,
  latestAmendmentFor,
  mapTilesFor,
  mergeBlockedReason,
  mergeConflictAdvice,
  wikiDocumentName,
  parseWikiSearch,
  summarizeMirror,
} from "./wiki.logic";

describe("parseWikiSearch", () => {
  it("keeps known fields and drops empty or unknown ones", () => {
    expect(
      parseWikiSearch({
        environmentId: "env-1",
        note: "  Graph theory ",
        changeRequest: "",
        list: "everything",
        extra: 1,
      }),
    ).toEqual({ environmentId: "env-1", note: "Graph theory" });
    expect(parseWikiSearch({ changeRequest: "cr-1" })).toEqual({ changeRequest: "cr-1" });
  });
});

describe("mergeBlockedReason", () => {
  it("allows a clean merge and names what blocks the others", () => {
    expect(
      mergeBlockedReason({
        canWrite: true,
        preview: { status: "clean", conflicts: [], errors: [], canvases: [] },
      }),
    ).toBeNull();
    expect(
      mergeBlockedReason({
        canWrite: true,
        preview: { status: "conflict", conflicts: ["A.md", "B.md"], errors: [], canvases: [] },
      }),
    ).toBe("Conflicts with main in A.md, B.md.");
    expect(
      mergeBlockedReason({
        canWrite: false,
        preview: { status: "clean", conflicts: [], errors: [], canvases: [] },
      }),
    ).toMatch(/permission/);
  });
});

describe("mergeConflictAdvice", () => {
  it("sends a canvas to its worktree, because an amendment can't write one", () => {
    expect(mergeConflictAdvice(["A.md"], "computer")).toContain("Amend");
    expect(mergeConflictAdvice([], "computer")).toContain("Amend");
    const canvas = mergeConflictAdvice(["A.md", "Board.canvas"], "computer");
    expect(canvas).toContain("worktree");
    expect(canvas).not.toContain("Amend");
    expect(mergeConflictAdvice(["Board.canvas"], "phone")).toContain("from the phone");
    expect(mergeConflictAdvice(["A.md"], "phone")).toContain("Amend");
  });
});

describe("describeIndexError", () => {
  it("says plainly when a map edge lost its prose link", () => {
    expect(
      describeIndexError({
        file: "Learning.skillmap.md",
        error: "Missing prose link: A ↔ B",
        edge: { from: "A", type: "requires", to: "B" },
      }),
    ).toMatch(/^A map edge lost its prose link: A → B/);
    expect(describeIndexError({ file: "x.skillmap.md", error: "Bad map" })).toBe(
      "x.skillmap.md: Bad map",
    );
  });
});

describe("describeWikiFailure", () => {
  it("says what the server says, which names the busy folder", () => {
    const busy =
      "Unsaved edits in this change request's worktree overlap the amendment: Beta.md. Save them to the change request or set them aside, then try again.";
    expect(describeWikiFailure({ _tag: "WikiError", reason: "checkout-busy", message: busy })).toBe(
      busy,
    );
    expect(describeWikiFailure({ _tag: "WikiError", reason: "invalid", message: "Bad name" })).toBe(
      "Bad name",
    );
  });
});

describe("summarizeMirror", () => {
  const ago = () => "now";
  const mirror = {
    url: "git@example.com:wiki.git",
    lastPushedAt: "2026-10-02T00:00:00.000Z",
    lastPushedCommit: "abc",
    lastError: null,
    overwroteRemoteAt: null,
  };
  it("reports the mirror's state", () => {
    expect(summarizeMirror(null, ago).tone).toBe("none");
    expect(summarizeMirror(mirror, ago)).toEqual({ tone: "ok", label: "Mirrored now" });
    expect(summarizeMirror({ ...mirror, lastError: "denied" }, ago).tone).toBe("error");
    expect(summarizeMirror({ ...mirror, lastPushedAt: null }, ago).tone).toBe("pending");
  });
  it("warns while the latest push is the one that overwrote the mirror", () => {
    expect(summarizeMirror({ ...mirror, overwroteRemoteAt: mirror.lastPushedAt }, ago).tone).toBe(
      "warning",
    );
    expect(
      summarizeMirror({ ...mirror, overwroteRemoteAt: "2026-10-01T00:00:00.000Z" }, ago).tone,
    ).toBe("ok");
  });
});

describe("live authors and queued saves", () => {
  const amendment = (actor: string, at: string, files: string[]) => ({
    commit: at,
    amendment: at,
    actor,
    subject: "edit",
    at,
    files,
    reverts: null,
  });
  it("finds the newest amendment that changed the file", () => {
    const changeRequest = {
      amendments: [
        amendment("claude", "2026-10-01T00:00:00.000Z", ["A.md"]),
        amendment("You", "2026-10-03T00:00:00.000Z", ["B.md"]),
        amendment("codex", "2026-10-02T00:00:00.000Z", ["A.md", "B.md"]),
      ],
    };
    expect(latestAmendmentFor(changeRequest, "A.md")?.actor).toBe("codex");
    expect(latestAmendmentFor(changeRequest, "C.md")).toBeNull();
    expect(latestAmendmentFor(undefined, "A.md")).toBeNull();
  });
  it("gives each author one stable hex colour", () => {
    expect(authorColor("claude")).toBe(authorColor("claude"));
    expect(authorColor("claude")).toMatch(/^#[\da-f]{6}$/);
  });
  it("treats a thread waiting on its person as mid-turn", () => {
    expect(isTurnRunning("running")).toBe(true);
    expect(isTurnRunning("waiting")).toBe(true);
    expect(isTurnRunning("idle")).toBe(false);
    expect(isTurnRunning("completed")).toBe(false);
    expect(isTurnRunning(undefined)).toBe(false);
  });
});

describe("mapTilesFor", () => {
  const terrain = { name: "Terrain", lightTiles: "https://a/light", darkTiles: "https://a/dark" };
  const satellite = { name: "Satellite", lightTiles: "https://b/light", darkTiles: null };

  it("keeps a view's own tiles over the wiki's backgrounds", () => {
    const view = { mapTiles: ["https://own/light"], mapTilesDark: ["https://own/dark"] };
    expect(mapTilesFor(view, [terrain], "Terrain", false)).toEqual(["https://own/light"]);
    expect(mapTilesFor(view, [terrain], null, true)).toEqual(["https://own/dark"]);
  });

  it("draws the picked background, else the first, else leaves the default", () => {
    expect(mapTilesFor({}, [terrain, satellite], "Satellite", false)).toEqual(["https://b/light"]);
    expect(mapTilesFor({}, [terrain, satellite], "Removed", false)).toEqual(["https://a/light"]);
    expect(mapTilesFor({}, [], null, false)).toBeUndefined();
  });

  it("uses a background's dark tiles in dark mode, or its light ones without any", () => {
    expect(mapTilesFor({}, [terrain], null, true)).toEqual(["https://a/dark"]);
    expect(mapTilesFor({}, [satellite], null, true)).toEqual(["https://b/light"]);
  });
});

describe("wikiDocumentName", () => {
  it("names a canvas by its file, at any depth, and a note only at the top", () => {
    expect(wikiDocumentName("Board.canvas")).toBe("Board.canvas");
    expect(wikiDocumentName("plans/Board.canvas")).toBe("plans/Board.canvas");
    expect(wikiDocumentName("Note.md")).toBe("Note");
    expect(wikiDocumentName("plans/Note.md")).toBeNull();
    expect(wikiDocumentName("pic.png")).toBeNull();
  });
});
