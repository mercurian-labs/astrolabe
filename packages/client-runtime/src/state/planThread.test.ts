import { describe, expect, it } from "@effect/vitest";
import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { buildPlanGraph } from "./planGraph.ts";
import { branchOption, mostRecentTip, threadLayout } from "./planThread.ts";

const id = (value: string) => MercurianCommitId.make(value);
const commit = (
  name: string,
  sequence: number,
  parents: string[],
  published = false,
): PlanTimelineItem => ({
  _tag: "plan-revision",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published,
  authorKind: "human",
  createdAt: `2026-08-20T00:0${sequence}:00.000Z`,
});

describe("threadLayout", () => {
  it("reads only the standing fork branch and exposes its index", () => {
    const graph = buildPlanGraph([
      commit("root", 1, []),
      commit("left", 2, ["root"]),
      commit("right", 3, ["root"]),
      commit("right-tip", 4, ["right"]),
    ]);
    const rows = threadLayout(graph, id("right"), new Map()).rows;
    expect(rows.map((row) => row.commitId)).toEqual(["root", "right", "right-tip"]);
    expect(rows[1]?.siblings).toEqual({ options: ["left", "right"], index: 1 });
  });

  it("re-roots ancestry above a merge without duplicating the merge", () => {
    const graph = buildPlanGraph([
      commit("root", 1, []),
      commit("left", 2, ["root"]),
      commit("right", 3, ["root"]),
      commit("merge", 4, ["left", "right"]),
      commit("after", 5, ["merge"]),
    ]);
    const rows = threadLayout(graph, id("merge"), new Map([["merge", id("right")]])).rows;
    expect(rows.map((row) => row.commitId)).toEqual(["root", "right", "merge", "after"]);
    expect(rows.find((row) => row.commitId === "merge")?.parentLines?.index).toBe(1);
  });
});

describe("branch options", () => {
  it("uses the most recent leaf and preserves branch publication", () => {
    const graph = buildPlanGraph([
      commit("root", 1, []),
      commit("branch", 2, ["root"], true),
      commit("older-tip", 3, ["branch"]),
      commit("newer-tip", 4, ["branch"]),
    ]);
    expect(mostRecentTip(graph, id("branch"))).toBe("newer-tip");
    expect(branchOption(graph, id("branch"))).toMatchObject({
      branchRootId: "branch",
      tipId: "newer-tip",
      published: true,
    });
  });
});
