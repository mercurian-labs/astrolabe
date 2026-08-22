import {
  MercurianRepositoryId,
  ProviderDriverKind,
  type PlanCodingSessionRecord,
  type PlanningModelSelection,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { planCodingSessionRecord } from "../../../../apps/web/src/test/fixtures/sessionsAndSplits.ts";
import {
  at,
  codingSessionLeaf,
  commitId as id,
  message,
  planRevision,
  specRevision,
} from "../../../../apps/web/src/test/fixtures/timeline.ts";

import { condensePlanGraph } from "./planCheckpoints.ts";
import { buildPlanGraph } from "./planGraph.ts";
import {
  codingSessionStatus,
  derivePlanNodePopover,
  modelSwitchFor,
  offeredActs,
  planMovedPastSplit,
  resolveImplementFrom,
} from "./planNodePopover.ts";

const model = (provider: string, name: string): PlanningModelSelection => ({
  provider: ProviderDriverKind.make(provider),
  model: name,
});
const commit = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  authorKind: "human" | "assistant",
  options: {
    readonly text?: string;
    readonly ranUnder?: PlanningModelSelection;
    readonly generatedBy?: PlanningModelSelection;
  } = {},
): PlanTimelineItem =>
  message(name, {
    sequence,
    parents,
    authorKind,
    createdAt: at(sequence),
    text: options.text ?? name,
    ...(options.ranUnder === undefined ? {} : { ranUnder: options.ranUnder }),
    ...(options.generatedBy === undefined ? {} : { generatedBy: options.generatedBy }),
  });
const revision = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  split = false,
): PlanTimelineItem =>
  planRevision(name, {
    sequence,
    parents,
    authorKind: "assistant",
    createdAt: at(sequence),
    ...(split
      ? {
          split: { repositoryId: "repo-web", repositoryName: "web" },
        }
      : {}),
  });

describe("modelSwitchFor", () => {
  it("compares the nearest ancestor recorded turn and crosses interior commits", () => {
    const graph = buildPlanGraph([
      commit("old-query", 1, [], "human", { ranUnder: model("claude", "sonnet") }),
      revision("old-plan", 2, ["old-query"]),
      commit("old-response", 3, ["old-plan"], "assistant"),
      revision("between", 4, ["old-response"]),
      commit("new-query", 5, ["between"], "human", { ranUnder: model("codex", "gpt-5") }),
    ]);

    expect(modelSwitchFor(graph, id("new-query"))).toEqual(model("claude", "sonnet"));
  });

  it("returns no switch without an ancestor record or for the same pair", () => {
    const none = buildPlanGraph([
      commit("bare", 1, [], "human"),
      commit("next", 2, ["bare"], "human", { ranUnder: model("codex", "gpt-5") }),
    ]);
    const same = buildPlanGraph([
      commit("old", 1, [], "human", { ranUnder: model("codex", "gpt-5") }),
      commit("new", 2, ["old"], "human", { ranUnder: model("codex", "gpt-5") }),
    ]);
    expect(modelSwitchFor(none, id("next"))).toBeNull();
    expect(modelSwitchFor(same, id("new"))).toBeNull();
  });

  it("detects either a provider or model change", () => {
    const provider = buildPlanGraph([
      commit("p-old", 1, [], "human", { ranUnder: model("claude", "same") }),
      commit("p-new", 2, ["p-old"], "human", { ranUnder: model("codex", "same") }),
    ]);
    const modelChange = buildPlanGraph([
      commit("m-old", 1, [], "human", { ranUnder: model("codex", "old") }),
      commit("m-new", 2, ["m-old"], "human", { ranUnder: model("codex", "new") }),
    ]);
    expect(modelSwitchFor(provider, id("p-new"))).toEqual(model("claude", "same"));
    expect(modelSwitchFor(modelChange, id("m-new"))).toEqual(model("codex", "old"));
  });
});

