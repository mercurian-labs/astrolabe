import {
  ProviderDriverKind,
  type PlanCodingSessionRecord,
  type PlanningModelSelection,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { planCodingSessionRecord } from "../../test/fixtures/sessionsAndSplits";
import {
  at,
  codingSessionLeaf,
  commitId as id,
  message,
  planRevision,
  specRevision,
} from "../../test/fixtures/timeline";

import { condensePlanGraph } from "./PlanCheckpoints.logic";
import { buildPlanGraph } from "./PlanGraph.logic";
import { planningModelOptionLabels } from "./PlanningModel.logic";
import {
  branchMovementLabel,
  codingSessionStatus,
  derivePlanNodePopover,
  modelSwitchFor,
  offeredActs,
  planMovedPastSplit,
} from "./PlanNodePopover.logic";

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

  it("treats differing options as a switch and keeps raw attribution legible", () => {
    const old = {
      ...model("codex", "gpt-5"),
      options: [{ id: "effort", value: "low" }],
    } satisfies PlanningModelSelection;
    const next = {
      ...model("codex", "gpt-5"),
      options: [{ id: "effort", value: "high" }],
    } satisfies PlanningModelSelection;
    const graph = buildPlanGraph([
      commit("old-depth", 1, [], "human", { ranUnder: old }),
      commit("new-depth", 2, ["old-depth"], "human", { ranUnder: next }),
    ]);

    expect(modelSwitchFor(graph, id("new-depth"))).toEqual(old);
    expect(planningModelOptionLabels(old, [])).toEqual(["low"]);
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
  it("derives a turn from recorded commits, including models and warnings", () => {
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
      acts: ["edit-and-branch"],
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

  it("reads a stamped memory amendment as a standalone history event", () => {
    const commitGraph = buildPlanGraph([
      message("amendment", {
        text: "Surface open decisions",
        memoryAmendment: {
          title: "Surface open decisions",
          memoryCommitSha: "abc123",
          branch: "mercurian/memory",
          notes: ["Composer"],
        },
      }),
    ]);
    const reading = derivePlanNodePopover({
      node: condensePlanGraph(commitGraph).byId.get("amendment")!,
      commitGraph,
      codingSessions: [],
      stalePlan: false,
      staleSpec: false,
      suppressUnanswered: false,
    });
    expect(reading).toMatchObject({
      kind: "standalone",
      label: 'You amended the memory: "Surface open decisions"',
    });
    expect(reading.query).toBeUndefined();
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

    const cases = [
      offeredActs(condensed.byId.get("root")!, graph),
      offeredActs(condensed.byId.get("response")!, graph),
      offeredActs(condensed.byId.get("standalone")!, graph),
      offeredActs(condensed.byId.get("session")!, graph),
      offeredActs(condensed.byId.get("session")!, graph, true),
    ];

    expect(cases).toEqual([[], ["edit-and-branch"], [], [], ["open-session"]]);
    expect(cases.flat()).not.toContain("continue");
    expect(cases.flat()).not.toContain("implement");
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
      branchMovement: { kind: "unchanged" },
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
      commits: "no commits",
      threadId: "thread",
      prUrl: "https://example.com/pr/1",
    });
    expect(withoutRecord.session).toEqual({
      repositoryName: "web",
      planRevisionCommitId: "plan",
    });
    expect(withRecord.acts).toEqual(["open-session"]);
    expect(withoutRecord.acts).toEqual([]);
  });

  it("reads every branch movement and includes departure only when recorded", () => {
    expect(branchMovementLabel({ kind: "unchanged" })).toBe("no commits");
    expect(branchMovementLabel({ kind: "added", count: 1 })).toBe("1 commit added");
    expect(branchMovementLabel({ kind: "added", count: 2 })).toBe("2 commits added");
    expect(branchMovementLabel({ kind: "rewritten" })).toBe("history rewritten");

    const graph = buildPlanGraph([revision("plan", 1, []), leaf]);
    const withDeparture = derivePlanNodePopover({
      node: graph.byId.get("session")!,
      commitGraph: graph,
      codingSessions: [
        planCodingSessionRecord("session", {
          repositoryId: "repo-web",
          threadId: "thread",
          branch: "feature/checkpoint-line",
          branchMovement: { kind: "added", count: 1 },
          departedRef: "feature/detour",
        }),
      ],
      stalePlan: false,
      staleSpec: false,
      suppressUnanswered: false,
    });
    const withoutDeparture = derivePlanNodePopover({
      node: graph.byId.get("session")!,
      commitGraph: graph,
      codingSessions: [
        planCodingSessionRecord("session", {
          repositoryId: "repo-web",
          threadId: "thread",
          branchMovement: { kind: "rewritten" },
          departedRef: null,
        }),
      ],
      stalePlan: false,
      staleSpec: false,
      suppressUnanswered: false,
    });

    expect(withDeparture.session?.branch).toBe("feature/checkpoint-line");
    expect(withDeparture.session?.commits).toBe("1 commit added");
    expect(withDeparture.session?.departedRef).toBe("feature/detour");
    expect(withDeparture.effects).toContain("Departed");
    expect(withoutDeparture.session?.branch).toBe("mercurian/session");
    expect(withoutDeparture.session?.commits).toBe("history rewritten");
    expect(withoutDeparture.session).not.toHaveProperty("departedRef");
    expect(withoutDeparture.effects).not.toContain("Departed");
  });
});
