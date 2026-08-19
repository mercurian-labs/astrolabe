import { describe, expect, it } from "vite-plus/test";

import {
  MercurianCommitId,
  MercurianRepositoryId,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import { columnLayout, defaultBranchChoices } from "./PlanColumns.logic";
import {
  condensePlanGraph,
  isUnansweredCheckpointInFlight,
  mapMarksToNodes,
  planNodeDetail,
  planNodeIdForCommit,
  planNodeKindColor,
  planNodeSummary,
} from "./PlanCheckpoints.logic";
import { buildPlanGraph, type PlanGraphNode } from "./PlanGraph.logic";
import { threadLayout } from "./PlanThread.logic";

const id = (value: string) => MercurianCommitId.make(value);
const at = (sequence: number) => `2026-08-18T00:${sequence.toString().padStart(2, "0")}:00.000Z`;

const message = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  authorKind: "human" | "assistant",
  text = name,
  interrupted = false,
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind,
  createdAt: at(sequence),
  text,
  ...(interrupted ? { interrupted: true } : {}),
});

const planRevision = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  authorKind: "human" | "assistant",
  split = false,
): PlanTimelineItem => ({
  _tag: "plan-revision",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind,
  createdAt: at(sequence),
  ...(split
    ? {
        split: {
          repositoryId: MercurianRepositoryId.make("repo-web"),
          repositoryName: "web",
        },
      }
    : {}),
});

const specRevision = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  authorKind: "human" | "assistant",
  cause: "direct" | "refresh" | "import" | "reconciliation" = "direct",
): PlanTimelineItem => ({
  _tag: "spec-revision",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind,
  createdAt: at(sequence),
  cause,
});

describe("condensePlanGraph", () => {
  it("condenses a settled turn onto its terminal response in real member order", () => {
    const graph = condensePlanGraph(
      buildPlanGraph([
        message("query", 1, [], "human", "Build the explorer"),
        planRevision("plan", 2, ["query"], "assistant"),
        specRevision("spec", 3, ["plan"], "assistant"),
        message("response", 4, ["spec"], "assistant", "Done"),
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
        message("query", 1, [], "human"),
        planRevision("plan", 2, ["query"], "assistant"),
        message("response", 3, ["plan"], "assistant", "Partial", true),
      ]),
    );
    expect(revised.byId.get("response")?.checkpoint?.effects).toEqual([
      "plan-updated",
      "interrupted",
    ]);

    const bare = condensePlanGraph(
      buildPlanGraph([
        message("bare-query", 1, [], "human"),
        message("bare-response", 2, ["bare-query"], "assistant", "", true),
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
      message("query", 1, [], "human"),
      planRevision("landed", 2, ["query"], "assistant"),
    ]);
    const graph = condensePlanGraph(commitGraph);
    const checkpoint = graph.byId.get("landed")!;

    expect(checkpoint.checkpoint?.effects).toEqual(["plan-updated", "unanswered"]);
    expect(planNodeDetail(checkpoint, true)).toContain("Plan updated");
    expect(planNodeDetail(checkpoint, true)).not.toContain("Unanswered");
    expect(isUnansweredCheckpointInFlight(checkpoint, commitGraph, id("query"))).toBe(true);
    expect(isUnansweredCheckpointInFlight(checkpoint, commitGraph, id("landed"))).toBe(true);
    expect(isUnansweredCheckpointInFlight(checkpoint, commitGraph, id("elsewhere"))).toBe(false);
  });

  it("leaves direct edits, imports, refreshes, splits, merges, and ambiguous turns standalone", () => {
    const directPlan = planRevision("direct-plan", 1, [], "human");
    const refreshedSpec = specRevision("refresh", 2, ["direct-plan"], "human", "refresh");
    const importedSpec = specRevision("import", 3, ["refresh"], "human", "import");
    const split = planRevision("split", 4, ["import"], "human", true);
    const otherRoot = planRevision("other-root", 5, [], "human");
    const mergeMessage = message("merge", 6, ["split", "other-root"], "human");
    const ambiguous = message("ambiguous", 7, ["merge"], "human");
    const replyA = message("reply-a", 8, ["ambiguous"], "assistant");
    const replyB = message("reply-b", 9, ["ambiguous"], "assistant");
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
        message("query", 1, [], "human"),
        planRevision("plan", 2, ["query"], "assistant"),
        specRevision("spec", 3, ["plan"], "assistant"),
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
        message("query", 1, [], "human"),
        planRevision("plan", 2, ["query"], "assistant"),
        message("response", 3, ["plan"], "assistant"),
        message("fork", 4, ["plan"], "human"),
        message("main", 5, ["response"], "human"),
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
        message("query", 1, [], "human"),
        planRevision("plan", 2, ["query"], "assistant"),
        specRevision("spec", 3, ["plan"], "assistant"),
        message("fork", 4, ["spec"], "human"),
        message("main", 5, ["spec"], "human"),
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
        message("query", 1, [], "human", "Update both artifacts"),
        message("response", 2, ["query"], "assistant", "I updated the plan and spec, trust me."),
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
        message("query", 1, [], "human"),
        planRevision("plan", 2, ["query"], "assistant"),
        specRevision("spec", 3, ["plan"], "assistant"),
      ]),
    );

    expect(mapMarksToNodes(new Set(["plan"]), graph.nodeIdByCommit)).toEqual(new Set(["spec"]));
    expect(planNodeIdForCommit(id("plan"), graph.nodeIdByCommit)).toBe("spec");
    expect(planNodeIdForCommit(id("spec"), graph.nodeIdByCommit)).toBe("spec");
    expect(planNodeIdForCommit(id("query"), graph.nodeIdByCommit)).toBe("spec");
    expect(planNodeIdForCommit(id("missing"), graph.nodeIdByCommit)).toBe("missing");
  });

  it("never absorbs a coding-session leaf into a conversational checkpoint", () => {
    const session: PlanTimelineItem = {
      _tag: "coding-session",
      commitId: id("session"),
      sequence: 2,
      parents: [id("query")],
      published: false,
      authorKind: "human",
      createdAt: at(2),
      repositoryId: MercurianRepositoryId.make("repo-web"),
      repositoryName: "web",
      planRevisionCommitId: id("query"),
    };
    const graph = condensePlanGraph(buildPlanGraph([message("query", 1, [], "human"), session]));

    expect(graph.nodes.map((node) => node.commitId)).toEqual(["query", "session"]);
    expect(graph.byId.get("query")?.checkpoint?.effects).toEqual(["unanswered"]);
    expect(graph.byId.get("session")?.checkpoint).toBeUndefined();
  });
});

