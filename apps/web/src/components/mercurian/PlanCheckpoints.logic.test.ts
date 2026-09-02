import { describe, expect, it } from "vite-plus/test";

import {
  at,
  codingSessionLeaf,
  commitId as id,
  message,
  planRevision,
  specRevision,
} from "../../test/fixtures/timeline";

import { columnLayout, defaultBranchChoices } from "./PlanColumns.logic";
import {
  codingSessionEffects,
  condensePlanGraph,
  isUnansweredCheckpointInFlight,
  mapMarksToNodes,
  planCheckpointEffectLabel,
  planNodeDetail,
  planNodeIdForCommit,
  planNodeStatusDots,
  planNodeSummary,
} from "./PlanCheckpoints.logic";
import { buildPlanGraph } from "./PlanGraph.logic";
import { threadLayout } from "./PlanThread.logic";
import { planCodingSessionRecord } from "../../test/fixtures/sessionsAndSplits";

describe("condensePlanGraph", () => {
  it("condenses a settled turn onto its terminal response in real member order", () => {
    const graph = condensePlanGraph(
      buildPlanGraph([
        message("query", { text: "Build the explorer" }),
        planRevision("plan", { sequence: 2, parents: ["query"], authorKind: "assistant" }),
        specRevision("spec", { sequence: 3, parents: ["plan"], authorKind: "assistant" }),
        message("response", {
          sequence: 4,
          parents: ["spec"],
          authorKind: "assistant",
          text: "Done",
        }),
      ]),
    );

    expect(graph.nodes.map((node) => node.commitId)).toEqual(["response"]);
    const checkpoint = graph.byId.get("response")?.checkpoint;
    expect(checkpoint?.query.commitId).toBe("query");
    expect(checkpoint?.revisions.map((revision) => revision.commitId)).toEqual(["plan", "spec"]);
    expect(checkpoint?.response?.commitId).toBe("response");
    expect(checkpoint?.effects).toEqual(["plan-updated", "spec-updated"]);
    expect(graph.byId.get("response")?.item).toMatchObject({
      commitId: "response",
      sequence: 4,
      createdAt: at(4),
    });
    expect([...graph.nodeIdByCommit]).toEqual([
      ["query", "response"],
      ["plan", "response"],
      ["spec", "response"],
      ["response", "response"],
    ]);
  });

  it("groups interrupted terminals, including a bare stopped reply", () => {
    const revised = condensePlanGraph(
      buildPlanGraph([
        message("query"),
        planRevision("plan", { sequence: 2, parents: ["query"], authorKind: "assistant" }),
        message("response", {
          sequence: 3,
          parents: ["plan"],
          authorKind: "assistant",
          text: "Partial",
          interrupted: true,
        }),
      ]),
    );
    expect(revised.byId.get("response")?.checkpoint?.effects).toEqual([
      "plan-updated",
      "interrupted",
    ]);

    const bare = condensePlanGraph(
      buildPlanGraph([
        message("bare-query"),
        message("bare-response", {
          sequence: 2,
          parents: ["bare-query"],
          authorKind: "assistant",
          text: "",
          interrupted: true,
        }),
      ]),
    );
    expect(bare.nodes.map((node) => node.commitId)).toEqual(["bare-response"]);
    expect(bare.byId.get("bare-response")?.checkpoint).toMatchObject({
      query: { commitId: "bare-query" },
      response: { commitId: "bare-response", text: "", interrupted: true },
      effects: ["interrupted"],
    });
  });

  it("marks an unanswered query, except while its descendant chain is in flight", () => {
    const commitGraph = buildPlanGraph([
      message("query"),
      planRevision("landed", { sequence: 2, parents: ["query"], authorKind: "assistant" }),
    ]);
    const graph = condensePlanGraph(commitGraph);
    const checkpoint = graph.byId.get("landed")!;

    expect(checkpoint.checkpoint?.effects).toEqual(["plan-updated", "unanswered"]);
    expect(planNodeDetail(checkpoint, true)).toContain("Plan updated");
    expect(planNodeDetail(checkpoint, true)).not.toContain("Unanswered");
    expect(isUnansweredCheckpointInFlight(checkpoint, commitGraph, [id("query")])).toBe(true);
    expect(isUnansweredCheckpointInFlight(checkpoint, commitGraph, [id("landed")])).toBe(true);
    expect(isUnansweredCheckpointInFlight(checkpoint, commitGraph, [id("elsewhere")])).toBe(false);
  });

  it("leaves direct edits, imports, refreshes, splits, merges, and ambiguous turns standalone", () => {
    const directPlan = planRevision("direct-plan");
    const refreshedSpec = specRevision("refresh", {
      sequence: 2,
      parents: ["direct-plan"],
      cause: "refresh",
    });
    const importedSpec = specRevision("import", {
      sequence: 3,
      parents: ["refresh"],
      cause: "import",
    });
    const split = planRevision("split", {
      sequence: 4,
      parents: ["import"],
      split: { repositoryId: "repo-web", repositoryName: "web" },
    });
    const otherRoot = planRevision("other-root", { sequence: 5 });
    const mergeMessage = message("merge", {
      sequence: 6,
      parents: ["split", "other-root"],
    });
    const ambiguous = message("ambiguous", { sequence: 7, parents: ["merge"] });
    const replyA = message("reply-a", {
      sequence: 8,
      parents: ["ambiguous"],
      authorKind: "assistant",
    });
    const replyB = message("reply-b", {
      sequence: 9,
      parents: ["ambiguous"],
      authorKind: "assistant",
    });
    const graph = condensePlanGraph(
      buildPlanGraph([
        directPlan,
        refreshedSpec,
        importedSpec,
        split,
        otherRoot,
        mergeMessage,
        ambiguous,
        replyA,
        replyB,
      ]),
    );

    expect(graph.nodes.map((node) => node.commitId)).toEqual([
      "direct-plan",
      "refresh",
      "import",
      "split",
      "other-root",
      "merge",
      "ambiguous",
      "reply-a",
      "reply-b",
    ]);
    for (const commitId of ["direct-plan", "refresh", "import", "split", "merge", "ambiguous"]) {
      expect(graph.byId.get(commitId)?.checkpoint).toBeUndefined();
    }
    expect(graph.byId.get("merge")?.isMerge).toBe(true);
    expect(graph.byId.get("ambiguous")?.isBranchPoint).toBe(true);
  });

  it("condenses a terminal-less revision chain onto its last landed member", () => {
    const graph = condensePlanGraph(
      buildPlanGraph([
        message("query"),
        planRevision("plan", { sequence: 2, parents: ["query"], authorKind: "assistant" }),
        specRevision("spec", { sequence: 3, parents: ["plan"], authorKind: "assistant" }),
      ]),
    );
    const node = graph.byId.get("spec");

    expect(graph.nodes.map((candidate) => candidate.commitId)).toEqual(["spec"]);
    expect(node?.item).toMatchObject({
      commitId: "spec",
      sequence: 3,
      createdAt: at(3),
      published: false,
    });
    expect(node?.checkpoint?.query.commitId).toBe("query");
    expect(node?.checkpoint?.revisions.map((revision) => revision.commitId)).toEqual([
      "plan",
      "spec",
    ]);
    expect(node?.checkpoint?.response).toBeUndefined();
    expect(node?.checkpoint?.effects).toEqual(["plan-updated", "spec-updated", "unanswered"]);
    expect([...graph.nodeIdByCommit]).toEqual([
      ["query", "spec"],
      ["plan", "spec"],
      ["spec", "spec"],
    ]);
  });

  it("reanchors an interior fork and remains coherent in thread and column layouts", () => {
    const graph = condensePlanGraph(
      buildPlanGraph([
        message("query"),
        planRevision("plan", { sequence: 2, parents: ["query"], authorKind: "assistant" }),
        message("response", { sequence: 3, parents: ["plan"], authorKind: "assistant" }),
        message("fork", { sequence: 4, parents: ["plan"] }),
        message("main", { sequence: 5, parents: ["response"] }),
      ]),
    );

    expect(graph.byId.get("fork")?.parents).toEqual(["response"]);
    expect(graph.byId.get("response")?.childrenIds).toEqual(["fork", "main"]);
    expect(graph.byId.get("response")?.isBranchPoint).toBe(true);

    const threadIds = threadLayout(graph, id("fork"), new Map()).rows.map((row) => row.commitId);
    expect(threadIds).toEqual(["response", "fork"]);
    expect(new Set(threadIds).size).toBe(threadIds.length);

    const columns = columnLayout(graph, id("fork"), defaultBranchChoices(graph, id("fork")));
    const columnIds = columns.panes.flatMap((pane) => pane.rows.map((row) => row.commitId));
    expect(columnIds).toEqual(threadIds);
    expect(new Set(columnIds).size).toBe(columnIds.length);
  });

  it("reanchors a fork from a trailing revision and remains coherent in layouts", () => {
    const graph = condensePlanGraph(
      buildPlanGraph([
        message("query"),
        planRevision("plan", { sequence: 2, parents: ["query"], authorKind: "assistant" }),
        specRevision("spec", { sequence: 3, parents: ["plan"], authorKind: "assistant" }),
        message("fork", { sequence: 4, parents: ["spec"] }),
        message("main", { sequence: 5, parents: ["spec"] }),
      ]),
    );

    expect(graph.byId.get("fork")?.parents).toEqual(["spec"]);
    expect(graph.byId.get("spec")?.childrenIds).toEqual(["fork", "main"]);
    expect(graph.byId.get("spec")?.isBranchPoint).toBe(true);

    const threadIds = threadLayout(graph, id("fork"), new Map()).rows.map((row) => row.commitId);
    expect(threadIds).toEqual(["spec", "fork"]);
    expect(new Set(threadIds).size).toBe(threadIds.length);

    const columns = columnLayout(graph, id("fork"), defaultBranchChoices(graph, id("fork")));
    const columnIds = columns.panes.flatMap((pane) => pane.rows.map((row) => row.commitId));
    expect(columnIds).toEqual(threadIds);
    expect(new Set(columnIds).size).toBe(columnIds.length);
  });

  it("derives artifact effects only from landed revision commits", () => {
    const graph = condensePlanGraph(
      buildPlanGraph([
        message("query", { text: "Update both artifacts" }),
        message("response", {
          sequence: 2,
          parents: ["query"],
          authorKind: "assistant",
          text: "I updated the plan and spec, trust me.",
        }),
      ]),
    );
    const node = graph.byId.get("response")!;

    expect(node.checkpoint?.effects).toEqual([]);
    expect(planNodeSummary(node)).toBe("Update both artifacts");
    expect(planNodeDetail(node)).toContain("Assistant: I updated the plan and spec, trust me.");
    expect(planNodeDetail(node)).not.toContain("Plan updated");
    expect(planNodeDetail(node)).not.toContain("Spec updated");
  });

  it("maps trailing revision marks and current positions to the forming checkpoint", () => {
    const graph = condensePlanGraph(
      buildPlanGraph([
        message("query"),
        planRevision("plan", { sequence: 2, parents: ["query"], authorKind: "assistant" }),
        specRevision("spec", { sequence: 3, parents: ["plan"], authorKind: "assistant" }),
      ]),
    );

    expect(mapMarksToNodes(new Set(["plan"]), graph.nodeIdByCommit)).toEqual(new Set(["spec"]));
    expect(planNodeIdForCommit(id("plan"), graph.nodeIdByCommit)).toBe("spec");
    expect(planNodeIdForCommit(id("spec"), graph.nodeIdByCommit)).toBe("spec");
    expect(planNodeIdForCommit(id("query"), graph.nodeIdByCommit)).toBe("spec");
    expect(planNodeIdForCommit(id("missing"), graph.nodeIdByCommit)).toBe("missing");
  });

  it("never absorbs a coding-session leaf into a conversational checkpoint", () => {
    const session = codingSessionLeaf("session", {
      sequence: 2,
      parents: ["query"],
      createdAt: at(2),
      repositoryId: "repo-web",
      repositoryName: "web",
      planRevisionCommitId: "query",
    });
    const graph = condensePlanGraph(buildPlanGraph([message("query"), session]));

    expect(graph.nodes.map((node) => node.commitId)).toEqual(["query", "session"]);
    expect(graph.byId.get("query")?.checkpoint?.effects).toEqual(["unanswered"]);
    expect(graph.byId.get("session")?.checkpoint).toBeUndefined();
  });
});

