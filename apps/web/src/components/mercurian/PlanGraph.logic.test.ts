import { describe, expect, it } from "vite-plus/test";
import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { buildPlanGraph, effectivePlanExplorerView } from "./PlanGraph.logic";

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

describe("web plan graph layout", () => {
  it("keeps fork-dependent explorer presentation in the web half", () => {
    expect(effectivePlanExplorerView(buildPlanGraph(chain), "columns")).toBe("thread");
    expect(effectivePlanExplorerView(buildPlanGraph(fork), "columns")).toBe("columns");
    expect(effectivePlanExplorerView(buildPlanGraph(chain), "graph")).toBe("graph");
  });
});
