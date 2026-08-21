import { describe, expect, it } from "@effect/vitest";
import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { buildPlanGraph } from "./planGraph.ts";
import {
  condensePlanGraph,
  isUnansweredCheckpointInFlight,
  mapMarksToNodes,
  planNodeDetail,
  planNodeIdForCommit,
  planNodeSummary,
} from "./planCheckpoints.ts";

const id = (value: string) => MercurianCommitId.make(value);
const at = (sequence: number) => `2026-08-20T00:0${sequence}:00.000Z`;
const message = (
  name: string,
  sequence: number,
  parents: string[],
  authorKind: "human" | "assistant",
  text = name,
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind,
  text,
  createdAt: at(sequence),
});
const revision = (name: string, sequence: number, parents: string[]): PlanTimelineItem => ({
  _tag: "plan-revision",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "assistant",
  createdAt: at(sequence),
});

describe("condensePlanGraph", () => {
  it("condenses a settled turn onto its terminal response and maps every member", () => {
    const graph = condensePlanGraph(
      buildPlanGraph([
        message("query", 1, [], "human", "Build history"),
        revision("plan", 2, ["query"]),
        message("response", 3, ["plan"], "assistant", "Done"),
      ]),
    );
    expect(graph.nodes.map((node) => node.commitId)).toEqual(["response"]);
    expect(graph.byId.get("response")?.checkpoint).toMatchObject({
      query: { commitId: "query" },
      response: { commitId: "response" },
      effects: ["plan-updated"],
    });
    expect([...graph.nodeIdByCommit]).toEqual([
      ["query", "response"],
      ["plan", "response"],
      ["response", "response"],
    ]);
  });

  it("keeps unanswered checkpoints while allowing an in-flight view to suppress the mark", () => {
    const commitGraph = buildPlanGraph([
      message("query", 1, [], "human", "Continue"),
      revision("plan", 2, ["query"]),
    ]);
    const graph = condensePlanGraph(commitGraph);
    const node = graph.byId.get("plan")!;
    expect(node.checkpoint?.effects).toEqual(["plan-updated", "unanswered"]);
    expect(isUnansweredCheckpointInFlight(node, commitGraph, [id("plan")])).toBe(true);
    expect(planNodeDetail(node, true)).not.toContain("Unanswered");
  });

  it("projects marks and exact commits onto their checkpoint identity", () => {
    const graph = condensePlanGraph(
      buildPlanGraph([
        message("query", 1, [], "human"),
        message("response", 2, ["query"], "assistant"),
      ]),
    );
    expect(planNodeIdForCommit(id("query"), graph.nodeIdByCommit)).toBe("response");
    expect([...mapMarksToNodes(["query"], graph.nodeIdByCommit)]).toEqual(["response"]);
    expect(planNodeSummary(graph.byId.get("response")!)).toBe("query");
  });
});
