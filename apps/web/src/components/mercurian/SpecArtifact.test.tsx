import {
  MercurianCommitId,
  PlanId,
  TrackerConnectionId,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { SpecArtifact } from "./SpecArtifact";

vi.mock("../../state/mercurian", () => ({
  useSaveSpecRevision: () => vi.fn(),
  useRefreshSpec: () => vi.fn(),
}));

const id = (value: string) => MercurianCommitId.make(value);
const revision: PlanTimelineItem = {
  _tag: "spec-revision",
  commitId: id("spec-1"),
  sequence: 1,
  parents: [],
  published: true,
  authorKind: "human",
  createdAt: "2026-08-13T00:00:00.000Z",
  cause: "import",
  issueId: "M-109",
};

describe("SpecArtifact", () => {
  it("offers the same draft path when a blank plan has no spec", () => {
    const markup = renderToStaticMarkup(
      <SpecArtifact
        parentCommitId={id("message-1")}
        planId={PlanId.make("plan-1")}
        spec={null}
        timeline={[]}
      />,
    );
    expect(markup).toContain("No spec yet — draft the contract");
    expect(markup).toContain(">Edit</button>");
    expect(markup).not.toContain("Draft spec");
  });

  it("renders the current path contract and keeps issue language at the origin", () => {
    const markup = renderToStaticMarkup(
      <SpecArtifact
        origin={{
          connectionId: TrackerConnectionId.make("linear-1"),
          issueId: "M-109",
          issueUrl: "https://linear.app/mercurian/issue/M-109/specs",
        }}
        parentCommitId={id("spec-1")}
        planId={PlanId.make("plan-1")}
        spec={{
          revisionCommitId: id("spec-1"),
          document: { title: "Specs", description: "The contract is **first class**." },
        }}
        timeline={[revision]}
      />,
    );
    expect(markup).toContain("Imported from M-109");
    expect(markup).toContain("From issue M-109");
    expect(markup).toContain("Refresh from issue");
    expect(markup).toContain("The contract is <strong>first class</strong>.");
  });

  it("makes human editing unavailable while the assistant owns the path", () => {
    const markup = renderToStaticMarkup(
      <SpecArtifact
        parentCommitId={id("spec-1")}
        planId={PlanId.make("plan-1")}
        spec={{
          revisionCommitId: id("spec-1"),
          document: { title: "Specs", description: "Contract" },
        }}
        timeline={[revision]}
        turnActive
      />,
    );
    expect(markup).toContain("The assistant is replying. Stop it before editing the spec.");
    expect(markup).toContain("disabled");
  });
});
