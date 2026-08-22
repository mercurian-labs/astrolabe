import { buildPlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { MercurianRepositoryId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  planImplementProposal,
  planSplitProposal,
} from "../../../../web/src/test/fixtures/sessionsAndSplits";
import { commitId, planRevision } from "../../../../web/src/test/fixtures/timeline";
import {
  derivePlanImplementSheetState,
  landedPlansFromConfirmation,
  sessionDraftParams,
} from "./planImplementSheet.logic";

const serverId = MercurianRepositoryId.make("server");
const webId = MercurianRepositoryId.make("web");

describe("mobile implement sheet state", () => {
  it("keeps existing repository plans as jumps and fresh proposals as cards", () => {
    const graph = buildPlanGraph([
      planRevision("parent"),
      planRevision("server-plan", {
        sequence: 2,
        parents: ["parent"],
        split: { repositoryId: serverId, repositoryName: "server" },
      }),
    ]);
    const state = derivePlanImplementSheetState({
      graph,
      proposal: planImplementProposal("turn", {
        parentCommitId: "parent",
        verdict: {
          kind: "needs-split",
          splits: [
            planSplitProposal("server", { repositoryId: serverId }),
            planSplitProposal("web", { repositoryId: webId }),
          ],
        },
      }),
    });
    expect(state.alreadySplit.map((item) => item.repositoryName)).toEqual(["server"]);
    expect(state.cards.map((item) => item.repositoryName)).toEqual(["web"]);
  });

  it("shows an already-covered proposal as jumps with no confirmation", () => {
    const graph = buildPlanGraph([
      planRevision("parent"),
      planRevision("server-plan", {
        sequence: 2,
        parents: ["parent"],
        split: { repositoryId: serverId, repositoryName: "server" },
      }),
    ]);
    const state = derivePlanImplementSheetState({
      graph,
      proposal: planImplementProposal("turn", {
        parentCommitId: "parent",
        verdict: {
          kind: "already-covered",
          repositories: [{ repositoryId: serverId, repositoryName: "server" }],
        },
      }),
    });
    expect(state.alreadySplit).toHaveLength(1);
    expect(state.payload).toBeNull();
  });

  it("drops removed cards and refuses blank edits", () => {
    const graph = buildPlanGraph([planRevision("parent")]);
    const proposal = planImplementProposal("turn", {
      parentCommitId: "parent",
      verdict: {
        kind: "needs-split",
        splits: [
          planSplitProposal("server", { repositoryId: serverId }),
          planSplitProposal("web", { repositoryId: webId }),
        ],
      },
    });
    const proposedCards = [
      planSplitProposal("server", { repositoryId: serverId }),
      planSplitProposal("web", { repositoryId: webId }),
    ];
    expect(
      derivePlanImplementSheetState({
        graph,
        proposal,
        cards: [
          { ...proposedCards[0]!, removed: true },
          { ...proposedCards[1]!, text: "  Web plan  " },
        ],
      }).payload,
    ).toEqual([{ repositoryId: webId, repositoryName: "web", text: "Web plan" }]);
    expect(
      derivePlanImplementSheetState({
        graph,
        proposal,
        cards: [{ ...proposedCards[1]!, text: " " }],
      }).payload,
    ).toBeNull();
  });

  it("zips confirmed commits to repository plans in order", () => {
    expect(
      landedPlansFromConfirmation(
        [commitId("server-plan"), commitId("web-plan")],
        [
          planSplitProposal("server", { repositoryId: serverId }),
          planSplitProposal("web", { repositoryId: webId }),
        ],
      ).map((item) => item.repositoryName),
    ).toEqual(["server", "web"]);
  });

  it("builds the stable draft route identity from plan and parent", () => {
    expect(sessionDraftParams("plan", commitId("ready"))).toEqual({
      planId: "plan",
      parentCommitId: "ready",
    });
  });
});
