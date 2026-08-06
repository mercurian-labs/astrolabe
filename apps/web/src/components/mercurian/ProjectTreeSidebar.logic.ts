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

export function sortProjectsForTree<T extends ProjectRowFields>(projects: readonly T[]): T[] {
  return [...projects].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.projectId.localeCompare(right.projectId);
    }
    return left.createdAt < right.createdAt ? -1 : 1;
  });
}
