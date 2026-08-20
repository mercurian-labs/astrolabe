import {
  MercurianCommitId,
  MercurianRepositoryId,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPlanGraph } from "./PlanGraph.logic";
import { sessionPlanReading } from "./SessionPlanPanel.logic";

const id = (value: string) => MercurianCommitId.make(value);
const at = (sequence: number) => `2026-08-20T00:${sequence.toString().padStart(2, "0")}:00.000Z`;
const commitFields = (name: string, sequence: number, parents: ReadonlyArray<string>) => ({
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "human" as const,
  createdAt: at(sequence),
});
const message = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
): PlanTimelineItem => ({
  _tag: "message",
  ...commitFields(name, sequence, parents),
  text: name,
});
const revision = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
  splitRepositoryName?: string,
): PlanTimelineItem => ({
  _tag: "plan-revision",
  ...commitFields(name, sequence, parents),
  ...(splitRepositoryName
    ? {
        split: {
          repositoryId: MercurianRepositoryId.make(`repo-${splitRepositoryName}`),
          repositoryName: splitRepositoryName,
        },
      }
    : {}),
});
const specRevision = (
  name: string,
  sequence: number,
  parents: ReadonlyArray<string>,
): PlanTimelineItem => ({
  _tag: "spec-revision",
  ...commitFields(name, sequence, parents),
  cause: "direct",
});
const session = (
  name: string,
  sequence: number,
  base: string,
  planRevision = "plan",
): PlanTimelineItem => ({
  _tag: "coding-session",
  ...commitFields(name, sequence, [base]),
  repositoryId: MercurianRepositoryId.make("repo-web"),
  repositoryName: "web",
  planRevisionCommitId: id(planRevision),
});

describe("sessionPlanReading", () => {
  it("resolves the implemented plan revision and session base", () => {
    const graph = buildPlanGraph([
      revision("plan", 1, []),
      message("base", 2, ["plan"]),
      session("leaf", 3, "base"),
    ]);

    expect(sessionPlanReading(graph, id("leaf"))).toEqual({
      planRevisionCommitId: id("plan"),
      baseCommitId: id("base"),
      movedPast: false,
      movedPastRepositoryName: null,
    });
  });

  it("does not call sibling coding sessions movement", () => {
    const graph = buildPlanGraph([
      revision("plan", 1, []),
      message("base", 2, ["plan"]),
      session("leaf", 3, "base"),
      session("sibling", 4, "base"),
    ]);

    expect(sessionPlanReading(graph, id("leaf"))?.movedPast).toBe(false);
  });

  it("does not call a split-revision sibling movement", () => {
    const graph = buildPlanGraph([
      revision("plan", 1, []),
      message("base", 2, ["plan"]),
      session("leaf", 3, "base"),
      revision("projection", 4, ["base"], "server"),
    ]);

    expect(sessionPlanReading(graph, id("leaf"))?.movedPast).toBe(false);
  });

  it.each([
    ["message", message("continued", 4, ["base"])],
    ["plan revision", revision("continued", 4, ["base"])],
    ["spec revision", specRevision("continued", 4, ["base"])],
  ])("detects movement from a %s child of the base", (_label, child) => {
    const graph = buildPlanGraph([
      revision("plan", 1, []),
      message("base", 2, ["plan"]),
      session("leaf", 3, "base"),
      child,
    ]);

    expect(sessionPlanReading(graph, id("leaf"))?.movedPast).toBe(true);
  });

  it("carries the repository and detects movement past a split-stamped revision", () => {
    const graph = buildPlanGraph([
      message("parent", 1, []),
      revision("split", 2, ["parent"], "server"),
      session("leaf", 3, "split", "split"),
      message("continued-parent", 4, ["parent"]),
    ]);

    expect(sessionPlanReading(graph, id("leaf"))).toEqual({
      planRevisionCommitId: id("split"),
      baseCommitId: id("split"),
      movedPast: true,
      movedPastRepositoryName: "server",
    });
  });

  it("returns null when the session leaf is absent", () => {
    expect(sessionPlanReading(buildPlanGraph([revision("plan", 1, [])]), id("missing"))).toBeNull();
  });
});
