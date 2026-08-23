import type { CatalogEntry } from "../../design-system/catalog";
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

export const PLAN_LIST_SIDEBAR_CATALOG_ENTRIES = [
  {
    id: "plan-list-sidebar-sessions-running-and-ended",
    section: "mercurian-grammar",
    group: "PlanListSidebar",
    title: "Sessions running and ended",
    description: "Sidebar coding-session rows with active and completed work.",
    sourcePath: "src/components/mercurian/PlanListSidebar.tsx",
    render: () => <SidebarCodingSessionRows sessions={[runningSession, endedSession]} />,
    layout: "preview",
    preferredCanvas: "compact",
  },
  {
    id: "plan-list-sidebar-plan-hover-card",
    section: "mercurian-grammar",
    group: "PlanListSidebar",
    title: "Plan hover card",
    description: "Plan navigation detail with its active coding session.",
    sourcePath: "src/components/mercurian/PlanListSidebar.tsx",
    render: () => (
      <SidebarPlanHoverCardContent title={plan.title}>
        <span>Project astrolabe</span>
        <SidebarCodingSessionRows sessions={[runningSession]} />
      </SidebarPlanHoverCardContent>
    ),
    layout: "preview",
    preferredCanvas: "compact",
  },
] satisfies ReadonlyArray<CatalogEntry>;