describe("coding-session checkpoint effects", () => {
  it("derives partial and departed marks only from the mutable session record", () => {
    expect(
      codingSessionEffects(
        planCodingSessionRecord("both", { partial: true, departedRef: "feature/detour" }),
      ),
    ).toEqual(["partial", "departed"]);
    expect(
      codingSessionEffects(
        planCodingSessionRecord("departed", { partial: false, departedRef: "feature/detour" }),
      ),
    ).toEqual(["departed"]);
    expect(
      codingSessionEffects(
        planCodingSessionRecord("neither", { partial: false, departedRef: null }),
      ),
    ).toEqual([]);
    expect(planCheckpointEffectLabel("departed")).toBe("Departed");
  });
});

describe("planNodeStatusDots", () => {
  it("orders readiness before spec and plan staleness with their status colors", () => {
    expect(planNodeStatusDots({ ready: true, staleSpec: true, stalePlan: true })).toEqual([
      { key: "ready", fillClass: "fill-emerald-500" },
      { key: "stale-spec", fillClass: "fill-amber-500" },
      { key: "stale-plan", fillClass: "fill-orange-500" },
    ]);
  });

  it("returns only applicable marks and none for an unmarked node", () => {
    expect(planNodeStatusDots({ ready: false, staleSpec: true, stalePlan: false })).toEqual([
      { key: "stale-spec", fillClass: "fill-amber-500" },
    ]);
    expect(planNodeStatusDots({ ready: false, staleSpec: false, stalePlan: false })).toEqual([]);
  });
});
