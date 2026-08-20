import { PlanId, TrackerConnectionId } from "@t3tools/contracts";
import type { Meta, StoryObj } from "@storybook/react";

import { planSpecAt } from "../../test/fixtures/spec";
import { commitId, specRevision, timeline } from "../../test/fixtures/timeline";
import { SpecArtifact } from "./SpecArtifact";

const importedRevision = specRevision("imported-spec", {
  published: true,
  cause: "import",
  issueId: "M-143",
});

const meta = {
  title: "Mercurian/Artifacts/Spec",
  component: SpecArtifact,
  parameters: { layout: "fullscreen" },
  args: {
    planId: PlanId.make("identity-catalog"),
    parentCommitId: commitId("imported-spec"),
    timeline: timeline(importedRevision),
  },
} satisfies Meta<typeof SpecArtifact>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ImportedFromAnIssue: Story = {
  name: "Imported from an issue",
  args: {
    origin: {
      connectionId: TrackerConnectionId.make("linear"),
      issueId: "M-143",
      issueUrl: "https://linear.app/mercurian/issue/M-143",
    },
    spec: planSpecAt("M-143", { revisionCommitId: "imported-spec" }),
  },
};

export const NoSpecYet: Story = {
  name: "No spec yet",
  args: { spec: null, timeline: [] },
};
