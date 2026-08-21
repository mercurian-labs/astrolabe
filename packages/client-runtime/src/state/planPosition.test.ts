import { describe, expect, it } from "@effect/vitest";
import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { buildPlanGraph } from "./planGraph.ts";
import {
  advance,
  isViewingPast,
  LATEST,
  positionAfterPick,
  resolveActingHead,
  resolveHead,
} from "./planPosition.ts";

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
const graph = buildPlanGraph([
  commit("root", 1, []),
  commit("left", 2, ["root"]),
  commit("right", 3, ["root"]),
  commit("right-2", 4, ["right"]),
]);

describe("plan position", () => {
  it("resolves latest and picked heads", () => {
    expect(resolveHead(graph, LATEST)).toBe(id("right-2"));
    expect(resolveHead(graph, { _tag: "at", commitId: id("left"), live: true })).toBe(id("left"));
    expect(resolveHead(graph, { _tag: "at", commitId: id("missing"), live: true })).toBe(
      id("right-2"),
    );
  });

  it("marks leaves live and interior commits as past", () => {
    expect(positionAfterPick(graph, id("left"))).toEqual({
      _tag: "at",
      commitId: id("left"),
      live: true,
    });
    const past = positionAfterPick(graph, id("root"));
    expect(past).toEqual({ _tag: "at", commitId: id("root"), live: false });
    expect(isViewingPast(graph, past)).toBe(true);
  });

  it("advances only a live branch and takes its first-born child", () => {
    expect(advance(graph, { _tag: "at", commitId: id("root"), live: true })).toEqual({
      _tag: "at",
      commitId: id("left"),
      live: true,
    });
    expect(advance(graph, LATEST)).toBe(LATEST);
  });

  it("acts from a coding-session leaf's parent", () => {
    const session: PlanTimelineItem = {
      _tag: "coding-session",
      commitId: id("session"),
      sequence: 5,
      parents: [id("right-2")],
      published: false,
      authorKind: "human",
      createdAt: "2026-08-03T00:00:00.000Z",
      repositoryId: "repo" as never,
      repositoryName: "server",
      planRevisionCommitId: id("right-2"),
    };
    const withSession = buildPlanGraph([...graph.nodes.map(({ item }) => item), session]);
    expect(resolveActingHead(withSession, id("session"))).toBe(id("right-2"));
  });
});
