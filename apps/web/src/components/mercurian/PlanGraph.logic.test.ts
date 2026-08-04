import { describe, expect, it } from "vite-plus/test";

import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import {
  ancestorClosure,
  buildPlanGraph,
  graphLayout,
  navigatorRows,
  planCommitSummary,
} from "./PlanGraph.logic";

const id = (value: string) => MercurianCommitId.make(value);

const commit = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  overrides: Partial<{ readonly published: boolean; readonly text: string }> = {},
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: overrides.published ?? false,
  authorKind: "human",
  text: overrides.text ?? name,
  createdAt: "2026-08-03T00:00:00.000Z",
});

/** a → b → c. */
const chain: ReadonlyArray<PlanTimelineItem> = [
  commit("a", 1, []),
  commit("b", 2, ["a"]),
  commit("c", 3, ["b"]),
];

/**
 *      a
 *      |
 *      b
 *     / \
 *    l   r
 */
const fork: ReadonlyArray<PlanTimelineItem> = [
  commit("a", 1, []),
  commit("b", 2, ["a"]),
  commit("l", 3, ["b"]),
  commit("r", 4, ["b"]),
];

/** The fork above, reunified by a three-parent merge. */
const merged: ReadonlyArray<PlanTimelineItem> = [
  ...fork,
  commit("x", 5, ["b"]),
  commit("m", 6, ["l", "r", "x"]),
  commit("after", 7, ["m"]),
];

describe("buildPlanGraph", () => {
  it("reads a linear history as one line with no branch points", () => {
    const graph = buildPlanGraph(chain);
    expect(graph.nodes.map((node) => node.commitId)).toEqual(["a", "b", "c"]);
    expect(graph.roots).toEqual(["a"]);
    expect(graph.latest).toBe("c");
    expect(graph.nodes.some((node) => node.isBranchPoint || node.isMerge)).toBe(false);
    expect(graph.byId.get("b")?.childrenIds).toEqual(["c"]);
  });

  it("orders by sequence whatever order the items arrive in", () => {
    const graph = buildPlanGraph(chain.toReversed());
    expect(graph.nodes.map((node) => node.commitId)).toEqual(["a", "b", "c"]);
    expect(graph.latest).toBe("c");
  });

  it("marks the commit two children hang from as a branch point", () => {
    const graph = buildPlanGraph(fork);
    expect(graph.byId.get("b")?.isBranchPoint).toBe(true);
    expect(graph.byId.get("b")?.childrenIds).toEqual(["l", "r"]);
    expect(graph.byId.get("a")?.isBranchPoint).toBe(false);
  });

  it("marks a commit with several parents as a merge", () => {
    const graph = buildPlanGraph(merged);
    expect(graph.byId.get("m")?.isMerge).toBe(true);
    expect(graph.byId.get("m")?.parents).toEqual(["l", "r", "x"]);
  });

  it("drops an edge to a commit the timeline does not carry", () => {
    // The wire skips commit kinds this surface cannot render yet. A missing
    // parent has to degrade to a missing edge, never to a throw.
    const graph = buildPlanGraph([commit("a", 1, []), commit("b", 2, ["a", "unrendered"])]);
    expect(graph.byId.get("b")?.parents).toEqual(["a"]);
    expect(graph.byId.get("b")?.isMerge).toBe(false);
    expect(graph.roots).toEqual(["a"]);
  });

  it("has nothing to say about an empty history", () => {
    const graph = buildPlanGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.latest).toBeNull();
    expect(navigatorRows(graph)).toEqual([]);
    expect(graphLayout(graph)).toEqual({ rows: [], edges: [], laneCount: 0 });
  });
});

