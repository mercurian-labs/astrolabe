import { describe, expect, it } from "vite-plus/test";

import { MercurianRepositoryId, type PlanTimelineItem } from "@t3tools/contracts";

import { planImplementProposal, planSplitProposal } from "../../test/fixtures/sessionsAndSplits";
import { commitId, message, planRevision } from "../../test/fixtures/timeline";

import { buildPlanGraph } from "./PlanGraph.logic";
import {
  confirmPayload,
  existingSplitsAt,
  implementDisabledReason,
  implementFlowAction,
  partitionProposal,
} from "./splits.logic";

const repositoryId = MercurianRepositoryId.make("repo-server");
const otherRepositoryId = MercurianRepositoryId.make("repo-web");
const proposal = planImplementProposal("turn", {
  parentCommitId: "parent",
  verdict: {
    kind: "needs-split",
    splits: [
      planSplitProposal("server", { repositoryId, text: "Server work" }),
      planSplitProposal("web", { repositoryId: otherRepositoryId, text: "Web work" }),
    ],
  },
});

describe("split proposal logic", () => {
  it("finds split children per repository and ignores ordinary revisions", () => {
    const timeline: ReadonlyArray<PlanTimelineItem> = [
      message("parent", { createdAt: "2026-08-10T00:00:00.000Z", text: "Implement" }),
      planRevision("split", {
        sequence: 2,
        parents: ["parent"],
        createdAt: "2026-08-10T00:00:00.000Z",
        split: { repositoryId, repositoryName: "server" },
      }),
      planRevision("ordinary", {
        sequence: 3,
        parents: ["parent"],
        createdAt: "2026-08-10T00:00:00.000Z",
      }),
    ];
    const existing = existingSplitsAt(buildPlanGraph(timeline), commitId("parent"));
    expect([...existing.values()]).toEqual([
      { repositoryId, repositoryName: "server", commitId: commitId("split") },
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
    ).toEqual([{ repositoryId, repositoryName: "server", text: "Server work" }]);
    expect(confirmPayload([{ repositoryId, repositoryName: "server", text: "   " }])).toBeNull();
    expect(
      confirmPayload([{ repositoryId, repositoryName: "server", text: "gone", removed: true }]),
    ).toBeNull();
  });

  it("turns an already-covered verdict into jumps only", () => {
    const existing = new Map([
      [
        repositoryId,
        {
          repositoryId,
          repositoryName: "server",
          commitId: commitId("server-plan"),
        },
      ],
      [
        otherRepositoryId,
        {
          repositoryId: otherRepositoryId,
          repositoryName: "web",
          commitId: commitId("web-plan"),
        },
      ],
    ]);
    const partitioned = partitionProposal(
      planImplementProposal("covered-turn", {
        parentCommitId: "parent",
        verdict: {
          kind: "already-covered",
          repositories: [
            { repositoryId, repositoryName: "server" },
            { repositoryId: otherRepositoryId, repositoryName: "web" },
          ],
        },
      }),
      existing,
    );
    expect(partitioned.cards).toEqual([]);
    expect(partitioned.alreadySplit.map((item) => item.repositoryName)).toEqual(["server", "web"]);
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

  it("routes the stale-plan warning before readiness without changing the ordinary path", () => {
    expect(implementFlowAction({ kind: "invoke", planMayBeStale: true })).toBe("show-warning");
    expect(implementFlowAction({ kind: "review-plan" })).toBe("show-plan");
    expect(implementFlowAction({ kind: "continue-anyway" })).toBe("evaluate-readiness");
    expect(implementFlowAction({ kind: "invoke", planMayBeStale: false })).toBe(
      "evaluate-readiness",
    );
  });
});
