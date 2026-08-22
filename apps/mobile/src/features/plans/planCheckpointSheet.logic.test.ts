import { describe, expect, it } from "vite-plus/test";
import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { MercurianCommitId, type PlanTimelineItem } from "@t3tools/contracts";

import { checkpointSheetActions, positionForGoHere } from "./planCheckpointSheet.logic";

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
  it("renders implement and the now-addressable session destination", () => {
    expect(
      checkpointSheetActions(["continue", "edit-and-branch", "implement", "open-session"], {
        status: "available",
      }),
    ).toEqual([
      { key: "continue", label: "Go here", disabled: false },
      {
        key: "implement",
        label: "Implement from here",
        disabled: false,
      },
      { key: "open-session", label: "Open session", disabled: false },
    ]);
  });

  it("omits implement when the shared reading does not offer it", () => {
    expect(
      checkpointSheetActions(["continue", "open-session"], {
        status: "unavailable",
        reason: "Later",
      }).map((act) => act.key),
    ).toEqual(["continue", "open-session"]);
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
