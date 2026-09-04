import { describe, expect, it } from "vite-plus/test";

import type { PlanTimelineItem } from "@t3tools/contracts";

import { commitId, message, planRevision, specRevision } from "../../test/fixtures/timeline";

import { buildPlanGraph } from "./PlanGraph.logic";
import { PLAN_MAY_BE_STALE_DESCRIPTION, PLAN_MAY_BE_STALE_LABEL } from "./PlanFreshness";
import {
  planMayBeStaleAt,
  snapshotSpecIsForPath,
  stalePlanLeafIds,
  staleSpecLeafIds,
} from "./SpecArtifact.logic";

const item = (
  id: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  tag: "message" | "plan-revision" | "spec-revision",
): PlanTimelineItem =>
  tag === "message"
    ? message(id, {
        sequence,
        parents,
        createdAt: "2026-08-13T00:00:00.000Z",
      })
    : tag === "plan-revision"
      ? planRevision(id, {
          sequence,
          parents,
          createdAt: "2026-08-13T00:00:00.000Z",
        })
      : specRevision(id, {
          sequence,
          parents,
          createdAt: "2026-08-13T00:00:00.000Z",
        });

describe("SpecArtifact logic", () => {
  it("keeps the plan freshness signal distinct and user-facing", () => {
    expect(PLAN_MAY_BE_STALE_LABEL).toBe("Plan may be stale");
    expect(PLAN_MAY_BE_STALE_DESCRIPTION).toBe("The spec changed after the plan was last revised");
  });

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

  it("clears plan freshness only with a later plan revision on the same path", () => {
    const graph = buildPlanGraph([
      item("root", 1, [], "message"),
      item("spec", 2, ["root"], "spec-revision"),
      item("plan", 3, ["spec"], "plan-revision"),
      item("tip", 4, ["plan"], "message"),
    ]);
    expect(planMayBeStaleAt(graph, commitId("tip"))).toBe(false);
    expect([...stalePlanLeafIds(graph)]).toEqual([]);
  });

  it("marks a path stale when its spec has no later plan revision", () => {
    const graph = buildPlanGraph([
      item("root", 1, [], "plan-revision"),
      item("spec", 2, ["root"], "spec-revision"),
      item("verdict", 3, ["spec"], "message"),
    ]);
    expect(planMayBeStaleAt(graph, commitId("verdict"))).toBe(true);
    expect([...stalePlanLeafIds(graph)]).toEqual(["verdict"]);
  });

  it("does not let a plan revision on a sibling branch clear freshness", () => {
    const graph = buildPlanGraph([
      item("root", 1, [], "message"),
      item("spec", 2, ["root"], "spec-revision"),
      item("sibling-plan", 3, ["root"], "plan-revision"),
      item("merged-tip", 4, ["spec", "sibling-plan"], "message"),
    ]);
    expect(planMayBeStaleAt(graph, commitId("sibling-plan"))).toBe(false);
    expect(planMayBeStaleAt(graph, commitId("merged-tip"))).toBe(true);
    expect([...stalePlanLeafIds(graph)]).toEqual(["merged-tip"]);
  });

  it("never marks a path with no spec revision stale", () => {
    const graph = buildPlanGraph([
      item("root", 1, [], "plan-revision"),
      item("tip", 2, ["root"], "message"),
    ]);
    expect(planMayBeStaleAt(graph, commitId("tip"))).toBe(false);
  });

  it("treats an imported root spec as current after a later plan revision", () => {
    const imported = item("import", 1, [], "spec-revision");
    if (imported._tag !== "spec-revision") throw new Error("expected spec revision");
    const graph = buildPlanGraph([
      { ...imported, cause: "import", issueId: "M-109" },
      item("plan", 2, ["import"], "plan-revision"),
    ]);
    expect(planMayBeStaleAt(graph, commitId("plan"))).toBe(false);
  });
});
