import { describe, expect, it } from "vite-plus/test";

import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  PlanTurnId,
  type PlanImplementProposal,
  type PlanTimelineItem,
} from "@t3tools/contracts";

import { buildPlanGraph } from "./PlanGraph.logic";
import {
  confirmPayload,
  existingSplitsAt,
  implementDisabledReason,
  partitionProposal,
} from "./splits.logic";

const fields = (id: string, sequence: number, parents: ReadonlyArray<string>) => ({
  commitId: MercurianCommitId.make(id),
  sequence,
  parents: parents.map((parent) => MercurianCommitId.make(parent)),
  published: false,
  authorKind: "human" as const,
  createdAt: "2026-08-10T00:00:00.000Z",
});
const repositoryId = MercurianRepositoryId.make("repo-server");
const otherRepositoryId = MercurianRepositoryId.make("repo-web");
const proposal: PlanImplementProposal = {
  turnId: PlanTurnId.make("turn"),
  parentCommitId: MercurianCommitId.make("parent"),
  verdict: {
    kind: "needs-split",
    splits: [
      { repositoryId, repositoryName: "server", text: "Server work" },
      { repositoryId: otherRepositoryId, repositoryName: "web", text: "Web work" },
    ],
  },
};

describe("split proposal logic", () => {
  it("finds split children per repository and ignores ordinary revisions", () => {
    const timeline: ReadonlyArray<PlanTimelineItem> = [
      { _tag: "message", ...fields("parent", 1, []), text: "Implement" },
      {
        _tag: "plan-revision",
        ...fields("split", 2, ["parent"]),
        split: { repositoryId, repositoryName: "server" },
      },
      { _tag: "plan-revision", ...fields("ordinary", 3, ["parent"]) },
    ];
    const existing = existingSplitsAt(buildPlanGraph(timeline), MercurianCommitId.make("parent"));
    expect([...existing.values()]).toEqual([
      { repositoryId, repositoryName: "server", commitId: MercurianCommitId.make("split") },
    ]);
    const partitioned = partitionProposal(proposal, existing);
    expect(partitioned.alreadySplit).toHaveLength(1);
    expect(partitioned.cards.map((card) => card.repositoryName)).toEqual(["web"]);
  });

  it("builds confirmation from retained non-empty cards", () => {
    expect(
      confirmPayload([
        { repositoryId, repositoryName: "server", text: "  Server work  " },
        { repositoryId: otherRepositoryId, repositoryName: "web", text: "removed", removed: true },
      ]),
    ).toEqual([{ repositoryId, text: "Server work" }]);
    expect(confirmPayload([{ repositoryId, repositoryName: "server", text: "   " }])).toBeNull();
    expect(
      confirmPayload([{ repositoryId, repositoryName: "server", text: "gone", removed: true }]),
    ).toBeNull();
  });

  it("states every implement disabled reason", () => {
    expect(
      implementDisabledReason({ turnActive: false, planTextEmpty: false, isDraft: false }),
    ).toBeNull();
    expect(
      implementDisabledReason({ turnActive: false, planTextEmpty: false, isDraft: true }),
    ).toContain("draft");
    expect(
      implementDisabledReason({ turnActive: true, planTextEmpty: false, isDraft: false }),
    ).toContain("current");
    expect(
      implementDisabledReason({ turnActive: false, planTextEmpty: true, isDraft: false }),
    ).toContain("Write a plan");
  });
});
