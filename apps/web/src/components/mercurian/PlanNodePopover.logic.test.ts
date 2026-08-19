import {
  MercurianCommitId,
  MercurianRepositoryId,
  ProviderDriverKind,
  type PlanCodingSessionRecord,
  type PlanningModelSelection,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { condensePlanGraph } from "./PlanCheckpoints.logic";
import { buildPlanGraph } from "./PlanGraph.logic";
import {
  codingSessionStatus,
  derivePlanNodePopover,
  modelSwitchFor,
  offeredActs,
  planMovedPastSplit,
  resolveImplementFrom,
} from "./PlanNodePopover.logic";

const id = (value: string) => MercurianCommitId.make(value);
const at = (sequence: number) => `2026-08-18T00:${sequence.toString().padStart(2, "0")}:00.000Z`;
const model = (provider: string, name: string): PlanningModelSelection => ({
  provider: ProviderDriverKind.make(provider),
  model: name,
});
const message = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  authorKind: "human" | "assistant",
  options: {
    readonly text?: string;
    readonly ranUnder?: PlanningModelSelection;
    readonly generatedBy?: PlanningModelSelection;
  } = {},
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
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
): PlanTimelineItem => ({
  _tag: "plan-revision",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "assistant",
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

describe("modelSwitchFor", () => {
  it("compares the nearest ancestor recorded turn and crosses interior commits", () => {
    const graph = buildPlanGraph([
      message("old-query", 1, [], "human", { ranUnder: model("claude", "sonnet") }),
      revision("old-plan", 2, ["old-query"]),
      message("old-response", 3, ["old-plan"], "assistant"),
      revision("between", 4, ["old-response"]),
      message("new-query", 5, ["between"], "human", { ranUnder: model("codex", "gpt-5") }),
    ]);

    expect(modelSwitchFor(graph, id("new-query"))).toEqual(model("claude", "sonnet"));
  });

  it("returns no switch without an ancestor record or for the same pair", () => {
    const none = buildPlanGraph([
      message("bare", 1, [], "human"),
      message("next", 2, ["bare"], "human", { ranUnder: model("codex", "gpt-5") }),
    ]);
    const same = buildPlanGraph([
      message("old", 1, [], "human", { ranUnder: model("codex", "gpt-5") }),
      message("new", 2, ["old"], "human", { ranUnder: model("codex", "gpt-5") }),
    ]);
    expect(modelSwitchFor(none, id("next"))).toBeNull();
    expect(modelSwitchFor(same, id("new"))).toBeNull();
  });

  it("detects either a provider or model change", () => {
    const provider = buildPlanGraph([
      message("p-old", 1, [], "human", { ranUnder: model("claude", "same") }),
      message("p-new", 2, ["p-old"], "human", { ranUnder: model("codex", "same") }),
    ]);
    const modelChange = buildPlanGraph([
      message("m-old", 1, [], "human", { ranUnder: model("codex", "old") }),
      message("m-new", 2, ["m-old"], "human", { ranUnder: model("codex", "new") }),
    ]);
    expect(modelSwitchFor(provider, id("p-new"))).toEqual(model("claude", "same"));
    expect(modelSwitchFor(modelChange, id("m-new"))).toEqual(model("codex", "old"));
  });
});

describe("planMovedPastSplit", () => {
  it("is true only when the parent line has a non-projection child", () => {
    const moved = buildPlanGraph([
      message("parent", 1, [], "human"),
      revision("split", 2, ["parent"], true),
      message("continued", 3, ["parent"], "human"),
    ]);
    const projectionsOnly = buildPlanGraph([
      message("only-parent", 1, [], "human"),
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
      message("old", 1, [], "human", { ranUnder: model("claude", "sonnet") }),
      message("query", 2, ["old"], "human", {
        text: "Update both",
        ranUnder: model("codex", "gpt-5"),
      }),
      revision("plan", 3, ["query"]),
      message("response", 4, ["plan"], "assistant", {
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
      message("prose-query", 1, [], "human"),
      message("prose-response", 2, ["prose-query"], "assistant", {
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
    const inFlightGraph = buildPlanGraph([message("in-flight", 1, [], "human")]);
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
      message("parent", 1, [], "human"),
      { ...revision("split", 2, ["parent"], true), authorKind: "human" },
      message("continued", 3, ["parent"], "human"),
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
    const spec: PlanTimelineItem = {
      _tag: "spec-revision",
      commitId: id("spec"),
      sequence: 1,
      parents: [],
      published: false,
      authorKind: "human",
      createdAt: at(1),
      cause: "refresh",
      issueId: "M-12",
    };
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
      message("root", 1, [], "human"),
      message("query", 2, ["root"], "human"),
      message("response", 3, ["query"], "assistant"),
      revision("standalone", 4, ["response"]),
      {
        _tag: "coding-session",
        commitId: id("session"),
        sequence: 5,
        parents: [id("standalone")],
        published: false,
        authorKind: "human",
        createdAt: at(5),
        repositoryId: MercurianRepositoryId.make("repo-web"),
        repositoryName: "web",
        planRevisionCommitId: id("standalone"),
      },
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
  });
});

describe("coding-session facts", () => {
  const leaf: PlanTimelineItem = {
    _tag: "coding-session",
    commitId: id("session"),
    sequence: 2,
    parents: [id("plan")],
    published: false,
    authorKind: "human",
    createdAt: at(2),
    repositoryId: MercurianRepositoryId.make("repo-web"),
    repositoryName: "web",
    planRevisionCommitId: id("plan"),
  };
  const record = (outcome: PlanCodingSessionRecord["outcome"], endedAt: string | null) =>
    ({
      commitId: id("session"),
      repositoryId: MercurianRepositoryId.make("repo-web"),
      threadId: "thread" as PlanCodingSessionRecord["threadId"],
      branch: "feature/checkpoints",
      worktreePath: "/tmp/worktree",
      baseRef: "main",
      startedAt: at(2),
      endedAt,
      outcome,
      prUrl: "https://example.com/pr/1",
    }) satisfies PlanCodingSessionRecord;

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
      prUrl: "https://example.com/pr/1",
    });
    expect(withoutRecord.session).toEqual({
      repositoryName: "web",
      planRevisionCommitId: "plan",
    });
  });

  it("resolves implementation from a session leaf through its parent line", () => {
    const graph = buildPlanGraph([revision("plan", 1, []), leaf]);
    expect(resolveImplementFrom(graph, id("plan"))).toBe("plan");
    expect(resolveImplementFrom(graph, id("session"))).toBe("plan");
  });
});
