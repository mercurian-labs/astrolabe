import { describe, expect, it } from "vite-plus/test";
import type { WikiChangeRequestId } from "@t3tools/contracts";

import {
  authorColor,
  defaultSaveTarget,
  describeIndexError,
  describeWikiFailure,
  isTurnRunning,
  latestAmendmentFor,
  mergeBlockedReason,
  parseWikiSearch,
  queuedSaveStep,
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

describe("defaultSaveTarget", () => {
  const open = [{ changeRequestId: "cr-1" as WikiChangeRequestId }];
  it("saves into the open change request being viewed", () => {
    expect(defaultSaveTarget(open, "cr-1" as WikiChangeRequestId)).toBe("cr-1");
  });
  it("opens a new one from main or from a change request that is no longer open", () => {
    expect(defaultSaveTarget(open, undefined)).toBeNull();
    expect(defaultSaveTarget(open, "cr-2" as WikiChangeRequestId)).toBeNull();
  });
});

describe("mergeBlockedReason", () => {
  it("allows a clean merge and names what blocks the others", () => {
    expect(
      mergeBlockedReason({
        canWrite: true,
        preview: { status: "clean", conflicts: [], errors: [] },
      }),
    ).toBeNull();
    expect(
      mergeBlockedReason({
        canWrite: true,
        preview: { status: "conflict", conflicts: ["A.md", "B.md"], errors: [] },
      }),
    ).toBe("Conflicts with main in A.md, B.md.");
    expect(
      mergeBlockedReason({
        canWrite: false,
        preview: { status: "clean", conflicts: [], errors: [] },
      }),
    ).toMatch(/permission/);
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
  it("explains a busy checkout as overlapping local edits", () => {
    expect(
      describeWikiFailure({ _tag: "WikiError", reason: "checkout-busy", message: "busy" }),
    ).toMatch(/local edits that overlap/);
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
  it("waits while the turn runs and commits once it ends, once", () => {
    const queued = { changeRequestId: "cr-1" as WikiChangeRequestId, message: "Edit" };
    expect(queuedSaveStep({ queued, turnRunning: true, committing: false })).toBe("wait");
    expect(queuedSaveStep({ queued, turnRunning: false, committing: false })).toBe("commit");
    expect(queuedSaveStep({ queued, turnRunning: false, committing: true })).toBe("idle");
    expect(queuedSaveStep({ queued: null, turnRunning: false, committing: false })).toBe("idle");
  });
});