describe("planNodeKindColor", () => {
  const color = (item: PlanTimelineItem) => planNodeKindColor(buildPlanGraph([item]).nodes[0]!);
  const published = (item: PlanTimelineItem): PlanTimelineItem => ({ ...item, published: true });

  it("colors every checkpoint kind and preserves solid versus hollow standing", () => {
    const turn = message("turn", 1, [], "human");
    const plan = planRevision("plan-color", 1, [], "human");
    const spec = specRevision("spec-color", 1, [], "human");
    const split = planRevision("split-color", 1, [], "human", true);
    const session: PlanTimelineItem = {
      _tag: "coding-session",
      commitId: id("session-color"),
      sequence: 1,
      parents: [],
      published: false,
      authorKind: "human",
      createdAt: at(1),
      repositoryId: MercurianRepositoryId.make("repo-web"),
      repositoryName: "web",
      planRevisionCommitId: id("plan-color"),
    };

    expect(color(turn)).toBe("fill-background stroke-sky-500");
    expect(color(published(turn))).toBe("fill-sky-500 stroke-none");
    expect(color(plan)).toBe("fill-background stroke-violet-500");
    expect(color(published(plan))).toBe("fill-violet-500 stroke-none");
    expect(color(spec)).toBe("fill-background stroke-teal-500");
    expect(color(published(spec))).toBe("fill-teal-500 stroke-none");
    expect(color(split)).toBe("fill-background stroke-emerald-500");
    expect(color(published(split))).toBe("fill-emerald-500 stroke-none");
    expect(color(session)).toBe("fill-background stroke-orange-500");
    expect(color(published(session))).toBe("fill-orange-500 stroke-none");
  });

  it("colors settled and forming turns sky and falls back safely for future kinds", () => {
    const settled = condensePlanGraph(
      buildPlanGraph([
        message("settled-query", 1, [], "human"),
        message("settled-response", 2, ["settled-query"], "assistant"),
      ]),
    ).nodes[0]!;
    const forming = condensePlanGraph(
      buildPlanGraph([
        message("forming-query", 1, [], "human"),
        planRevision("forming-plan", 2, ["forming-query"], "assistant"),
      ]),
    ).nodes[0]!;
    const future = {
      ...buildPlanGraph([message("future", 1, [], "human")]).nodes[0]!,
      item: { ...message("future", 1, [], "human"), _tag: "future-kind" },
    } as unknown as PlanGraphNode;

    expect(planNodeKindColor(settled)).toContain("sky-500");
    expect(planNodeKindColor(forming)).toContain("sky-500");
    expect(planNodeKindColor(future)).toBe("fill-background stroke-muted-foreground");
  });
});
