import { MercurianCommitId, TrackerConnectionId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Button } from "../ui/button";
import { SpecArtifact } from "./SpecArtifact";

describe("SpecArtifact", () => {
  it("renders an empty spec without an edit door", () => {
    const markup = renderToStaticMarkup(<SpecArtifact spec={null} />);
    expect(markup).toContain("No spec yet.");
    expect(markup).not.toMatch(/Edit|Save|Refresh/);
  });

  it("renders the current path contract and keeps issue language at the origin", () => {
    const markup = renderToStaticMarkup(
      <SpecArtifact
        origin={{
          connectionId: TrackerConnectionId.make("linear-1"),
          issueId: "M-109",
          issueUrl: "https://linear.app/mercurian/issue/M-109/specs",
        }}
        spec={{
          revisionCommitId: MercurianCommitId.make("spec-1"),
          document: {
            goal: "People can plan from an explicit contract.",
            acceptanceCriteria: "The contract is **first class**.",
          },
        }}
      />,
    );
    expect(markup).toContain("From issue M-109");
    expect(markup).toContain("Open issue");
    expect(markup).toContain("The contract is <strong>first class</strong>.");
  });

  it("always renders a populated contract read-only", () => {
    const markup = renderToStaticMarkup(
      <SpecArtifact
        spec={{
          revisionCommitId: MercurianCommitId.make("spec-1"),
          document: { goal: "Behavior", acceptanceCriteria: "Contract" },
        }}
      />,
    );
    expect(markup).toContain("Behavior");
    expect(markup).toContain("Contract");
    expect(markup).not.toMatch(/Edit|Save|Cancel|Refresh/);
  });

  it("keeps the slim Back to now row for historical reading", () => {
    const markup = renderToStaticMarkup(
      <SpecArtifact
        readOnlyAction={
          <Button size="sm" variant="ghost">
            Back to now
          </Button>
        }
        spec={null}
      />,
    );
    expect(markup).toContain("Back to now");
    expect(markup).not.toContain("<textarea");
  });
});
