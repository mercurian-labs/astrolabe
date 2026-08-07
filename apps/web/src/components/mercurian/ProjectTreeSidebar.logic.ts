import type { ContextMenuItem } from "@t3tools/contracts";

import { cn } from "../../lib/utils";

/** Structural shapes, not the wire types: these helpers only ever read ids and timestamps. */
interface PlanRowFields {
  readonly planId: string;
  readonly projectId: string;
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

/**
 * Which tree row the current route belongs to.
 *
 * Selection is a prefix match, not an equality test: a plan stays highlighted
 * while you are anywhere inside it, so subpages added later inherit the
 * behavior without touching this.
 */
export interface TreeSelection {
  readonly activePlanId: string | null;
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
    // A draft is the creator's open composer, not a row — nothing highlights
    // until the first message births the plan.
    activePlanId: first === "plans" && second !== undefined && second !== "draft" ? second : null,
    isRepositoriesActive: first === "repositories",
    isSettingsActive: first === "settings",
  };
}

/** Newest first: the plans a project shows without expanding are the recent ones. */
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

/**
 * Active plans and archived ones, split the one way every surface needs them.
 *
 * The tree, the palette's recents, and any later listing all render `active`;
 * the Archived page in Settings renders `archived`. Keeping the split here
 * rather than in each caller is what makes "archiving removes the plan from
 * every listing" hold for listings that do not exist yet.
 */
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

/**
 * Which verbs a plan row offers.
 *
 * Archive is always one of them — it is every plan's disappearance, and the
 * only one a published plan has. Delete exists only while the plan is fully
 * private: before anything crossed into shared history the work was the
 * author's alone to destroy, and after it, it is not only theirs.
 */
export function resolvePlanRowActions(plan: Pick<PlanLifecycleFields, "hasPublishedCommits">): {
  readonly canArchive: boolean;
  readonly canDelete: boolean;
} {
  return { canArchive: true, canDelete: !plan.hasPublishedCommits };
}

export function groupPlansByProject<T extends PlanRowFields>(
  plans: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const plan of sortPlansNewestFirst(plans)) {
    const existing = grouped.get(plan.projectId);
    if (existing === undefined) {
      grouped.set(plan.projectId, [plan]);
    } else {
      existing.push(plan);
    }
  }
  return grouped;
}

/**
 * The preview slice and its overflow. The open plan is always visible, even
 * when it sits past the preview limit — a selected row that is not on screen
 * reads as no selection at all.
 */
export function getVisiblePlansForProject<T extends Pick<PlanRowFields, "planId">>(input: {
  readonly plans: readonly T[];
  readonly activePlanId: string | null;
  readonly isPlanListExpanded: boolean;
  readonly previewLimit: number;
}): {
  readonly hasHiddenPlans: boolean;
  readonly visiblePlans: T[];
  readonly hiddenPlans: T[];
} {
  const { activePlanId, isPlanListExpanded, previewLimit, plans } = input;
  const hasHiddenPlans = plans.length > previewLimit;

  if (!hasHiddenPlans || isPlanListExpanded) {
    return { hasHiddenPlans, hiddenPlans: [], visiblePlans: [...plans] };
  }

  const previewPlans = plans.slice(0, previewLimit);
  const activePlan =
    activePlanId === null ? undefined : plans.find((plan) => plan.planId === activePlanId);
  if (activePlan === undefined || previewPlans.includes(activePlan)) {
    return {
      hasHiddenPlans: true,
      hiddenPlans: plans.slice(previewLimit),
      visiblePlans: previewPlans,
    };
  }

  const visibleIds = new Set([...previewPlans, activePlan].map((plan) => plan.planId));
  return {
    hasHiddenPlans: true,
    hiddenPlans: plans.filter((plan) => !visibleIds.has(plan.planId)),
    visiblePlans: plans.filter((plan) => visibleIds.has(plan.planId)),
  };
}

const ROW_BASE_CLASS_NAME =
  "h-8 w-full translate-x-0 cursor-pointer justify-start rounded-md px-2 text-left text-sm select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

export function resolvePlanRowClassName(input: { readonly isActive: boolean }): string {
  return input.isActive
    ? cn(
        ROW_BASE_CLASS_NAME,
        "bg-sidebar-row-active text-sidebar-foreground font-medium hover:bg-sidebar-row-active hover:text-sidebar-foreground",
      )
    : cn(
        ROW_BASE_CLASS_NAME,
        "text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
      );
}

/**
 * A project row is never itself a destination, so it never reads as active —
 * it reads as containing the selection, which is a quieter treatment.
 */
export function resolveProjectRowClassName(input: { readonly containsSelection: boolean }): string {
  return input.containsSelection
    ? cn(ROW_BASE_CLASS_NAME, "bg-sidebar-row-selected text-sidebar-foreground font-medium")
    : cn(ROW_BASE_CLASS_NAME, "text-sidebar-foreground/90 font-medium hover:bg-sidebar-row-hover");
}

export function resolveWorkspaceRowClassName(input: { readonly isActive: boolean }): string {
  return resolvePlanRowClassName(input);
}

/**
 * The three things a row can be saying, in the order they matter. One status
 * per row: when several are true, the most urgent wins.
 *
 * Three words, deliberately, and not the fork's five pills. Signals from both
 * stores map *into this vocabulary before they are ranked* — a coding session's
 * pending approval and a plan's structured question are both awaiting-input —
 * so there is nothing left to rank inside a tier. One dot is one colour.
 */
export type PlanRowStatus = "awaiting-input" | "working" | "unseen";

const PLAN_STATUS_PRIORITY: Record<PlanRowStatus, number> = {
  "awaiting-input": 3,
  working: 2,
  unseen: 1,
};

/**
 * The facts a status is ranked from. Structural, like every shape in this file:
 * the resolver reads booleans and timestamps, never the wire type.
 *
 * `hasPendingInput` and `isWorking` are server-derived; the client ranks them
 * and never originates them. `unseen` is not among them because it is not a
 * fact of its own — it is the comparison below.
 */
export interface PlanRowStatusFields {
  readonly hasPendingInput: boolean;
  readonly isWorking: boolean;
  readonly updatedAt: string;
  readonly visitedAt?: string | undefined;
}

/**
 * Has this plan moved since you last looked at it?
 *
 * NaN-safe in both directions, and asymmetrically so on purpose. Activity we
 * cannot read is not evidence that anything happened, so a malformed
 * `updatedAt` never pins a row to unseen forever; a malformed *visit*, against
 * activity we can read, means we do not know that you have seen it, and the
 * honest answer there is to show the dot.
 */
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

/**
 * What a row says on behalf of everything under it: the most urgent of its
 * children, or nothing when they are all quiet.
 *
 * Level-agnostic by construction — a collapsed project over its plans today,
 * and a plan over its coding sessions when those rows arrive. The rollup does
 * not know which level it is at, which is why it does not need changing when a
 * level is added.
 */
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

/**
 * Everything a plan row can be told to do, in one list.
 *
 * Two surfaces render it — the native context menu on desktop, and the row's
 * own popup everywhere — and they must not drift, so neither builds its own.
 * Renaming is still absent for the reason the mark-unread menu gave for
 * archive and delete: an item that does nothing is worse than an item that is
 * not there.
 *
 * Delete is omitted rather than disabled once a plan has published work. The
 * rule is that delete does not exist for such a plan, and a greyed-out verb
 * says the opposite — that it exists and you are not allowed it.
 */
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
