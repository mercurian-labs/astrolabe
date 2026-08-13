import { describe, expect, it } from "vite-plus/test";

import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { buildPlanGraph } from "./PlanGraph.logic";
import { snapshotSpecIsForPath, specRevisionLabel, staleSpecLeafIds } from "./SpecArtifact.logic";

const item = (
  id: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  tag: "message" | "spec-revision",
): PlanTimelineItem =>
  tag === "message"
    ? {
        _tag: "message",
        commitId: MercurianCommitId.make(id),
        sequence,
        parents: parents.map((parent) => MercurianCommitId.make(parent)),
        published: false,
        authorKind: "human",
        createdAt: "2026-08-13T00:00:00.000Z",
        text: id,
      }
    : {
        _tag: "spec-revision",
        commitId: MercurianCommitId.make(id),
        sequence,
        parents: parents.map((parent) => MercurianCommitId.make(parent)),
        published: false,
        authorKind: "human",
        createdAt: "2026-08-13T00:00:00.000Z",
        cause: "direct",
      };

describe("SpecArtifact logic", () => {
  it("knows when the snapshot spec belongs to the selected path", () => {
    const root = item("root", 1, [], "spec-revision");
    const left = item("left", 2, ["root"], "message");
    const newer = item("newer", 3, ["left"], "spec-revision");
    expect(snapshotSpecIsForPath([root, left, newer], [root, left])).toBe(false);
    expect(snapshotSpecIsForPath([root, left, newer], [root, left, newer])).toBe(true);
  });

  it("marks only leaves that have not absorbed the newest spec", () => {
    const timeline = [
      item("root", 1, [], "spec-revision"),
      item("left", 2, ["root"], "message"),
      item("right", 3, ["root"], "message"),
      item("newer", 4, ["left"], "spec-revision"),
      item("left-tip", 5, ["newer"], "message"),
      item("right-tip", 6, ["right"], "message"),
    ];
    expect([...staleSpecLeafIds(buildPlanGraph(timeline))]).toEqual(["right-tip"]);
  });

  it("uses spec vocabulary while retaining tracker issue identity", () => {
    const revision = item("refresh", 1, [], "spec-revision");
    if (revision._tag !== "spec-revision") throw new Error("expected spec revision");
    const { _tag: _, ...row } = revision;
    expect(specRevisionLabel({ ...row, cause: "refresh", issueId: "M-109" })).toBe(
      "Refreshed from M-109",
    );
  });
});
