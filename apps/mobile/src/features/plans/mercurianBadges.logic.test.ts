import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { stalePlanLeafIds, staleSpecLeafIds } from "@t3tools/client-runtime/state/plan-freshness";
import { MercurianRepositoryId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { commitId, message, specRevision } from "../../../../web/src/test/fixtures/timeline";
import { badgeStateAt } from "./mercurianBadges.logic";

describe("mobile Mercurian badge predicates", () => {
  it("uses recorded readiness and the shared freshness predicates", () => {
    const graph = buildPlanGraph([
      message("root"),
      specRevision("spec", { sequence: 2, parents: ["root"] }),
      message("tip", { sequence: 3, parents: ["spec"] }),
    ]);
    expect(
      badgeStateAt({
        commitId: commitId("tip"),
        readyCommits: new Map([
          [
            commitId("tip"),
            {
              commitId: commitId("tip"),
              repositoryId: MercurianRepositoryId.make("repo"),
              repositoryName: "server",
            },
          ],
        ]),
        stalePlanIds: stalePlanLeafIds(graph),
        staleSpecIds: staleSpecLeafIds(graph),
      }),
    ).toEqual({ ready: true, stalePlan: true, staleSpec: false });
  });
});
