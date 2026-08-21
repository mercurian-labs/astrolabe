import { describe, expect, it } from "@effect/vitest";
import type { PlanSubscriptionState } from "@t3tools/client-runtime/state/mercurian-planning";
import { LATEST } from "@t3tools/client-runtime/state/plan-position";
import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { buildPlanHistoryModel, findPlanHistorySwitch } from "./plan-history-model";

const id = (value: string) => MercurianCommitId.make(value);
const at = (sequence: number) => `2026-08-20T00:0${sequence}:00.000Z`;
const message = (
  name: string,
  sequence: number,
  parents: string[],
  authorKind: "human" | "assistant",
  published = false,
): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published,
  authorKind,
  text: `${name} text`,
  createdAt: at(sequence),
});
const revision = (
  name: string,
  sequence: number,
  parents: string[],
  published = false,
): PlanTimelineItem => ({
  _tag: "plan-revision",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published,
  authorKind: "human",
  createdAt: at(sequence),
});
const state = (
  timeline: ReadonlyArray<PlanTimelineItem>,
  inFlightParent?: string,
): Pick<PlanSubscriptionState, "detail"> => ({
  detail: {
    timeline,
    ...(inFlightParent === undefined
      ? {}
      : { inFlightTurn: { parentCommitId: id(inFlightParent) } }),
  } as PlanSubscriptionState["detail"],
});

describe("plan history model", () => {
  it("renders a settled turn as one checkpoint and maps an interior anchor to it", () => {
    const timeline = [
      message("query", 1, [], "human"),
      { ...revision("plan", 2, ["query"]), authorKind: "assistant" as const },
      message("response", 3, ["plan"], "assistant"),
    ];
    const model = buildPlanHistoryModel(
      state(timeline),
      { _tag: "at", commitId: id("plan"), live: false },
      new Map(),
    );
    expect(model.currentNodeId).toBe("response");
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({
      kind: "checkpoint",
      commitId: "response",
      current: true,
      effects: ["plan-updated"],
      query: { commitId: "query" },
      response: { commitId: "response" },
    });
  });

  it("keeps only the standing branch and supplies indexed, descriptive sibling options", () => {
    const timeline = [
      revision("root", 1, []),
      revision("left", 2, ["root"], true),
      revision("right", 3, ["root"]),
      revision("left-tip", 4, ["left"], true),
      revision("right-tip", 5, ["right"]),
    ];
    const model = buildPlanHistoryModel(
      state(timeline),
      { _tag: "at", commitId: id("right-tip"), live: true },
      new Map(),
    );
    expect(model.rows.map((row) => row.commitId)).toEqual(["root", "right", "right-tip"]);
    const selection = findPlanHistorySwitch(model, id("right"), "siblings");
    expect(selection?.index).toBe(1);
    expect(selection?.options).toMatchObject([
      {
        branchRootId: "left",
        tipId: "left-tip",
        lastActiveAt: at(4),
        published: true,
      },
      {
        branchRootId: "right",
        tipId: "right-tip",
        lastActiveAt: at(5),
        published: false,
      },
    ]);
  });

  it("suppresses Unanswered while that checkpoint's turn is streaming", () => {
    const model = buildPlanHistoryModel(
      state([message("query", 1, [], "human")], "query"),
      LATEST,
      new Map(),
    );
    expect([...model.inFlightUnansweredNodeIds]).toEqual(["query"]);
    expect(model.rows[0]).toMatchObject({ kind: "checkpoint", effects: [] });
  });

  it("re-roots a merge's ancestry through the chosen parent without moving the current row", () => {
    const timeline = [
      revision("root", 1, []),
      revision("left", 2, ["root"]),
      revision("right", 3, ["root"]),
      revision("merge", 4, ["left", "right"]),
      revision("after", 5, ["merge"]),
    ];
    const model = buildPlanHistoryModel(
      state(timeline),
      { _tag: "at", commitId: id("merge"), live: false },
      new Map([["merge", id("right")]]),
    );
    expect(model.rows.map((row) => row.commitId)).toEqual(["root", "right", "merge", "after"]);
    expect(findPlanHistorySwitch(model, id("merge"), "parent-lines")?.index).toBe(1);
    expect(model.currentNodeId).toBe("merge");
  });

  it("distinguishes published and private standalone acts", () => {
    const model = buildPlanHistoryModel(
      state([revision("published", 1, [], true), revision("private", 2, ["published"])]),
      LATEST,
      new Map(),
    );
    expect(model.rows).toMatchObject([
      { kind: "commit", published: true },
      { kind: "commit", published: false, current: true },
    ]);
  });

  it("preserves publication separately for each side of a checkpoint", () => {
    const model = buildPlanHistoryModel(
      state([
        message("published-query", 1, [], "human", true),
        message("private-response", 2, ["published-query"], "assistant"),
      ]),
      LATEST,
      new Map(),
    );
    expect(model.rows[0]).toMatchObject({
      kind: "checkpoint",
      query: { published: true },
      response: { published: false },
    });
  });
});
