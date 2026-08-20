import type { Meta, StoryObj } from "@storybook/react";

import { AlertDialog } from "../ui/alert-dialog";
import { StalePlanWarningContent } from "./StalePlanWarning";

const meta = {
  title: "Mercurian/Artifacts/Stale Plan Warning",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlanMayBeStale: Story = {
  name: "Plan may be stale",
  render: () => (
    <AlertDialog open>
      <StalePlanWarningContent onContinue={() => undefined} onReviewPlan={() => undefined} />
    </AlertDialog>
  ),
};
