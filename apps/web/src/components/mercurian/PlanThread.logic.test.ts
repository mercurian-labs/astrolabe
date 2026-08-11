import { describe, expect, it } from "vite-plus/test";

import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { buildPlanGraph } from "./PlanGraph.logic";
import { branchOption, mostRecentTip, threadLayout } from "./PlanThread.logic";

const id = (value: string) => MercurianCommitId.make(value);

const commit = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  overrides: Partial<{
    readonly createdAt: string;
    readonly published: boolean;
    readonly text: string;
  }> = {},
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: overrides.published ?? false,
  authorKind: "human",
  text: overrides.text ?? name,
  createdAt: overrides.createdAt ?? "2026-08-03T00:00:00.000Z",
});

/** a → b → c. */
const chain: ReadonlyArray<PlanTimelineItem> = [
  commit("a", 1, []),
  commit("b", 2, ["a"]),
  commit("c", 3, ["b"]),
];

/**
 *       a
 *       |
 *       b
 *      / \
 *     l   r
 *     |   |
 *    ll  rr
 */
const fork: ReadonlyArray<PlanTimelineItem> = [
  commit("a", 1, []),
  commit("b", 2, ["a"]),
  commit("l", 3, ["b"]),
  commit("r", 4, ["b"]),
  commit("ll", 5, ["l"]),
  commit("rr", 6, ["r"]),
];

/**
 *       a
 *       |
 *       b
 *      / \
 *     l   r
 *      \ /
 *       m
 *       |
 *     after
 */
const merged: ReadonlyArray<PlanTimelineItem> = [
  commit("a", 1, []),
  commit("b", 2, ["a"]),
  commit("l", 3, ["b"]),
  commit("r", 4, ["b"]),
  commit("m", 5, ["l", "r"]),
  commit("after", 6, ["m"]),
];

const rowIds = (timeline: ReadonlyArray<PlanTimelineItem>, head: string) =>
  threadLayout(buildPlanGraph(timeline), id(head), new Map()).rows.map((row) => row.commitId);

describe("threadLayout", () => {
  it("reads a linear chain root first without switches", () => {
    const rows = threadLayout(buildPlanGraph(chain), id("c"), new Map()).rows;
    expect(rows.map((row) => row.commitId)).toEqual(["a", "b", "c"]);
    expect(rows.every((row) => row.siblings === undefined && row.parentLines === undefined)).toBe(
      true,
    );
  });

  it("shows only the checked-out branch, with its count and index", () => {
    const rows = threadLayout(buildPlanGraph(fork), id("r"), new Map()).rows;
    expect(rows.map((row) => row.commitId)).toEqual(["a", "b", "r", "rr"]);
    expect(rows.some((row) => row.commitId === "l" || row.commitId === "ll")).toBe(false);
    expect(rows.find((row) => row.commitId === "r")?.siblings).toEqual({
      options: ["l", "r"],
      index: 1,
    });
  });

  it("continues below an interior head by first-child order", () => {
    expect(rowIds(fork, "b")).toEqual(["a", "b", "l", "ll"]);
  });

  it("follows the first parent at a merge and applies a chosen parent above it only", () => {
    const graph = buildPlanGraph(merged);
    const defaultRows = threadLayout(graph, id("m"), new Map()).rows;
    expect(defaultRows.map((row) => row.commitId)).toEqual(["a", "b", "l", "m", "after"]);
    expect(defaultRows.filter((row) => row.commitId === "m")).toHaveLength(1);
    expect(defaultRows.find((row) => row.commitId === "m")?.parentLines).toEqual({
      options: ["l", "r"],
      index: 0,
    });

    const chosenRows = threadLayout(graph, id("m"), new Map([["m", id("r")]])).rows;
    expect(chosenRows.map((row) => row.commitId)).toEqual(["a", "b", "r", "m", "after"]);
    expect(chosenRows.find((row) => row.commitId === "m")?.parentLines?.index).toBe(1);
    expect(chosenRows.slice(-2).map((row) => row.commitId)).toEqual(["m", "after"]);
  });

  it("truncates a missing parent and has no rows for an empty or missing head", () => {
    const partial = buildPlanGraph([commit("b", 2, ["missing"]), commit("c", 3, ["b"])]);
    expect(threadLayout(partial, id("c"), new Map()).rows.map((row) => row.commitId)).toEqual([
      "b",
      "c",
    ]);
    expect(threadLayout(buildPlanGraph([]), null, new Map()).rows).toEqual([]);
    expect(threadLayout(buildPlanGraph(chain), id("missing"), new Map()).rows).toEqual([]);
  });
});

describe("mostRecentTip", () => {
  it("chooses the highest-sequence leaf in the whole subtree", () => {
    /**
     *       a
     *      / \
     *     l   r
     *     |
     *    ll
     */
    const graph = buildPlanGraph([
      commit("a", 1, []),
      commit("l", 2, ["a"]),
      commit("ll", 3, ["l"]),
      commit("r", 4, ["a"]),
    ]);
    expect(mostRecentTip(graph, id("a"))).toBe("r");
  });
});

describe("branchOption", () => {
  it("describes the branch root and lands on its most recent tip", () => {
    const graph = buildPlanGraph([
      commit("a", 1, []),
      commit("branch", 2, ["a"], {
        createdAt: "2026-08-03T01:00:00.000Z",
        published: true,
        text: "  Explore another route\nand its details",
      }),
      commit("tip", 3, ["branch"], { createdAt: "2026-08-03T02:00:00.000Z" }),
    ]);

    expect(branchOption(graph, id("branch"))).toEqual({
      branchRootId: "branch",
      tipId: "tip",
      summary: "Explore another route",
      lastActiveAt: "2026-08-03T02:00:00.000Z",
      published: true,
    });
  });
});
