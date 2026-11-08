import { describe, expect, it } from "vite-plus/test";
import { SourceControlProviderKind } from "@t3tools/contracts";

import {
  authorColor,
  describeIndexError,
  describeWikiFailure,
  hasUnpublishedWork,
  hostedPullRequestKeys,
  wikiMergeMethod,
  wikiTerms,
  isHostedPullRequest,
  isTurnRunning,
  latestAmendmentFor,
  mapTilesFor,
  mergeBlockedReason,
  mergeConflictAdvice,
  parseWikiSearch,
  summarizeHost,
  summarizeMirror,
  wikiPullRequestHost,
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
    const note = `${"folder/".repeat(100)}Plan.md`;
    expect(parseWikiSearch({ note }).note).toBe(note);
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

describe("summarizeHost", () => {
  const ago = () => "now";
  const host = {
    projectId: "project-1" as never,
    remote: "origin",
    lastSyncedAt: "2026-10-02T00:00:00.000Z",
    lastSyncedCommit: "abc",
    relation: "up-to-date" as const,
    lastError: null,
  };
  it("puts what needs a person first", () => {
    expect(summarizeHost(null, ago).tone).toBe("none");
    expect(summarizeHost(undefined, ago).tone).toBe("none");
    expect(summarizeHost({ ...host, lastSyncedAt: null, relation: null }, ago).tone).toBe(
      "pending",
    );
    expect(summarizeHost(host, ago)).toEqual({ tone: "ok", label: "Synced now" });
    expect(summarizeHost({ ...host, relation: "ahead" }, ago).tone).toBe("warning");
    expect(summarizeHost({ ...host, relation: "behind", lastError: "edits" }, ago)).toEqual({
      tone: "warning",
      label: "Main is behind the host",
    });
    expect(summarizeHost({ ...host, relation: "diverged" }, ago).tone).toBe("error");
    expect(summarizeHost({ ...host, lastError: "boom", relation: "ahead" }, ago).label).toBe(
      "Sync failed",
    );
  });
});

describe("wikiTerms", () => {
  it("says what the wiki's host says, and pull request with no host", () => {
    expect(wikiTerms({ host: { kind: SourceControlProviderKind.make("gitlab") } }).Plural).toBe(
      "Merge requests",
    );
    expect(wikiTerms({ host: { kind: SourceControlProviderKind.make("forgejo") } }).singular).toBe(
      "pull request",
    );
    expect(wikiTerms({ host: null }).Singular).toBe("Pull request");
    expect(wikiTerms(null).plural).toBe("pull requests");
  });
});

describe("host wiki change requests", () => {
  const changeRequest = (head: string, pushedHead: string | null, amendments = 1) =>
    ({
      status: "open",
      head,
      pushedHead,
      amendments: Array.from({ length: amendments }),
    }) as never;

  it("calls work unpublished only when there is some and the host lacks it", () => {
    expect(hasUnpublishedWork(changeRequest("a", null))).toBe(true);
    expect(hasUnpublishedWork(changeRequest("b", "a"))).toBe(true);
    expect(hasUnpublishedWork(changeRequest("a", "a"))).toBe(false);
    expect(hasUnpublishedWork(changeRequest("a", null, 0))).toBe(false);
  });

  it("merges keeping each amendment its own commit, and squashes only as a last resort", () => {
    expect(wikiMergeMethod(["squash", "rebase", "merge"])).toBe("merge");
    expect(wikiMergeMethod(["squash", "rebase"])).toBe("rebase");
    expect(wikiMergeMethod(["squash"])).toBe("squash");
    expect(wikiMergeMethod([])).toBeUndefined();
  });

  it("matches a row by its project or its address, however the host spells either", () => {
    const keys = hostedPullRequestKeys([
      {
        projectId: "project-1",
        changeRequests: [
          {
            pullRequest: {
              repository: "Acme/Handbook",
              number: 4,
              url: "https://dev.azure.com/Acme/Handbook/pull/4",
            },
          },
          { pullRequest: null },
          {},
        ],
      },
    ]);
    const row = (projectId: string, host: string, number: number) => ({
      projectId,
      host,
      repository: "acme/handbook",
      number,
    });
    // The same project, on a host spelled differently from the pull request's link.
    expect(isHostedPullRequest(keys, row("project-1", "acme.visualstudio.com", 4))).toBe(true);
    // Another checkout of the same repository.
    expect(isHostedPullRequest(keys, row("project-2", "dev.azure.com", 4))).toBe(true);
    expect(isHostedPullRequest(keys, row("project-1", "dev.azure.com", 5))).toBe(false);
    expect(isHostedPullRequest(keys, row("project-2", "gitlab.example.com", 4))).toBe(false);
  });

  it("reads the host from a pull request's link", () => {
    expect(wikiPullRequestHost("https://GitHub.com/acme/handbook/pull/4")).toBe("github.com");
    expect(wikiPullRequestHost("not a link")).toBeNull();
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