describe("planMovedPastSplit", () => {
  it("is true only when the parent line has a non-projection child", () => {
    const moved = buildPlanGraph([
      commit("parent", 1, [], "human"),
      revision("split", 2, ["parent"], true),
      commit("continued", 3, ["parent"], "human"),
    ]);
    const projectionsOnly = buildPlanGraph([
      commit("only-parent", 1, [], "human"),
      revision("first-split", 2, ["only-parent"], true),
      revision("second-split", 3, ["only-parent"], true),
    ]);
    const missingParent = buildPlanGraph([revision("orphan-split", 1, ["missing"], true)]);

    expect(planMovedPastSplit(moved, id("split"))).toBe(true);
    expect(planMovedPastSplit(projectionsOnly, id("first-split"))).toBe(false);
    expect(planMovedPastSplit(missingParent, id("orphan-split"))).toBe(false);
  });
});

describe("derivePlanNodePopover", () => {
  it("derives a turn from recorded commits, including models, warnings, and readiness", () => {
    const commitGraph = buildPlanGraph([
      commit("old", 1, [], "human", { ranUnder: model("claude", "sonnet") }),
      commit("query", 2, ["old"], "human", {
        text: "Update both",
        ranUnder: model("codex", "gpt-5"),
      }),
      revision("plan", 3, ["query"]),
      commit("response", 4, ["plan"], "assistant", {
        text: "Done",
        generatedBy: model("codex", "gpt-5"),
      }),
    ]);
    const node = condensePlanGraph(commitGraph).byId.get("response")!;
    const reading = derivePlanNodePopover({
      node,
      commitGraph,
      codingSessions: [],
      ready: {
        commitId: id("response"),
        repositoryId: MercurianRepositoryId.make("repo-web"),
        repositoryName: "web",
      },
      stalePlan: true,
      staleSpec: true,
      suppressUnanswered: false,
    });

    expect(reading).toMatchObject({
      kind: "turn",
      label: "Update both",
      queryText: "Update both",
      responseExcerpt: "Done",
      effects: ["Plan updated"],
      modelSwitch: model("claude", "sonnet"),
      stalePlan: true,
      staleSpec: true,
      ready: { repositoryName: "web" },
      acts: ["continue", "edit-and-branch", "implement"],
    });
    expect(reading.query?.ranUnder).toEqual(model("codex", "gpt-5"));
    expect(reading.response?.generatedBy).toEqual(model("codex", "gpt-5"));
  });

  it("never infers effects from response prose and suppresses in-flight unanswered", () => {
    const proseGraph = buildPlanGraph([
      commit("prose-query", 1, [], "human"),
      commit("prose-response", 2, ["prose-query"], "assistant", {
        text: "I updated the plan",
      }),
    ]);
    const prose = derivePlanNodePopover({
      node: condensePlanGraph(proseGraph).byId.get("prose-response")!,
      commitGraph: proseGraph,
      codingSessions: [],
      stalePlan: false,
      staleSpec: false,
      suppressUnanswered: false,
    });
    const inFlightGraph = buildPlanGraph([commit("in-flight", 1, [], "human")]);
    const inFlight = derivePlanNodePopover({
      node: condensePlanGraph(inFlightGraph).byId.get("in-flight")!,
      commitGraph: inFlightGraph,
      codingSessions: [],
      stalePlan: false,
      staleSpec: false,
      suppressUnanswered: true,
    });
    expect(prose.effects).toEqual([]);
    expect(inFlight.effects).toEqual([]);
  });

  it("names repository projections and their moved-past warning", () => {
    const commitGraph = buildPlanGraph([
      commit("parent", 1, [], "human"),
      { ...revision("split", 2, ["parent"], true), authorKind: "human" },
      commit("continued", 3, ["parent"], "human"),
    ]);
    const reading = derivePlanNodePopover({
      node: condensePlanGraph(commitGraph).byId.get("split")!,
      commitGraph,
      codingSessions: [],
      stalePlan: false,
      staleSpec: false,
      suppressUnanswered: false,
    });
    expect(reading.label).toBe("Plan for web");
    expect(reading.movedPastPlan).toBe(true);
    expect(reading.movedPastRepositoryName).toBe("web");
  });

  it("names spec refresh causes", () => {
    const spec = specRevision("spec", {
      cause: "refresh",
      issueId: "M-12",
    });
    const graph = buildPlanGraph([spec]);
    const reading = derivePlanNodePopover({
      node: graph.nodes[0]!,
      commitGraph: graph,
      codingSessions: [],
      stalePlan: false,
      staleSpec: false,
      suppressUnanswered: false,
    });
    expect(reading.label).toBe("Spec refreshed from M-12");
  });
});

