import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { implementFlowAction } from "@t3tools/client-runtime/state/plan-splits";
import { describe, expect, it } from "vite-plus/test";

import {
  codingSessionLeaf,
  commitId,
  message,
  planRevision,
  specRevision,
} from "../../../../web/src/test/fixtures/timeline";
import { deriveImplementTransition } from "./useImplementFlow.logic";

describe("mobile implement flow transitions", () => {
  it("warns before evaluating a stale plan", () => {
    const graph = buildPlanGraph([
      message("root"),
      specRevision("spec", { sequence: 2, parents: ["root"] }),
      message("tip", { sequence: 3, parents: ["spec"] }),
    ]);
    expect(
      deriveImplementTransition(graph, commitId("tip"), {
        kind: "invoke",
        planMayBeStale: true,
      }),
    ).toEqual({ parentCommitId: "tip", action: "show-warning" });
  });

  it("continues from the warning into readiness evaluation", () => {
    expect(implementFlowAction({ kind: "continue-anyway" })).toBe("evaluate-readiness");
  });

  it("routes review-plan to the artifact", () => {
    expect(implementFlowAction({ kind: "review-plan" })).toBe("show-plan");
  });

  it("evaluates immediately when the plan is fresh", () => {
    const graph = buildPlanGraph([
      message("root"),
      planRevision("plan", { sequence: 2, parents: ["root"] }),
    ]);
    expect(
      deriveImplementTransition(graph, commitId("plan"), {
        kind: "invoke",
        planMayBeStale: false,
      }).action,
    ).toBe("evaluate-readiness");
  });

  it("resolves a coding-session leaf to its acting parent", () => {
    const graph = buildPlanGraph([
      planRevision("plan"),
      codingSessionLeaf("session", {
        sequence: 2,
        parents: ["plan"],
        planRevisionCommitId: "plan",
      }),
    ]);
    expect(
      deriveImplementTransition(graph, commitId("session"), {
        kind: "invoke",
        planMayBeStale: false,
      }).parentCommitId,
    ).toBe("plan");
  });
});