describe("ancestorClosure", () => {
  it("is the commit itself at the root", () => {
    expect([...ancestorClosure(buildPlanGraph(chain), id("a"))]).toEqual(["a"]);
  });

  it("is the whole line at the tip", () => {
    expect([...ancestorClosure(buildPlanGraph(chain), id("c")).values()].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("diverges below a fork and agrees above it", () => {
    const graph = buildPlanGraph(fork);
    const left = ancestorClosure(graph, id("l"));
    const right = ancestorClosure(graph, id("r"));
    expect(left.has("l")).toBe(true);
    expect(left.has("r")).toBe(false);
    expect(right.has("l")).toBe(false);
    // Everything above the fork belongs to both paths.
    expect(left.has("a") && left.has("b") && right.has("a") && right.has("b")).toBe(true);
  });

  it("takes every parent path at a merge", () => {
    const closure = ancestorClosure(buildPlanGraph(merged), id("m"));
    expect([...closure].sort()).toEqual(["a", "b", "l", "m", "r", "x"]);
    expect(closure.has("after")).toBe(false);
  });

  it("is empty for a commit the graph does not hold", () => {
    expect(ancestorClosure(buildPlanGraph(chain), id("nope")).size).toBe(0);
  });
});

describe("navigatorRows", () => {
  it("indents at a fork and nowhere else", () => {
    const rows = navigatorRows(buildPlanGraph(fork));
    expect(rows.map((row) => [row.commitId, row.depth])).toEqual([
      ["a", 0],
      ["b", 0],
      ["l", 1],
      ["r", 1],
    ]);
    expect(rows.every((row) => !row.isReference)).toBe(true);
  });

  it("shows a merge under each parent: one real node, the rest references", () => {
    const rows = navigatorRows(buildPlanGraph(merged));
    const occurrences = rows.filter((row) => row.commitId === "m");
    expect(occurrences).toHaveLength(3);
    expect(occurrences.filter((row) => !row.isReference)).toHaveLength(1);
    // Every occurrence names the same commit, so a reference has somewhere to
    // jump to; only the keys differ.
    expect(new Set(occurrences.map((row) => row.rowId)).size).toBe(3);
    expect(occurrences.every((row) => row.isMerge)).toBe(true);

    // The real node is the one under the first parent, and it is the only one
    // the walk continues below.
    const real = occurrences.find((row) => !row.isReference);
    const realIndex = rows.indexOf(real!);
    expect(rows[realIndex - 1]?.commitId).toBe("l");
    expect(rows.filter((row) => row.commitId === "after")).toHaveLength(1);
    expect(rows.indexOf(rows.find((row) => row.commitId === "after")!)).toBe(realIndex + 1);
  });

  it("walks every commit of a linear history exactly once", () => {
    const rows = navigatorRows(buildPlanGraph(chain));
    expect(rows.map((row) => row.commitId)).toEqual(["a", "b", "c"]);
  });
});

describe("graphLayout", () => {
  it("keeps a linear history in one lane", () => {
    const layout = graphLayout(buildPlanGraph(chain));
    expect(layout.laneCount).toBe(1);
    expect(layout.rows.map((row) => [row.commitId, row.row, row.lane])).toEqual([
      ["a", 0, 0],
      ["b", 1, 0],
      ["c", 2, 0],
    ]);
    expect(layout.edges.map((edge) => [edge.fromCommitId, edge.toCommitId])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("opens a lane at a fork", () => {
    const layout = graphLayout(buildPlanGraph(fork));
    const lane = (commitId: string) => layout.rows.find((row) => row.commitId === commitId)?.lane;
    expect(lane("l")).toBe(lane("b"));
    expect(lane("r")).not.toBe(lane("b"));
    expect(layout.laneCount).toBe(2);
  });

  it("draws a merge once, and closes the lanes that reached it", () => {
    const layout = graphLayout(buildPlanGraph(merged));
    expect(layout.rows.filter((row) => row.commitId === "m")).toHaveLength(1);
    // Three parents converge, so three edges land on the one row.
    expect(layout.edges.filter((edge) => edge.toCommitId === "m")).toHaveLength(3);
    // The lanes the branches opened are free again below the merge: what
    // follows sits back on the merge's own lane.
    const lane = (commitId: string) => layout.rows.find((row) => row.commitId === commitId)?.lane;
    expect(lane("after")).toBe(lane("m"));
    expect(layout.laneCount).toBe(3);
  });

  it("gives every commit a row in append order", () => {
    const layout = graphLayout(buildPlanGraph(merged));
    expect(layout.rows.map((row) => row.row)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(layout.rows.map((row) => row.commitId)).toEqual(["a", "b", "l", "r", "x", "m", "after"]);
  });
});

describe("planCommitSummary", () => {
  it("says what a message said, on one line", () => {
    expect(planCommitSummary(commit("a", 1, [], { text: "  Reshape it  \nand more" }))).toBe(
      "Reshape it",
    );
  });

  it("truncates a long first line", () => {
    expect(planCommitSummary(commit("a", 1, [], { text: "x".repeat(200) })).length).toBe(60);
  });

  it("has something to say about an empty message", () => {
    expect(planCommitSummary(commit("a", 1, [], { text: "   \n " }))).toBe("Empty message");
  });

  it("says what a revision did, since it has no body to show", () => {
    const revision: PlanTimelineItem = {
      _tag: "plan-revision",
      commitId: id("rev"),
      sequence: 2,
      parents: [id("a")],
      published: false,
      authorKind: "assistant",
      createdAt: "2026-08-03T00:00:00.000Z",
    };
    expect(planCommitSummary(revision)).toBe("The assistant revised the plan");
  });
});