describe("offeredActs", () => {
  it("offers branch editing only for non-root human queries and limits session leaves", () => {
    const graph = buildPlanGraph([
      commit("root", 1, [], "human"),
      commit("query", 2, ["root"], "human"),
      commit("response", 3, ["query"], "assistant"),
      revision("standalone", 4, ["response"]),
      codingSessionLeaf("session", {
        sequence: 5,
        parents: ["standalone"],
        createdAt: at(5),
        repositoryId: "repo-web",
        repositoryName: "web",
        planRevisionCommitId: "standalone",
      }),
    ]);
    const condensed = condensePlanGraph(graph);

    expect(offeredActs(condensed.byId.get("root")!, graph)).toEqual(["continue", "implement"]);
    expect(offeredActs(condensed.byId.get("response")!, graph)).toEqual([
      "continue",
      "edit-and-branch",
      "implement",
    ]);
    expect(offeredActs(condensed.byId.get("standalone")!, graph)).toEqual([
      "continue",
      "implement",
    ]);
    expect(offeredActs(condensed.byId.get("session")!, graph)).toEqual(["continue"]);
    expect(offeredActs(condensed.byId.get("session")!, graph, true)).toEqual([
      "continue",
      "open-session",
    ]);
  });
});

describe("coding-session facts", () => {
  const leaf = codingSessionLeaf("session", {
    sequence: 2,
    parents: ["plan"],
    createdAt: at(2),
    repositoryId: "repo-web",
    repositoryName: "web",
    planRevisionCommitId: "plan",
  });
  const record = (outcome: PlanCodingSessionRecord["outcome"], endedAt: string | null) =>
    planCodingSessionRecord("session", {
      repositoryId: "repo-web",
      threadId: "thread",
      branch: "feature/checkpoints",
      worktreePath: "/tmp/worktree",
      baseRef: "main",
      startedAt: at(2),
      endedAt,
      outcome,
      prUrl: "https://example.com/pr/1",
    });

  it("uses the shared four-state wording", () => {
    expect(codingSessionStatus(record(null, null))).toBe("Running");
    expect(codingSessionStatus(record("completed", at(3)))).toBe("Completed");
    expect(codingSessionStatus(record("stopped", at(3)))).toBe("Stopped");
    expect(codingSessionStatus(record("failed", at(3)))).toBe("Ended");
  });

  it("shows mutable facts when present and immutable facts when they lag", () => {
    const graph = buildPlanGraph([revision("plan", 1, []), leaf]);
    const withRecord = derivePlanNodePopover({
      node: graph.byId.get("session")!,
      commitGraph: graph,
      codingSessions: [record(null, null)],
      stalePlan: false,
      staleSpec: false,
      suppressUnanswered: false,
    });
    const withoutRecord = derivePlanNodePopover({
      node: graph.byId.get("session")!,
      commitGraph: graph,
      codingSessions: [],
      stalePlan: false,
      staleSpec: false,
      suppressUnanswered: false,
    });
    expect(withRecord.session).toEqual({
      repositoryName: "web",
      planRevisionCommitId: "plan",
      status: "Running",
      branch: "feature/checkpoints",
      threadId: "thread",
      prUrl: "https://example.com/pr/1",
    });
    expect(withoutRecord.session).toEqual({
      repositoryName: "web",
      planRevisionCommitId: "plan",
    });
    expect(withRecord.acts).toEqual(["continue", "open-session"]);
    expect(withoutRecord.acts).toEqual(["continue"]);
  });

  it("resolves implementation from a session leaf through its parent line", () => {
    const graph = buildPlanGraph([revision("plan", 1, []), leaf]);
    expect(resolveImplementFrom(graph, id("plan"))).toBe("plan");
    expect(resolveImplementFrom(graph, id("session"))).toBe("plan");
  });
});
