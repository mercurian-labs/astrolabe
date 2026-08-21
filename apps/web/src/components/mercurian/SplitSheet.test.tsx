import {
  MercurianRepositoryId,
  type PlanImplementProposal,
  type PlanImplementVerdict,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { planImplementProposal, planSplitProposal } from "../../test/fixtures/sessionsAndSplits";
import { commitId } from "../../test/fixtures/timeline";

import { SplitSheetPanel, startAllLandedPlans } from "./SplitSheet";
import type { ExistingSplit, LandedPlan } from "./splits.logic";
import { Dialog } from "../ui/dialog";

const serverId = MercurianRepositoryId.make("server-id");
const webId = MercurianRepositoryId.make("web-id");
const proposal = (verdict: PlanImplementVerdict) =>
  planImplementProposal("turn", { parentCommitId: "parent", verdict });
const splitProposal = proposal({
  kind: "needs-split",
  rationale: "The API and its surface can land independently.",
  splits: [
    planSplitProposal("server", { repositoryId: serverId, text: "Server projection" }),
    planSplitProposal("web", { repositoryId: webId, text: "Web projection" }),
  ],
});

const renderSheet = (
  proposal: PlanImplementProposal | undefined,
  existingSplits: ReadonlyMap<MercurianRepositoryId, ExistingSplit> = new Map(),
  landedPlans: ReadonlyArray<LandedPlan> = [],
) =>
  renderToStaticMarkup(
    <Dialog open>
      <SplitSheetPanel
        existingSplits={existingSplits}
        landedPlans={landedPlans}
        proposal={proposal}
        onCancel={() => undefined}
        onConfirm={() => undefined}
        onOpenLandedSessionDraft={() => undefined}
        onOpenSessionDraft={() => undefined}
        onStartAll={() => undefined}
        onSelect={() => undefined}
      />
    </Dialog>,
  );

describe("SplitSheet", () => {
  it("renders the readiness reason before editable repository plans", () => {
    const markup = renderSheet(splitProposal);
    expect(markup).toContain("The API and its surface can land independently.");
    expect(markup.indexOf("A coding session works in one repository at a time.")).toBeLessThan(
      markup.indexOf("The API and its surface can land independently."),
    );
    expect(markup).toContain('aria-label="Plan for server"');
    expect(markup).toContain('aria-label="Plan for web"');
    expect(markup).toContain('aria-label="Remove plan for server"');
    expect(markup).toContain("Add a plan for each repository");
  });

  it("renders existing repository plans as jump rows beside the remaining action", () => {
    const markup = renderSheet(
      splitProposal,
      new Map([
        [
          serverId,
          {
            repositoryId: serverId,
            repositoryName: "server",
            commitId: commitId("server-split"),
          },
        ],
      ]),
    );
    expect(markup).toContain("This repository already has its own plan");
    expect(markup).toContain("Go to plan");
    expect(markup).not.toContain('aria-label="Plan for server"');
    expect(markup).toContain('aria-label="Plan for web"');
    expect(markup).toContain("Add a plan for each repository");
  });

  it("renders the ready M-110 seam without an editor", () => {
    const markup = renderSheet(
      proposal({ kind: "atomic", repositoryId: serverId, repositoryName: "server" }),
    );
    expect(markup).toContain("This plan is ready to implement.");
    expect(markup).toContain("A coding session will run in");
    expect(markup).toContain("server");
    expect(markup).toContain("Start a coding session");
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain("textarea");
  });

  it("renders no confirmation action when the payload is null", () => {
    const markup = renderSheet(
      proposal({
        kind: "needs-split",
        splits: [{ repositoryId: serverId, repositoryName: "server", text: "  " }],
      }),
    );
    expect(markup).not.toContain("Add a plan for each repository");
  });

  it("renders an already-covered verdict as jumps only", () => {
    const existing = new Map<MercurianRepositoryId, ExistingSplit>([
      [
        serverId,
        {
          repositoryId: serverId,
          repositoryName: "server",
          commitId: commitId("server-plan"),
        },
      ],
      [
        webId,
        {
          repositoryId: webId,
          repositoryName: "web",
          commitId: commitId("web-plan"),
        },
      ],
    ]);
    const markup = renderSheet(
      proposal({
        kind: "already-covered",
        repositories: [
          { repositoryId: serverId, repositoryName: "server" },
          { repositoryId: webId, repositoryName: "web" },
        ],
      }),
      existing,
    );
    expect(markup.match(/This repository already has its own plan/g)).toHaveLength(2);
    expect(markup).not.toContain("textarea");
    expect(markup).not.toContain("Add a plan for each repository");
  });

  it("renders one post-confirm jump row per landed branch", () => {
    const markup = renderSheet(undefined, new Map(), [
      {
        commitId: commitId("server-plan"),
        repositoryId: serverId,
        repositoryName: "server",
      },
      {
        commitId: commitId("web-plan"),
        repositoryId: webId,
        repositoryName: "web",
      },
    ]);
    expect(markup).toContain("You added a plan for server");
    expect(markup).toContain("You added a plan for web");
    expect(markup.match(/Go to plan/g)).toHaveLength(2);
    expect(markup.match(/Start a coding session/g)).toHaveLength(2);
    expect(markup).toContain("Start all");
    expect(markup).not.toContain("Add a plan for each repository");
  });

  it("starts every confirmed repository independently", () => {
    const plans: ReadonlyArray<LandedPlan> = [
      {
        commitId: commitId("server-plan"),
        repositoryId: serverId,
        repositoryName: "server",
      },
      {
        commitId: commitId("web-plan"),
        repositoryId: webId,
        repositoryName: "web",
      },
    ];
    const start = vi.fn();
    startAllLandedPlans(plans, start);
    expect(start.mock.calls).toEqual([[plans[0]], [plans[1]]]);
  });

  it("never exposes internal implementation vocabulary in any sheet state", () => {
    const ready = renderSheet(
      proposal({ kind: "atomic", repositoryId: serverId, repositoryName: "server" }),
    );
    const needsPlans = renderSheet(splitProposal);
    const alreadyCovered = renderSheet(
      proposal({
        kind: "already-covered",
        repositories: [{ repositoryId: serverId, repositoryName: "server" }],
      }),
      new Map([
        [
          serverId,
          {
            repositoryId: serverId,
            repositoryName: "server",
            commitId: commitId("existing-server-plan"),
          },
        ],
      ]),
    );
    const landed = renderSheet(undefined, new Map(), [
      {
        commitId: commitId("server-plan"),
        repositoryId: serverId,
        repositoryName: "server",
      },
    ]);
    for (const markup of [ready, needsPlans, alreadyCovered, landed]) {
      expect(markup).not.toMatch(/split|atomic/i);
    }
  });
});
