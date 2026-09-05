import { describe, expect, it } from "vite-plus/test";

import { message, planRevision } from "../../test/fixtures/timeline";

import { snapshotTextIsForPath } from "./PlanArtifact.logic";

const msg = (commitId: string) => message(commitId);
const rev = (commitId: string) => planRevision(commitId);
const splitRev = (commitId: string) => planRevision(commitId, { split: { repository: "repo-1" } });

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
