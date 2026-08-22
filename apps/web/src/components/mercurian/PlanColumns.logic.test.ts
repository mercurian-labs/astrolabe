import { describe, expect, it } from "vite-plus/test";

import type { PlanTimelineItem } from "@t3tools/contracts";

import { commitId as id, message, planRevision, specRevision } from "../../test/fixtures/timeline";

import { columnLayout, columnViewWidthCap, defaultBranchChoices } from "./PlanColumns.logic";
import { condensePlanGraph } from "./PlanCheckpoints.logic";
import { threadLayout } from "./PlanThread.logic";
import { buildPlanGraph, type PlanGraph } from "./PlanGraph.logic";

const commit = (name: string, sequence: number, parents: ReadonlyArray<string>): PlanTimelineItem =>
  message(name, {
    sequence,
    parents,
    createdAt: "2026-08-03T00:00:00.000Z",
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
 *    / \
 *   ll lr
 *   |   |
 *  end alt
 */
const nestedFork: ReadonlyArray<PlanTimelineItem> = [
  commit("a", 1, []),
  commit("b", 2, ["a"]),
  commit("l", 3, ["b"]),
  commit("r", 4, ["b"]),
  commit("ll", 5, ["l"]),
  commit("lr", 6, ["l"]),
  commit("end", 7, ["ll"]),
  commit("alt", 8, ["lr"]),
];

const paneIds = (graph: PlanGraph, head: string, choices = new Map()) =>
  columnLayout(graph, id(head), choices).panes.map((pane) => pane.rows.map((row) => row.commitId));

describe("defaultBranchChoices", () => {
  it("follows the head above it and first-child order below it", () => {
    const graph = buildPlanGraph(fork);
    expect([...defaultBranchChoices(graph, id("rr"))]).toEqual([["b", "r"]]);
    expect([...defaultBranchChoices(graph, id("b"))]).toEqual([["b", "l"]]);
  });

  it("remembers how a parallel ancestral line reaches the head", () => {
    /**
     *       a
     *      / \
     *     l   r
     *     |  / \
     *     | x   y
     *     |     |
     *     '---- m
     */
    const graph = buildPlanGraph([
      commit("a", 1, []),
      commit("l", 2, ["a"]),
      commit("r", 3, ["a"]),
      commit("x", 4, ["r"]),
      commit("y", 5, ["r"]),
      commit("m", 6, ["l", "y"]),
    ]);
    const defaults = defaultBranchChoices(graph, id("m"));
    expect([...defaults]).toEqual([
      ["a", "l"],
      ["r", "y"],
    ]);
    expect(paneIds(graph, "m", new Map([["a", id("r")]]))).toEqual([["a"], ["r"], ["y", "m"]]);
  });
});

describe("columnLayout", () => {
  it("keeps a linear history in exactly one leaf pane", () => {
    const layout = columnLayout(buildPlanGraph(chain), id("c"), new Map());
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0]?.terminal).toEqual({ kind: "leaf" });
    expect(layout.panes[0]?.rows.map((row) => row.commitId)).toEqual(["a", "b", "c"]);
  });

  it("ends a pane at a fork and replaces the run to its right", () => {
    const graph = buildPlanGraph(fork);
    const defaults = defaultBranchChoices(graph, id("rr"));
    const initial = columnLayout(graph, id("rr"), defaults);

    expect(initial.panes[0]?.rows.map((row) => row.commitId)).toEqual(["a", "b"]);
    expect(initial.panes[0]?.terminal).toMatchObject({
      kind: "fork",
      chosenChildId: "r",
      options: [{ branchRootId: "l" }, { branchRootId: "r" }],
    });
    expect(initial.panes[1]?.rows.map((row) => row.commitId)).toEqual(["r", "rr"]);

    const overridden = columnLayout(
      graph,
      id("rr"),
      new Map([
        ["b", id("l")],
        // A choice from the line that was replaced has no bearing here.
        ["r", id("stale")],
      ]),
    );
    expect(overridden.panes[0]?.terminal).toMatchObject({ chosenChildId: "l" });
    expect(overridden.panes[1]?.rows.map((row) => row.commitId)).toEqual(["l", "ll"]);
  });

  it("makes one more pane than the forks crossed and reads as one path", () => {
    const graph = buildPlanGraph(nestedFork);
    const layout = columnLayout(graph, id("end"), defaultBranchChoices(graph, id("end")));
    expect(layout.panes).toHaveLength(3);
    expect(layout.panes.map((pane) => pane.rows.map((row) => row.commitId))).toEqual([
      ["a", "b"],
      ["l"],
      ["ll", "end"],
    ]);

    const path = layout.panes.flatMap((pane) => pane.rows);
    for (const [index, row] of path.entries()) {
      if (index === 0) continue;
      expect(row.parents).toContain(path[index - 1]?.commitId);
    }

    const switched = columnLayout(
      graph,
      id("end"),
      new Map([
        ["b", id("r")],
        ["l", id("lr")],
      ]),
    );
    expect(switched.panes.map((pane) => pane.rows.map((row) => row.commitId))).toEqual([
      ["a", "b"],
      ["r"],
    ]);
  });

  it("keeps a fork intact while its direct merge child references the real row", () => {
    /**
     *       a
     *       |
     *       b ------.
     *       |       |
     *       c       |
     *       |       |
     *       m <-----'
     *       |
     *     after
     *
     * The line enters m through c. The direct b → m edge stays visible as a
     * fork option, but activates as a reference to m's one real row.
     */
    const graph = buildPlanGraph([
      commit("a", 1, []),
      commit("b", 2, ["a"]),
      commit("c", 3, ["b"]),
      commit("m", 4, ["c", "b"]),
      commit("after", 5, ["m"]),
    ]);
    const layout = columnLayout(graph, id("after"), new Map([["b", id("c")]]));

    expect(layout.panes[0]?.terminal).toMatchObject({
      kind: "fork",
      chosenChildId: "c",
      options: [
        { branchRootId: "c", onPathMerge: false },
        { branchRootId: "m", onPathMerge: true },
      ],
    });
    expect(layout.panes[1]?.rows.map((row) => row.commitId)).toEqual(["c", "m"]);
    expect(layout.panes[1]?.terminal).toEqual({ kind: "merge-entry", mergeCommitId: "m" });
    expect(layout.panes[2]?.rows.map((row) => row.commitId)).toEqual(["after"]);
    const path = layout.panes.flatMap((pane) => pane.rows);
    expect(path.filter((row) => row.commitId === "m")).toHaveLength(1);
    expect(new Set(path.map((row) => row.commitId)).size).toBe(5);
    for (const [index, row] of path.entries()) {
      if (index === 0) continue;
      expect(row.parents).toContain(path[index - 1]?.commitId);
    }

    const direct = columnLayout(graph, id("after"), new Map([["b", id("m")]]));
    expect(direct.panes[0]?.terminal).toMatchObject({
      kind: "fork",
      chosenChildId: "m",
      options: [
        { branchRootId: "c", onPathMerge: false },
        { branchRootId: "m", onPathMerge: false },
      ],
    });
    expect(direct.panes.map((pane) => pane.rows.map((row) => row.commitId))).toEqual([
      ["a", "b"],
      ["m"],
      ["after"],
    ]);
    expect(direct.panes.flatMap((pane) => pane.rows).some((row) => row.commitId === "c")).toBe(
      false,
    );
  });

  it("continues through an interior head and leaves it in the matching pane", () => {
    const graph = buildPlanGraph(nestedFork);
    const layout = columnLayout(graph, id("l"), defaultBranchChoices(graph, id("l")));
    const activePane = layout.panes.findIndex((pane) =>
      pane.rows.some((row) => row.commitId === "l"),
    );
    expect(activePane).toBe(1);
    expect(layout.panes.flatMap((pane) => pane.rows.map((row) => row.commitId))).toEqual([
      "a",
      "b",
      "l",
      "ll",
      "end",
    ]);
  });

  it("truncates dangling edges and has no panes for an empty graph", () => {
    const partial = buildPlanGraph([commit("b", 2, ["missing"]), commit("c", 3, ["b"])]);
    expect(paneIds(partial, "c")).toEqual([["b", "c"]]);
    expect(columnLayout(buildPlanGraph([]), null, new Map()).panes).toEqual([]);
  });
});

