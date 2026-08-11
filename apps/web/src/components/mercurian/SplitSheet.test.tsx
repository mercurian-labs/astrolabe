import {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanTurnId,
  type PlanImplementProposal,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SplitSheetPanel } from "./SplitSheet";
import type { ExistingSplit } from "./splits.logic";
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
  proposal: PlanImplementProposal,
  existingSplits: ReadonlyMap<MercurianRepositoryId, ExistingSplit> = new Map(),
) =>
  renderToStaticMarkup(
    <Dialog open>
      <SplitSheetPanel
        existingSplits={existingSplits}
        proposal={proposal}
        onCancel={() => undefined}
        onConfirm={() => undefined}
        onSelect={() => undefined}
      />
    </Dialog>,
  );

describe("SplitSheet", () => {
  it("renders editable removable cards and a plural landing action", () => {
    const markup = renderSheet(splitProposal);
    expect(markup).toContain("The API and its surface can land independently.");
    expect(markup).toContain('aria-label="server split plan"');
    expect(markup).toContain('aria-label="web split plan"');
    expect(markup).toContain('aria-label="Remove server split"');
    expect(markup).toContain("Land 2 splits");
  });

  it("renders already-landed repositories as jump rows and singular remaining action", () => {
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
    expect(markup).toContain("Already split — jump to it");
    expect(markup).not.toContain('aria-label="server split plan"');
    expect(markup).toContain('aria-label="web split plan"');
    expect(markup).toContain("Land split");
  });

  it("renders the atomic M-110 seam without an editor", () => {
    const markup = renderSheet({
      ...base,
      verdict: { kind: "atomic", repositoryId: serverId, repositoryName: "server" },
    });
    expect(markup).toContain("This plan is atomic");
    expect(markup).toContain("Coding sessions arrive next");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("textarea");
  });
});
