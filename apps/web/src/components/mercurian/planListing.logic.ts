import type { ContextMenuItem } from "@t3tools/contracts";
import type {
  PlanLifecycleFields,
  PlanRowStatus,
} from "@t3tools/client-runtime/state/plan-listing";

export {
  partitionPlansByLifecycle,
  resolvePlanRowStatus,
  sortPlansNewestFirst,
  sortProjectsForTree,
  type PlanLifecycleFields,
  type PlanRowStatus,
  type PlanRowStatusFields,
} from "@t3tools/client-runtime/state/plan-listing";

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

const PLAN_STATUS_PRIORITY: Record<PlanRowStatus, number> = {
  "awaiting-input": 3,
  working: 2,
  unseen: 1,
};

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
