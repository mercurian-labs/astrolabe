import { describe, expect, it } from "@effect/vitest";
import {
  MercurianCommitId,
  MercurianRepositoryId,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import {
  ancestorClosure,
  buildPlanGraph,
  descendantClosure,
  hasFork,
  planCommitDetail,
  planCommitSummary,
} from "./planGraph.ts";

const id = (value: string) => MercurianCommitId.make(value);
const commit = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  text = name,
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "human",
  text,
  createdAt: "2026-08-03T00:00:00.000Z",
});

const chain = [commit("a", 1, []), commit("b", 2, ["a"]), commit("c", 3, ["b"])];
const fork = [...chain.slice(0, 2), commit("l", 3, ["b"]), commit("r", 4, ["b"])];
const merged = [...fork, commit("m", 5, ["l", "r"]), commit("after", 6, ["m"])];

describe("buildPlanGraph", () => {
  it("orders a linear history and identifies its root and latest commit", () => {
    const graph = buildPlanGraph(chain.toReversed());
    expect(graph.nodes.map((node) => node.commitId)).toEqual(["a", "b", "c"]);
    expect(graph.roots).toEqual(["a"]);
    expect(graph.latest).toBe("c");
    expect(hasFork(graph)).toBe(false);
  });

  it("marks forks and merges while dropping missing parent edges", () => {
    const graph = buildPlanGraph([...merged, commit("loose", 7, ["missing"])]);
    expect(graph.byId.get("b")?.isBranchPoint).toBe(true);
    expect(graph.byId.get("m")?.isMerge).toBe(true);
    expect(graph.byId.get("loose")?.parents).toEqual([]);
  });

  it("represents an empty history", () => {
    expect(buildPlanGraph([])).toMatchObject({ nodes: [], roots: [], latest: null });
  });
});

describe("graph closures", () => {
  it("takes only the standing branch's ancestors", () => {
    const closure = ancestorClosure(buildPlanGraph(fork), id("l"));
    expect([...closure].sort()).toEqual(["a", "b", "l"]);
    expect(closure.has("r")).toBe(false);
  });

  it("takes every parent of a merge and descendants below a branch", () => {
    const graph = buildPlanGraph(merged);
    expect([...ancestorClosure(graph, id("m"))].sort()).toEqual(["a", "b", "l", "m", "r"]);
    expect([...descendantClosure(graph, id("l"))].sort()).toEqual(["after", "l", "m"]);
  });

  it("returns empty closures for unknown commits", () => {
    const graph = buildPlanGraph(chain);
    expect(ancestorClosure(graph, id("unknown")).size).toBe(0);
    expect(descendantClosure(graph, id("unknown")).size).toBe(0);
  });
});

describe("commit labels", () => {
  it("uses and truncates a message's first non-empty line", () => {
    expect(planCommitSummary(commit("a", 1, [], "  Reshape it  \nand more"))).toBe("Reshape it");
    expect(planCommitSummary(commit("b", 2, ["a"], "x".repeat(200)))).toHaveLength(60);
    expect(planCommitDetail(commit("c", 3, ["b"], "first\n\nfull detail"))).toBe(
      "first\n\nfull detail",
    );
  });

  it("labels revision, split, spec cause, and coding-session commits", () => {
    const fields = {
      sequence: 2,
      parents: [id("a")],
      published: false,
      authorKind: "assistant" as const,
      createdAt: "2026-08-03T00:00:00.000Z",
    };
    expect(planCommitSummary({ _tag: "plan-revision", commitId: id("rev"), ...fields })).toBe(
      "The assistant revised the plan",
    );
    expect(
      planCommitSummary({
        _tag: "plan-revision",
        commitId: id("split"),
        ...fields,
        split: {
          repositoryId: MercurianRepositoryId.make("repo"),
          repositoryName: "server",
        },
      }),
    ).toBe("Plan for server");
    expect(
      planCommitSummary({
        _tag: "spec-revision",
        commitId: id("spec"),
        ...fields,
        cause: "import",
        issueId: "M-147",
      }),
    ).toBe("Spec imported from M-147");
    expect(
      planCommitSummary({
        _tag: "coding-session",
        commitId: id("session"),
        ...fields,
        repositoryId: MercurianRepositoryId.make("repo"),
        repositoryName: "server",
        planRevisionCommitId: id("rev"),
      }),
    ).toBe("Coding session in server");
  });
});
