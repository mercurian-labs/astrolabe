/** Structural shapes, not the wire types: these helpers only read listing fields. */
interface PlanRowFields {
  readonly planId: string;
  readonly updatedAt: string;
}

/** What a plan's lifecycle state is, as any listing of plans reads it. */
export interface PlanLifecycleFields {
  readonly archivedAt: string | null;
  readonly hasPublishedCommits: boolean;
}

interface ProjectRowFields {
  readonly projectId: string;
  readonly createdAt: string;
}

interface ProjectScopedFields {
  readonly projectId: string;
}

interface ArchivedPlanSortFields {
  readonly planId: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export function sortPlansNewestFirst<T extends Pick<PlanRowFields, "updatedAt" | "planId">>(
  plans: readonly T[],
): T[] {
  return [...plans].sort((left, right) => {
    if (left.updatedAt === right.updatedAt) {
      return left.planId.localeCompare(right.planId);
    }
    return left.updatedAt < right.updatedAt ? 1 : -1;
  });
}

/** Active plans and archived ones, split the one way every surface needs them. */
export function partitionPlansByLifecycle<T extends Pick<PlanLifecycleFields, "archivedAt">>(
  plans: readonly T[],
): { readonly active: T[]; readonly archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const plan of plans) {
    if (plan.archivedAt === null) {
      active.push(plan);
    } else {
      archived.push(plan);
    }
  }
  return { active, archived };
}

/** The three things a plan row can be saying, in priority order. */
export type PlanRowStatus = "awaiting-input" | "working" | "unseen";

/** Server facts and visit timestamps used to resolve a plan's presentation status. */
export interface PlanRowStatusFields {
  readonly hasPendingInput: boolean;
  readonly isWorking: boolean;
  readonly updatedAt: string;
  readonly visitedAt?: string | undefined;
}

function hasUnseenActivity(row: PlanRowStatusFields): boolean {
  const updatedAt = Date.parse(row.updatedAt);
  if (Number.isNaN(updatedAt)) return false;
  if (row.visitedAt === undefined) return true;
  const visitedAt = Date.parse(row.visitedAt);
  if (Number.isNaN(visitedAt)) return true;
  return updatedAt > visitedAt;
}

/** The one status a plan row shows, or nothing at all for a quiet row. */
export function resolvePlanRowStatus(row: PlanRowStatusFields): PlanRowStatus | null {
  if (row.hasPendingInput) return "awaiting-input";
  if (row.isWorking) return "working";
  if (hasUnseenActivity(row)) return "unseen";
  return null;
}

export function sortProjectsForTree<T extends ProjectRowFields>(projects: readonly T[]): T[] {
  return [...projects].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.projectId.localeCompare(right.projectId);
    }
    return left.createdAt < right.createdAt ? -1 : 1;
  });
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

export const ARCHIVED_PLAN_INITIAL_COUNT = 10;
export const ARCHIVED_PLAN_PAGE_COUNT = 25;

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

/** Newest-archived first, with creation time as the missing-stamp fallback. */
export function sortPlansNewestArchivedFirst<T extends ArchivedPlanSortFields>(
  plans: readonly T[],
): T[] {
  return [...plans].sort((left, right) => {
    const leftKey = left.archivedAt ?? left.createdAt;
    const rightKey = right.archivedAt ?? right.createdAt;
    return rightKey.localeCompare(leftKey) || right.planId.localeCompare(left.planId);
  });
}
