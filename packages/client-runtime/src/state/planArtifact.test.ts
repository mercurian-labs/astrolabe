import { describe, expect, it } from "@effect/vitest";

import { lastPlanRevision, saveRefusalNotice, snapshotTextIsForPath } from "./planArtifact.ts";

const msg = (commitId: string) =>
  ({ _tag: "message", commitId, authorKind: "human", createdAt: "2026-08-03T00:00:00Z" }) as const;
const rev = (commitId: string, authorKind: "human" | "assistant" = "human") =>
  ({ _tag: "plan-revision", commitId, authorKind, createdAt: "2026-08-03T00:01:00Z" }) as const;
const split = (commitId: string) => ({ ...rev(commitId), split: {} }) as const;

describe("plan artifact path", () => {
  it("trusts the snapshot for the newest path and fetches for another branch", () => {
    const timeline = [msg("root"), rev("mine"), msg("other"), rev("other-edit")];
    expect(snapshotTextIsForPath(timeline, timeline)).toBe(true);
    expect(snapshotTextIsForPath(timeline, [msg("root"), rev("mine")])).toBe(false);
  });

  it("fetches path text at a split revision", () => {
    const timeline = [msg("root"), rev("parent"), split("split")];
    expect(snapshotTextIsForPath(timeline, timeline)).toBe(false);
  });

  it("attributes the last plan revision, including splits", () => {
    expect(lastPlanRevision([rev("human"), rev("assistant", "assistant"), msg("after")])).toEqual({
      authorKind: "assistant",
      createdAt: "2026-08-03T00:01:00Z",
    });
    expect(lastPlanRevision([msg("blank")])).toBeNull();
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
