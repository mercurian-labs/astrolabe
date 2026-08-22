import { filterPlansByProjectScope } from "@t3tools/client-runtime/state/plan-listing";
import { sortPlansNewestArchivedFirst } from "./ArchivedPlansPanel.logic";
import {
  partitionPlansByLifecycle,
  resolveTreeSelection,
  sortPlansNewestFirst,
  type PlanLifecycleFields,
  type PlanRowStatusFields,
  type TreeSelection,
} from "./planListing.logic";

export {
  ARCHIVED_PLAN_INITIAL_COUNT,
  ARCHIVED_PLAN_PAGE_COUNT,
  filterPlansByProjectScope,
  pageArchivedPlans,
  resolvePlanCardStatus,
  type ArchivedPlansPage,
  type PlanCardStatus,
} from "@t3tools/client-runtime/state/plan-listing";

interface ProjectScopedFields {
  readonly projectId: string;
}

interface SidebarPlanFields extends ProjectScopedFields, PlanLifecycleFields, PlanRowStatusFields {
  readonly planId: string;
  readonly createdAt: string;
}

interface DraftRowFields extends ProjectScopedFields {
  readonly draftId: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface SidebarSelection extends TreeSelection {
  readonly activeDraftId: string | null;
}

/** The selected plan, draft, or workspace destination represented by the route. */
export function resolveSidebarSelection(pathname: string): SidebarSelection {
  const selection = resolveTreeSelection(pathname);
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const [first, second, third] = segments;
  return {
    ...selection,
    activeDraftId:
      first === "plans" && second === "draft" && third !== undefined
        ? decodeURIComponent(third)
        : null,
  };
}

/** The flat sidebar's two lifecycle sections, each in the order it is drawn. */
export function partitionSidebarPlans<T extends SidebarPlanFields>(
  plans: readonly T[],
  projectScopeId: string | null,
): { readonly active: T[]; readonly archived: T[] } {
  const scoped = filterPlansByProjectScope(plans, projectScopeId);
  const { active, archived } = partitionPlansByLifecycle(scoped);
  return {
    active: sortPlansNewestFirst(active),
    archived: sortPlansNewestArchivedFirst(archived),
  };
}

interface CodingSessionDetailFields {
  readonly branch: string;
  readonly endedAt: string | null;
}

export function codingSessionDetailLabel(session: CodingSessionDetailFields): string {
  return `${session.endedAt === null ? "Running" : "Ended"} · ${session.branch}`;
}

/** Jump keys follow active cards exactly as the flat list draws them. */
export function listJumpTargets<T extends { readonly planId: string }>(
  activePlans: readonly T[],
): string[] {
  return activePlans.map((plan) => plan.planId);
}

/** Invested drafts only, scope-filtered and newest first like the donor block. */
export function resolveDraftRows<T extends DraftRowFields>(
  draftsById: Readonly<Record<string, T>>,
  projectScopeId: string | null,
): T[] {
  return Object.values(draftsById)
    .filter(
      (draft) =>
        draft.text.trim().length > 0 &&
        (projectScopeId === null || draft.projectId === projectScopeId),
    )
    .toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.draftId.localeCompare(left.draftId),
    );
}
