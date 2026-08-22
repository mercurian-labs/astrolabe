import { describe, expect, it } from "vite-plus/test";
import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import {
  buildPlanGraph,
  dagLayout,
  effectivePlanExplorerView,
  type DagLayoutName,
} from "./PlanGraph.logic";

const id = (value: string) => MercurianCommitId.make(value);
const commit = (name: string, sequence: number, parents: string[]): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "human",
  text: name,
  createdAt: "2026-08-03T00:00:00.000Z",
});
const chain = [commit("a", 1, []), commit("b", 2, ["a"]), commit("c", 3, ["b"])];
const fork = [...chain.slice(0, 2), commit("l", 3, ["b"]), commit("r", 4, ["b"])];
const merged = [...fork, commit("m", 5, ["l", "r"])];
const layouts: ReadonlyArray<DagLayoutName> = ["sugiyama", "grid", "zherebko"];

describe("web plan graph layout", () => {
  it("keeps fork-dependent explorer presentation in the web half", () => {
    expect(effectivePlanExplorerView(buildPlanGraph(chain), "columns")).toBe("thread");
    expect(effectivePlanExplorerView(buildPlanGraph(fork), "columns")).toBe("columns");
    expect(effectivePlanExplorerView(buildPlanGraph(chain), "graph")).toBe("graph");
  });

  it("lays an empty graph out as empty", () => {
    expect(dagLayout(buildPlanGraph([]), { layout: "sugiyama" }).nodes).toEqual([]);
  });

  it("is deterministic and keeps every child below every parent", () => {
    for (const name of layouts) {
      const graph = buildPlanGraph(merged);
      const first = dagLayout(graph, { layout: name });
      expect(dagLayout(graph, { layout: name })).toEqual(first);
      for (const node of graph.nodes) {
        for (const parentId of node.parents) {
          expect(first.positions.get(node.commitId)!.y).toBeGreaterThan(
            first.positions.get(parentId)!.y,
          );
        }
      }
    }
  });

  it("keeps native polylines attached to their endpoint nodes", () => {
    for (const name of layouts) {
      const layout = dagLayout(buildPlanGraph(merged), { layout: name });
      for (const edge of layout.edges) {
        expect(edge.points[0]).toEqual(layout.positions.get(edge.fromCommitId));
        expect(edge.points.at(-1)).toEqual(layout.positions.get(edge.toCommitId));
      }
    }
  });
});
