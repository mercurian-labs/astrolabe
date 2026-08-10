import { sortPlansNewestArchivedFirst } from "./ArchivedPlansPanel.logic";
import {
  partitionPlansByLifecycle,
  resolvePlanRowStatus,
  resolveTreeSelection,
  sortPlansNewestFirst,
  type PlanLifecycleFields,
  type PlanRowStatusFields,
  type TreeSelection,
} from "./ProjectTreeSidebar.logic";

export const ARCHIVED_PLAN_INITIAL_COUNT = 10;
export const ARCHIVED_PLAN_PAGE_COUNT = 25;

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

/** Apply the ephemeral project scope without changing the list's source order. */
export function filterPlansByProjectScope<T extends ProjectScopedFields>(
  plans: readonly T[],
  projectScopeId: string | null,
): T[] {
  return projectScopeId === null
    ? [...plans]
    : plans.filter((plan) => plan.projectId === projectScopeId);
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

export interface PlanCardStatus {
  readonly slot: "awaiting-input" | "working" | null;
  readonly unread: boolean;
}

/**
 * The card header carries live state; unseen activity belongs to title weight.
 * They are resolved independently so a working, unread card can say both.
 */
export function resolvePlanCardStatus(row: PlanRowStatusFields): PlanCardStatus {
  const status = resolvePlanRowStatus(row);
  const unread =
    resolvePlanRowStatus({ ...row, hasPendingInput: false, isWorking: false }) === "unseen";
  return {
    slot: status === "awaiting-input" || status === "working" ? status : null,
    unread,
  };
}

export interface ArchivedPlansPage<T> {
  readonly visible: T[];
  readonly hiddenCount: number;
  readonly nextPageCount: number;
}

/** Page zero is the recent ten; each subsequent page exposes 25 more. */
export function pageArchivedPlans<T>(plans: readonly T[], page = 0): ArchivedPlansPage<T> {
  const normalizedPage = Math.max(0, Math.floor(page));
  const visibleCount = ARCHIVED_PLAN_INITIAL_COUNT + normalizedPage * ARCHIVED_PLAN_PAGE_COUNT;
  const visible = plans.slice(0, visibleCount);
  const hiddenCount = plans.length - visible.length;
  return {
    visible,
    hiddenCount,
    nextPageCount: Math.min(hiddenCount, ARCHIVED_PLAN_PAGE_COUNT),
  };
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
