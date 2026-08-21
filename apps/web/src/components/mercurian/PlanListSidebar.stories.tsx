import type { Meta, StoryObj } from "@storybook/react";

import { planShell } from "../../test/fixtures/plan";
import { planCodingSessionRecord } from "../../test/fixtures/sessionsAndSplits";
import { SidebarCodingSessionRows, SidebarPlanHoverCardContent } from "./PlanListSidebar";

const runningSession = planCodingSessionRecord("running", {
  repositoryId: "repo-web",
  threadId: "running-session",
  branch: "venk/m-143-story-catalog",
});
const endedSession = planCodingSessionRecord("ended", {
  repositoryId: "repo-web",
  threadId: "ended-session",
  branch: "venk/m-142-storybook-theme",
  endedAt: "2026-08-18T01:00:00.000Z",
  outcome: "completed",
});
const plan = planShell("Identity surface catalog");

const meta = {
  title: "Mercurian/Plan Navigation/Sidebar",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SessionsRunningAndEnded: Story = {
  name: "Sessions running and ended",
  render: () => <SidebarCodingSessionRows sessions={[runningSession, endedSession]} />,
};

export const PlanHoverCard: Story = {
  name: "Plan hover card",
  render: () => (
    <SidebarPlanHoverCardContent title={plan.title}>
      <span>Project astrolabe</span>
      <SidebarCodingSessionRows sessions={[runningSession]} />
    </SidebarPlanHoverCardContent>
  ),
};
