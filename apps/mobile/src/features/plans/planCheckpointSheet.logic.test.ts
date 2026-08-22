import { describe, expect, it } from "vite-plus/test";
import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { checkpointSheetActions, positionForGoHere } from "./planCheckpointSheet.logic";
import { implementFromHereUnavailable } from "./useImplementFromHere";

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

describe("checkpoint sheet acts", () => {
  it("renders implement as unavailable and excludes edit and session destinations", () => {
    const graph = buildPlanGraph([commit("root", 1, [])]);
    const unavailable = implementFromHereUnavailable(graph, id("root"));
    expect(
      checkpointSheetActions(
        ["continue", "edit-and-branch", "implement", "open-session"],
        unavailable,
      ),
    ).toEqual([
      { key: "continue", label: "Go here", disabled: false },
      {
        key: "implement",
        label: "Implement from here",
        disabled: true,
        reason: "Implementing from a checkpoint arrives with the implement flow.",
      },
    ]);
    expect(unavailable.parentCommitId).toBe(id("root"));
  });

  it("omits implement when the shared reading does not offer it", () => {
    expect(
      checkpointSheetActions(["continue", "open-session"], {
        status: "unavailable",
        reason: "Later",
      }).map((act) => act.key),
    ).toEqual(["continue"]);
  });

  it("wires Go here through the shared position-after-pick semantics", () => {
    const graph = buildPlanGraph([commit("a", 1, []), commit("b", 2, ["a"])]);
    expect(positionForGoHere(graph, id("a"))).toEqual({
      _tag: "at",
      commitId: id("a"),
      live: false,
    });
  });
});
