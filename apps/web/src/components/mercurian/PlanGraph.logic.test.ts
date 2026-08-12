import { describe, expect, it } from "vite-plus/test";

import {
  MercurianCommitId,
  MercurianRepositoryId,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import {
  ancestorClosure,
  buildPlanGraph,
  dagLayout,
  descendantClosure,
  effectivePlanExplorerView,
  hasFork,
  planCommitDetail,
  planCommitSummary,
  type DagLayoutName,
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
    expect(dagLayout(graph, { layout: "sugiyama" }).nodes).toEqual([]);
  });
});

describe("fork-dependent explorer views", () => {
  it("finds no fork in an empty graph", () => {
    expect(hasFork(buildPlanGraph([]))).toBe(false);
  });

  it("finds no fork in a linear graph", () => {
    expect(hasFork(buildPlanGraph(chain))).toBe(false);
  });

  it("finds a node with at least two children", () => {
    expect(hasFork(buildPlanGraph(fork))).toBe(true);
  });

  it("falls back from hidden columns without changing the other views", () => {
    const linearGraph = buildPlanGraph(chain);
    expect(effectivePlanExplorerView(linearGraph, "columns")).toBe("thread");
    expect(effectivePlanExplorerView(linearGraph, "thread")).toBe("thread");
    expect(effectivePlanExplorerView(linearGraph, "graph")).toBe("graph");
    expect(effectivePlanExplorerView(buildPlanGraph(fork), "columns")).toBe("columns");
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

describe("descendantClosure", () => {
  it("is the commit itself at a leaf", () => {
    expect([...descendantClosure(buildPlanGraph(chain), id("c"))]).toEqual(["c"]);
  });

  it("takes both arms below a branch point", () => {
    expect([...descendantClosure(buildPlanGraph(fork), id("b"))].sort()).toEqual(["b", "l", "r"]);
  });

  it("flows through a merge and everything below it", () => {
    expect([...descendantClosure(buildPlanGraph(merged), id("l"))].sort()).toEqual([
      "after",
      "l",
      "m",
    ]);
  });

  it("is empty for a commit the graph does not hold", () => {
    expect(descendantClosure(buildPlanGraph(chain), id("nope")).size).toBe(0);
  });
});

describe("dagLayout", () => {
  const shapes = [
    ["a chain", chain],
    ["a fork", fork],
    ["an n-ary merge", merged],
  ] as const;
  const layouts: ReadonlyArray<DagLayoutName> = ["sugiyama", "grid", "zherebko"];

  it("draws the same picture on two runs of every engine", () => {
    for (const layoutName of layouts) {
      for (const [name, timeline] of shapes) {
        const graph = buildPlanGraph(timeline);
        const first = dagLayout(graph, { layout: layoutName });
        const second = dagLayout(graph, { layout: layoutName });
        expect(first, `${layoutName}: ${name}`).toEqual(second);
      }
    }
  });

  it("orients every engine with each child strictly below every parent", () => {
    for (const layoutName of layouts) {
      for (const [name, timeline] of shapes) {
        const graph = buildPlanGraph(timeline);
        const layout = dagLayout(graph, { layout: layoutName });
        for (const node of graph.nodes) {
          const here = layout.positions.get(node.commitId)!;
          for (const parentId of node.parents) {
            expect(
              here.y,
              `${layoutName}: ${name}: ${node.commitId} below ${parentId}`,
            ).toBeGreaterThan(layout.positions.get(parentId)!.y);
          }
        }
      }
    }
  });

  it("keeps each native polyline attached to its endpoint nodes", () => {
    for (const layoutName of layouts) {
      for (const [name, timeline] of shapes) {
        const layout = dagLayout(buildPlanGraph(timeline), { layout: layoutName });
        for (const edge of layout.edges) {
          expect(edge.points[0], `${layoutName}: ${name}: source`).toEqual(
            layout.positions.get(edge.fromCommitId),
          );
          expect(edge.points.at(-1), `${layoutName}: ${name}: target`).toEqual(
            layout.positions.get(edge.toCommitId),
          );
        }
      }
    }
  });

  it("runs the selected engine", () => {
    const graph = buildPlanGraph(merged);
    const arrangements = layouts.map((layoutName) =>
      JSON.stringify(
        dagLayout(graph, { layout: layoutName }).nodes.map(({ commitId, x, y }) => [
          commitId,
          x,
          y,
        ]),
      ),
    );
    expect(new Set(arrangements).size).toBe(layouts.length);
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

  it("names the repository on a split revision", () => {
    const revision: PlanTimelineItem = {
      _tag: "plan-revision",
      commitId: id("split"),
      sequence: 2,
      parents: [id("a")],
      published: false,
      authorKind: "human",
      createdAt: "2026-08-03T00:00:00.000Z",
      split: {
        repositoryId: MercurianRepositoryId.make("repo-server"),
        repositoryName: "server",
      },
    };
    expect(planCommitSummary(revision)).toBe("Split for server");
  });
});

describe("planCommitDetail", () => {
  it("keeps a message's complete text", () => {
    const text = `First line\n\n${"full detail ".repeat(20)}`;
    expect(planCommitDetail(commit("a", 1, [], { text }))).toBe(text);
  });

  it("includes an imported issue's title and description", () => {
    const issue: PlanTimelineItem = {
      _tag: "issue-revision",
      commitId: id("issue"),
      sequence: 1,
      parents: [],
      published: true,
      authorKind: "human",
      title: "Keep both parts",
      description: "The complete issue description.\nIncluding its second line.",
      createdAt: "2026-08-03T00:00:00.000Z",
    };
    expect(planCommitDetail(issue)).toBe(
      "Keep both parts\n\nThe complete issue description.\nIncluding its second line.",
    );
  });

  it("uses the existing summary line for a plan revision", () => {
    const revision: PlanTimelineItem = {
      _tag: "plan-revision",
      commitId: id("rev"),
      sequence: 2,
      parents: [id("a")],
      published: false,
      authorKind: "assistant",
      createdAt: "2026-08-03T00:00:00.000Z",
    };
    expect(planCommitDetail(revision)).toBe("The assistant revised the plan");
  });
});