describe("columnViewWidthCap", () => {
  it("agrees with the thread layout on reanchored forks, with no duplicate rows", () => {
    // The column halves of the checkpoint reanchoring cases: a fork from a
    // terminal response and a fork from a trailing revision each read the
    // same rows in columns as in the thread, each row exactly once.
    const histories = [
      [
        message("query", { sequence: 1, parents: [], authorKind: "human" }),
        message("response", { sequence: 2, parents: ["query"], authorKind: "assistant" }),
        message("fork", { sequence: 3, parents: ["response"], authorKind: "human" }),
        message("main", { sequence: 4, parents: ["response"], authorKind: "human" }),
      ],
      [
        message("query", { sequence: 1, parents: [], authorKind: "human" }),
        planRevision("plan", { sequence: 2, parents: ["query"], authorKind: "assistant" }),
        specRevision("spec", { sequence: 3, parents: ["plan"], authorKind: "assistant" }),
        message("fork", { sequence: 4, parents: ["spec"], authorKind: "human" }),
        message("main", { sequence: 5, parents: ["spec"], authorKind: "human" }),
      ],
    ];
    for (const history of histories) {
      const graph = condensePlanGraph(buildPlanGraph(history));
      const threadIds = threadLayout(graph, id("fork"), new Map()).rows.map((row) => row.commitId);
      const columns = columnLayout(graph, id("fork"), defaultBranchChoices(graph, id("fork")));
      const columnIds = columns.panes.flatMap((pane) => pane.rows.map((row) => row.commitId));
      expect(columnIds).toEqual(threadIds);
      expect(new Set(columnIds).size).toBe(columnIds.length);
    }
  });

  it("caps at every pane expanded plus their shared flexible room", () => {
    const graph = buildPlanGraph(nestedFork);
    const panes = columnLayout(graph, id("end"), defaultBranchChoices(graph, id("end"))).panes;

    expect(columnViewWidthCap(panes)).toBe(224 + 224 + 336);
  });
});
