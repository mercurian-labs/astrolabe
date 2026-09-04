import type { CatalogEntry } from "../../design-system/catalog";
import { planShell } from "../../test/fixtures/plan";
import { SidebarPlanHoverCardContent } from "./PlanListSidebar";
const plan = planShell("Identity surface catalog");

export const PLAN_LIST_SIDEBAR_CATALOG_ENTRIES = [
  {
    id: "plan-list-sidebar-plan-hover-card",
    section: "mercurian-grammar",
    group: "PlanListSidebar",
    title: "Plan hover card",
    description: "Plan navigation detail with project context.",
    sourcePath: "src/components/mercurian/PlanListSidebar.tsx",
    render: () => (
      <SidebarPlanHoverCardContent title={plan.title}>
        <span>Project astrolabe</span>
      </SidebarPlanHoverCardContent>
    ),
    layout: "preview",
    preferredCanvas: "compact",
  },
] satisfies ReadonlyArray<CatalogEntry>;
