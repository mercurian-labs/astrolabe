import {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanTurnId,
  type PlanImplementProposal,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SplitSheetPanel } from "./SplitSheet";
import type { ExistingSplit, LandedPlan } from "./splits.logic";
import { Dialog } from "../ui/dialog";

const serverId = MercurianRepositoryId.make("server-id");
const webId = MercurianRepositoryId.make("web-id");
const base = {
  turnId: PlanTurnId.make("turn"),
  parentCommitId: MercurianCommitId.make("parent"),
};
const splitProposal: PlanImplementProposal = {
  ...base,
  verdict: {
    kind: "needs-split",
    rationale: "The API and its surface can land independently.",
    splits: [
      { repositoryId: serverId, repositoryName: "server", text: "Server projection" },
      { repositoryId: webId, repositoryName: "web", text: "Web projection" },
    ],
  },
};

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
            commitId: MercurianCommitId.make("server-split"),
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
    const markup = renderSheet({
      ...base,
      verdict: { kind: "atomic", repositoryId: serverId, repositoryName: "server" },
    });
    expect(markup).toContain("This plan is ready to implement.");
    expect(markup).toContain("A coding session will run in");
    expect(markup).toContain("server");
    expect(markup).toContain("Coding sessions arrive next");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("textarea");
  });

  it("renders no confirmation action when the payload is null", () => {
    const markup = renderSheet({
      ...base,
      verdict: {
        kind: "needs-split",
        splits: [{ repositoryId: serverId, repositoryName: "server", text: "  " }],
      },
    });
    expect(markup).not.toContain("Add a plan for each repository");
  });

  it("renders an already-covered verdict as jumps only", () => {
    const existing = new Map<MercurianRepositoryId, ExistingSplit>([
      [
        serverId,
        {
          repositoryId: serverId,
          repositoryName: "server",
          commitId: MercurianCommitId.make("server-plan"),
        },
      ],
      [
        webId,
        {
          repositoryId: webId,
          repositoryName: "web",
          commitId: MercurianCommitId.make("web-plan"),
        },
      ],
    ]);
    const markup = renderSheet(
      {
        ...base,
        verdict: {
          kind: "already-covered",
          repositories: [
            { repositoryId: serverId, repositoryName: "server" },
            { repositoryId: webId, repositoryName: "web" },
          ],
        },
      },
      existing,
    );
    expect(markup.match(/This repository already has its own plan/g)).toHaveLength(2);
    expect(markup).not.toContain("textarea");
    expect(markup).not.toContain("Add a plan for each repository");
  });

  it("renders one post-confirm jump row per landed branch", () => {
    const markup = renderSheet(undefined, new Map(), [
      { commitId: MercurianCommitId.make("server-plan"), repositoryName: "server" },
      { commitId: MercurianCommitId.make("web-plan"), repositoryName: "web" },
    ]);
    expect(markup).toContain("You added a plan for server");
    expect(markup).toContain("You added a plan for web");
    expect(markup.match(/Go to plan/g)).toHaveLength(2);
    expect(markup).not.toContain("Add a plan for each repository");
  });

  it("never exposes internal implementation vocabulary in any sheet state", () => {
    const ready = renderSheet({
      ...base,
      verdict: { kind: "atomic", repositoryId: serverId, repositoryName: "server" },
    });
    const needsPlans = renderSheet(splitProposal);
    const alreadyCovered = renderSheet(
      {
        ...base,
        verdict: {
          kind: "already-covered",
          repositories: [{ repositoryId: serverId, repositoryName: "server" }],
        },
      },
      new Map([
        [
          serverId,
          {
            repositoryId: serverId,
            repositoryName: "server",
            commitId: MercurianCommitId.make("existing-server-plan"),
          },
        ],
      ]),
    );
    const landed = renderSheet(undefined, new Map(), [
      { commitId: MercurianCommitId.make("server-plan"), repositoryName: "server" },
    ]);
    for (const markup of [ready, needsPlans, alreadyCovered, landed]) {
      expect(markup).not.toMatch(/split|atomic/i);
    }
  });
});
