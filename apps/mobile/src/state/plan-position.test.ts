import { describe, expect, it } from "@effect/vitest";
import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { LATEST } from "@t3tools/client-runtime/state/plan-position";
import {
  EnvironmentId,
  MercurianCommitId,
  PlanId,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import { appAtomRegistry } from "./atom-registry";
import {
  advancePlanPosition,
  backToNowPlanPosition,
  choosePlanParentLine,
  pickPlanPosition,
  planPositionKey,
  planPositionStateAtom,
  resetPlanPosition,
  standAtPlanPosition,
} from "./plan-position";

const id = (value: string) => MercurianCommitId.make(value);
const commit = (name: string, sequence: number, parents: string[]): PlanTimelineItem => ({
  _tag: "message",
  commitId: id(name),
  sequence,
  parents: parents.map(id),
  published: false,
  authorKind: "human",
  text: name,
  createdAt: "2026-08-20T00:00:00.000Z",
});
const key = planPositionKey(EnvironmentId.make("env"), PlanId.make("plan"));

describe("mobile plan position", () => {
  it("picks leaves live and interior commits looking back", () => {
    resetPlanPosition(key);
    const graph = buildPlanGraph([commit("root", 1, []), commit("leaf", 2, ["root"])]);
    pickPlanPosition(key, graph, id("root"));
    expect(appAtomRegistry.get(planPositionStateAtom(key)).position).toEqual({
      _tag: "at",
      commitId: id("root"),
      live: false,
    });
    pickPlanPosition(key, graph, id("leaf"));
    expect(appAtomRegistry.get(planPositionStateAtom(key)).position).toEqual({
      _tag: "at",
      commitId: id("leaf"),
      live: true,
    });
  });

  it("advances a live branch, stands at a send, and returns to now", () => {
    resetPlanPosition(key);
    const before = buildPlanGraph([commit("root", 1, [])]);
    pickPlanPosition(key, before, id("root"));
    const after = buildPlanGraph([commit("root", 1, []), commit("reply", 2, ["root"])]);
    advancePlanPosition(key, after);
    expect(appAtomRegistry.get(planPositionStateAtom(key)).position).toMatchObject({
      commitId: id("reply"),
      live: true,
    });
    standAtPlanPosition(key, id("sent"));
    expect(appAtomRegistry.get(planPositionStateAtom(key)).position).toMatchObject({
      commitId: id("sent"),
      live: true,
    });
    backToNowPlanPosition(key);
    expect(appAtomRegistry.get(planPositionStateAtom(key)).position).toBe(LATEST);
  });

  it("shares parent choices and reset clears all per-plan transient state", () => {
    resetPlanPosition(key);
    choosePlanParentLine(key, id("merge"), id("right"));
    expect(appAtomRegistry.get(planPositionStateAtom(key)).parentChoices.get("merge")).toBe(
      "right",
    );
    resetPlanPosition(key);
    expect(appAtomRegistry.get(planPositionStateAtom(key))).toEqual({
      position: LATEST,
      parentChoices: new Map(),
    });
  });
});
