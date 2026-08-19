import type { ContextMenuItem } from "@t3tools/contracts";

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

/** Which plan or workspace destination the current route belongs to. */
export interface TreeSelection {
  readonly activePlanId: string | null;
  readonly activeSessionThreadId: string | null;
  readonly isRepositoriesActive: boolean;
  readonly isSettingsActive: boolean;
}

const segmentsOf = (pathname: string) =>
  pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

export function resolveTreeSelection(pathname: string): TreeSelection {
  const segments = segmentsOf(pathname);
  const [first, second] = segments;
  return {
    activePlanId: first === "plans" && second !== undefined && second !== "draft" ? second : null,
    activeSessionThreadId: first === "sessions" && second !== undefined ? second : null,
    isRepositoriesActive: first === "repositories",
    isSettingsActive: first === "settings",
  };
}

interface SessionOwningPlanFields {
  readonly planId: string;
  readonly codingSessions: ReadonlyArray<{ readonly threadId: string }>;
}

/** Resolve a session route's thread selection to the plan card that owns it. */
export function resolveTreeActivePlanId(
  selection: Pick<TreeSelection, "activePlanId" | "activeSessionThreadId">,
  plans: ReadonlyArray<SessionOwningPlanFields>,
): string | null {
  if (selection.activePlanId !== null) return selection.activePlanId;
  if (selection.activeSessionThreadId === null) return null;
  return (
    plans.find((plan) =>
      plan.codingSessions.some((session) => session.threadId === selection.activeSessionThreadId),
    )?.planId ?? null
  );
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

/** Archive always exists; delete exists only while the plan is fully private. */
export function resolvePlanRowActions(plan: Pick<PlanLifecycleFields, "hasPublishedCommits">): {
  readonly canArchive: boolean;
  readonly canDelete: boolean;
} {
  return { canArchive: true, canDelete: !plan.hasPublishedCommits };
}

/** The row before or after the current one, clamped at the ends. */
export function resolveAdjacentId<T>(input: {
  readonly ids: readonly T[];
  readonly currentId: T | null;
  readonly direction: "previous" | "next";
}): T | null {
  const { currentId, direction, ids } = input;
  if (ids.length === 0) return null;

  if (currentId === null) {
    return direction === "previous" ? (ids.at(-1) ?? null) : (ids[0] ?? null);
  }

  const currentIndex = ids.indexOf(currentId);
  if (currentIndex === -1) return null;

  if (direction === "previous") {
    return currentIndex > 0 ? (ids[currentIndex - 1] ?? null) : null;
  }
  return currentIndex < ids.length - 1 ? (ids[currentIndex + 1] ?? null) : null;
}

/** The three things a plan row can be saying, in priority order. */
export type PlanRowStatus = "awaiting-input" | "working" | "unseen";

const PLAN_STATUS_PRIORITY: Record<PlanRowStatus, number> = {
  "awaiting-input": 3,
  working: 2,
  unseen: 1,
};

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

/** The most urgent status among children, retained for future plan rollups. */
export function resolveRollupStatus(
  statuses: ReadonlyArray<PlanRowStatus | null>,
): PlanRowStatus | null {
  let mostUrgent: PlanRowStatus | null = null;
  for (const status of statuses) {
    if (status === null) continue;
    if (mostUrgent === null || PLAN_STATUS_PRIORITY[status] > PLAN_STATUS_PRIORITY[mostUrgent]) {
      mostUrgent = status;
    }
  }
  return mostUrgent;
}

export type PlanRowMenuAction = "mark-unread" | "archive" | "delete";

/** One action list shared by the popup and native desktop context menus. */
export function buildPlanRowMenuItems(
  plan: Pick<PlanLifecycleFields, "hasPublishedCommits">,
): readonly ContextMenuItem<PlanRowMenuAction>[] {
  const { canDelete } = resolvePlanRowActions(plan);
  return [
    { id: "mark-unread", label: "Mark unread" },
    { id: "archive", label: "Archive" },
    ...(canDelete
      ? [
          {
            id: "delete",
            label: "Delete",
            destructive: true,
          } as const satisfies ContextMenuItem<PlanRowMenuAction>,
        ]
      : []),
  ];
}

export function sortProjectsForTree<T extends ProjectRowFields>(projects: readonly T[]): T[] {
  return [...projects].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.projectId.localeCompare(right.projectId);
    }
    return left.createdAt < right.createdAt ? -1 : 1;
  });
}
