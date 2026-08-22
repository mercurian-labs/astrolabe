import { describe, expect, it } from "vite-plus/test";

import { lastPlanRevision, saveRefusalNotice, snapshotTextIsForPath } from "./planArtifact.ts";

const message = (createdAt: string) =>
  ({ _tag: "message", authorKind: "human", createdAt }) as const;
const revision = (authorKind: "human" | "assistant", createdAt: string) =>
  ({ _tag: "plan-revision", authorKind, createdAt }) as const;
const splitRevision = (authorKind: "human" | "assistant", createdAt: string) =>
  ({ _tag: "plan-revision", authorKind, createdAt, split: {} }) as const;

describe("lastPlanRevision", () => {
  it("has nothing to attribute on a plan born blank", () => {
    expect(lastPlanRevision([message("2026-08-03T00:00:00.000Z")])).toBeNull();
  });

  it("reads the latest revision, not the latest commit", () => {
    const attribution = lastPlanRevision([
      message("2026-08-03T00:00:00.000Z"),
      revision("human", "2026-08-03T00:01:00.000Z"),
      message("2026-08-03T00:02:00.000Z"),
    ]);
    expect(attribution).toEqual({ authorKind: "human", createdAt: "2026-08-03T00:01:00.000Z" });
  });

  it("keeps both parties' edits attributable", () => {
    const attribution = lastPlanRevision([
      revision("human", "2026-08-03T00:01:00.000Z"),
      revision("assistant", "2026-08-03T00:02:00.000Z"),
    ]);
    expect(attribution?.authorKind).toBe("assistant");
  });

  it("attributes a path ending at a split to that split revision", () => {
    const attribution = lastPlanRevision([
      revision("assistant", "2026-08-03T00:01:00.000Z"),
      splitRevision("human", "2026-08-03T00:02:00.000Z"),
    ]);
    expect(attribution).toEqual({
      authorKind: "human",
      createdAt: "2026-08-03T00:02:00.000Z",
    });
  });
});

const msg = (commitId: string) => ({ _tag: "message", commitId }) as const;
const rev = (commitId: string) => ({ _tag: "plan-revision", commitId }) as const;
const splitRev = (commitId: string) =>
  ({ _tag: "plan-revision", commitId, split: { repositoryId: "repo-1" } }) as const;

describe("snapshotTextIsForPath", () => {
  it("trusts the snapshot while the history is one line", () => {
    const timeline = [msg("a"), rev("b"), msg("c")];
    expect(snapshotTextIsForPath(timeline, timeline)).toBe(true);
  });

  it("fetches path text when the path ends at a split", () => {
    const timeline = [msg("root"), rev("parent-plan"), splitRev("split-a")];
    expect(snapshotTextIsForPath(timeline, timeline)).toBe(false);
  });

  it("trusts it for a plan nobody has edited on either reading", () => {
    expect(snapshotTextIsForPath([msg("a"), msg("b")], [msg("a")])).toBe(true);
  });

  it("refuses it when the newest revision is on a branch this path is not on", () => {
    // The whole history ends in a revision on the other branch; this path has
    // none of its own, so the snapshot's text is somebody else's plan.
    const timeline = [msg("root"), msg("mine"), msg("theirs"), rev("their-edit")];
    expect(snapshotTextIsForPath(timeline, [msg("root"), msg("mine")])).toBe(false);
  });

  it("refuses it when this path's own revision has been overtaken elsewhere", () => {
    const timeline = [msg("root"), rev("my-edit"), msg("theirs"), rev("their-edit")];
    expect(snapshotTextIsForPath(timeline, [msg("root"), rev("my-edit")])).toBe(false);
  });

  it("trusts it when this path's revision is the newest one anywhere", () => {
    const timeline = [msg("root"), msg("theirs"), rev("my-edit")];
    expect(snapshotTextIsForPath(timeline, [msg("root"), rev("my-edit")])).toBe(true);
  });
});

describe("saveRefusalNotice", () => {
  it("names the streaming reply as the reason, and that the edit survived", () => {
    const notice = saveRefusalNotice({ _tag: "PlanTurnActiveError", planId: "plan-1" });
    expect(notice).toContain("replying on this branch");
    expect(notice).toContain("still here");
  });

  it("keeps honest about a refusal it cannot name", () => {
    expect(saveRefusalNotice(new Error("boom"))).toContain("could not be saved");
    expect(saveRefusalNotice(undefined)).toContain("could not be saved");
    // A tag from some other refusal is not dressed up as a turn.
    expect(saveRefusalNotice({ _tag: "SomethingElse" })).toContain("could not be saved");
  });
});
