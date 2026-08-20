import type { Meta, StoryObj } from "@storybook/react";

import { PlanStatusDot } from "./PlanStatusDot";

const meta = {
  title: "Mercurian/PlanStatusDot",
  component: PlanStatusDot,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof PlanStatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AwaitingInput: Story = {
  name: "Awaiting input",
  args: { status: "awaiting-input" },
};

export const Working: Story = {
  name: "Working",
  args: { status: "working" },
};

export const UnseenUpdates: Story = {
  name: "Unseen updates",
  args: { status: "unseen" },
};
