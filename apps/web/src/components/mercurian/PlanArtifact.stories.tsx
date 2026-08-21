import { PlanId } from "@t3tools/contracts";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "storybook/test";

import { commitId, planRevision, timeline } from "../../test/fixtures/timeline";
import { PlanArtifact } from "./PlanArtifact";

const planHistory = timeline(
  planRevision("initial-plan", {
    authorKind: "assistant",
    published: true,
  }),
);

const meta = {
  title: "Mercurian/Artifacts/Plan",
  component: PlanArtifact,
  parameters: { layout: "fullscreen" },
  args: {
    planId: PlanId.make("identity-catalog"),
    parentCommitId: commitId("initial-plan"),
    planText:
      "# Identity surface catalog\n\n- Checkpoint Graph\n- Planning composer\n- Plan and spec artifacts",
    timeline: planHistory,
  },
} satisfies Meta<typeof PlanArtifact>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reading: Story = {
  name: "Reading",
  args: { readOnly: true },
};

export const Editing: Story = {
  name: "Editing",
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Edit" }));
  },
};

export const ReplyStreaming: Story = {
  name: "Reply streaming on this branch",
  args: { turnActive: true },
};
