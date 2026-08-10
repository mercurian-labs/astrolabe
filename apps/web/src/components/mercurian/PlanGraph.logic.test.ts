import { describe, expect, it } from "vite-plus/test";

import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import {
  ancestorClosure,
  buildPlanGraph,
  planCommitSummary,
  spatialLayout,
  SPATIAL_MAX_SIMULATED_NODES,
  SPATIAL_MIN_SEPARATION,
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
    expect(spatialLayout(graph).nodes).toEqual([]);
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

describe("spatialLayout", () => {
  const shapes = [
    ["a chain", chain],
    ["a fork", fork],
    ["an n-ary merge", merged],
  ] as const;

  it("draws the same picture every time it is asked", () => {
    // The whole reason positions are seeded from commit ids: a map that
    // rearranged itself on every open would be a different map every time.
    for (const [name, timeline] of shapes) {
      const graph = buildPlanGraph(timeline);
      const first = spatialLayout(graph);
      const second = spatialLayout(graph);
      expect(first.nodes, name).toEqual(second.nodes);
      expect(first.bounds, name).toEqual(second.bounds);
    }
  });

  it("orders the flow axis along ancestry, strictly", () => {
    // Every child beyond every parent — this is what keeps the map reading as
    // root-to-tips flow instead of a hairball.
    for (const [name, timeline] of shapes) {
      const graph = buildPlanGraph(timeline);
      const layout = spatialLayout(graph);
      for (const node of graph.nodes) {
        const here = layout.positions.get(node.commitId)!;
        for (const parentId of node.parents) {
          expect(here.y, `${name}: ${node.commitId} below ${parentId}`).toBeGreaterThan(
            layout.positions.get(parentId)!.y,
          );
        }
      }
    }
  });

  it("keeps every pair of nodes apart", () => {
    for (const [name, timeline] of shapes) {
      const layout = spatialLayout(buildPlanGraph(timeline));
      for (const [index, node] of layout.nodes.entries()) {
        for (const other of layout.nodes.slice(index + 1)) {
          const distance = Math.hypot(node.x - other.x, node.y - other.y);
          expect(distance, `${name}: ${node.commitId} vs ${other.commitId}`).toBeGreaterThanOrEqual(
            SPATIAL_MIN_SEPARATION - 0.01,
          );
        }
      }
    }
  });

  it("drifts locally when a commit lands, instead of re-solving the map", () => {
    const before = spatialLayout(buildPlanGraph(merged));
    const grown = spatialLayout(
      buildPlanGraph([...merged, commit("leaf", 8, ["after"])]),
      before.positions,
    );

    for (const node of before.nodes) {
      const moved = grown.positions.get(node.commitId)!;
      expect(
        Math.hypot(moved.x - node.x, moved.y - node.y),
        `${node.commitId} stayed put`,
      ).toBeLessThan(SPATIAL_MIN_SEPARATION);
    }
    // And the newcomer landed near where it came from, not off in the seed field.
    const anchor = grown.positions.get(id("after"))!;
    const leaf = grown.positions.get(id("leaf"))!;
    expect(Math.hypot(leaf.x - anchor.x, leaf.y - anchor.y)).toBeLessThan(200);
  });

  it("falls back to the time axis past the simulation cap", () => {
    const long = Array.from({ length: SPATIAL_MAX_SIMULATED_NODES + 1 }, (_, index) =>
      commit(`c${index}`, index + 1, index === 0 ? [] : [`c${index - 1}`]),
    );
    const layout = spatialLayout(buildPlanGraph(long));
    expect(layout.simulated).toBe(false);
    expect(layout.nodes).toHaveLength(long.length);
    // Degraded to a legible column, not to a stall or a pile.
    for (const [index, node] of layout.nodes.entries()) {
      if (index === 0) continue;
      expect(node.y).toBeGreaterThan(layout.nodes[index - 1]!.y);
    }
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
