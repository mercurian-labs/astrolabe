import { describe, expect, it } from "vite-plus/test";

import { buildPlanGraph } from "./planGraph.ts";
import { planMayBeStaleAt } from "./planFreshness.ts";
import {
  commitId,
  message,
  planRevision,
  specRevision,
} from "../../../../apps/web/src/test/fixtures/timeline.ts";

describe("plan freshness", () => {
  it("marks a path stale when its newest spec has no later plan revision", () => {
    const graph = buildPlanGraph([
      message("root"),
      specRevision("spec", { sequence: 2, parents: ["root"] }),
      message("tip", { sequence: 3, parents: ["spec"] }),
    ]);
    expect(planMayBeStaleAt(graph, commitId("tip"))).toBe(true);
  });

  it("clears staleness after a later plan revision", () => {
    const graph = buildPlanGraph([
      specRevision("spec"),
      planRevision("plan", { sequence: 2, parents: ["spec"] }),
    ]);
    expect(planMayBeStaleAt(graph, commitId("plan"))).toBe(false);
  });

  it("is fresh when the path has no spec", () => {
    const graph = buildPlanGraph([message("tip")]);
    expect(planMayBeStaleAt(graph, commitId("tip"))).toBe(false);
  });
});
