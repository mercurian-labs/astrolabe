import {
  MercurianCommitId,
  MercurianRepositoryId,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { DagExplorer } from "./DagExplorer";
import { buildPlanGraph } from "./PlanGraph.logic";

const root = MercurianCommitId.make("root");
const planStaleTip = MercurianCommitId.make("plan-stale-tip");
const specStaleTip = MercurianCommitId.make("spec-stale-tip");
const timeline: ReadonlyArray<PlanTimelineItem> = [
  {
    _tag: "message",
    commitId: root,
    sequence: 1,
    parents: [],
    published: false,
    authorKind: "human",
    createdAt: "2026-08-14T00:00:00.000Z",
    text: "Review the branch",
  },
  {
    _tag: "message",
    commitId: planStaleTip,
    sequence: 2,
    parents: [root],
    published: false,
    authorKind: "human",
    createdAt: "2026-08-14T00:01:00.000Z",
    text: "Plan freshness branch",
  },
  {
    _tag: "message",
    commitId: specStaleTip,
    sequence: 3,
    parents: [root],
    published: false,
    authorKind: "human",
    createdAt: "2026-08-14T00:02:00.000Z",
    text: "Spec freshness branch",
  },
];

describe("DagExplorer", () => {
  it("surfaces plan freshness separately from a stale spec branch", () => {
    const markup = renderToStaticMarkup(
      <DagExplorer
        anchoredCommitId={planStaleTip}
        graph={buildPlanGraph(timeline)}
        readyCommits={
          new Map([
            [
              planStaleTip,
              {
                commitId: planStaleTip,
                repositoryId: MercurianRepositoryId.make("repo-web"),
                repositoryName: "web",
              },
            ],
          ])
        }
        stalePlanCommitIds={new Set([planStaleTip])}
        staleSpecCommitIds={new Set([specStaleTip])}
        onColumnsWidthCapChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(markup).toContain("1 stale spec branch");
    expect(markup).toContain("1 plan may be stale");
    expect(markup).toContain("Plan may be stale");
    expect(markup).toContain("Ready to implement");
    expect(markup).toContain("The spec changed after the plan was last revised");
  });
});
