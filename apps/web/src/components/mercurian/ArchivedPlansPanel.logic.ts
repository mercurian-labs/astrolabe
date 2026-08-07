import {
  partitionPlansByLifecycle,
  resolvePlanRowActions,
  sortProjectsForTree,
} from "./ProjectTreeSidebar.logic";

/** Structural shapes, not the wire types: the page reads ids, titles, and stamps. */
interface ArchivedPlanFields {
  readonly planId: string;
  readonly projectId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly hasPublishedCommits: boolean;
}

interface ArchivedProjectFields {
  readonly projectId: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface ArchivedPlanGroup<Project, Plan> {
  readonly project: Project;
  readonly plans: readonly Plan[];
}

/**
 * The Archived page's whole shape: archived plans grouped by their project.
 *
 * A project with nothing archived does not appear — the page is a list of what
 * left the tree, not a second copy of the tree. Projects keep the tree's own
 * order so the two read the same way; plans within one are most-recently
 * archived first, which is the order you look for something you just archived.
 */
export function groupArchivedPlansByProject<
  Project extends ArchivedProjectFields,
  Plan extends ArchivedPlanFields,
>(input: {
  readonly projects: readonly Project[];
  readonly plans: readonly Plan[];
}): ReadonlyArray<ArchivedPlanGroup<Project, Plan>> {
  const { archived } = partitionPlansByLifecycle(input.plans);
  if (archived.length === 0) {
    return [];
  }

  const byProject = new Map<string, Plan[]>();
  for (const plan of archived) {
    const existing = byProject.get(plan.projectId);
    if (existing === undefined) {
      byProject.set(plan.projectId, [plan]);
    } else {
      existing.push(plan);
    }
  }

  const groups: Array<ArchivedPlanGroup<Project, Plan>> = [];
  for (const project of sortProjectsForTree(input.projects)) {
    const plans = byProject.get(project.projectId);
    if (plans === undefined || plans.length === 0) {
      continue;
    }
    groups.push({ project, plans: sortPlansNewestArchivedFirst(plans) });
  }
  return groups;
}

/**
 * Newest-archived first. `createdAt` is the tiebreak for a row whose stamp is
 * somehow absent, so an unstamped plan still sorts rather than jumping about.
 */
function sortPlansNewestArchivedFirst<T extends ArchivedPlanFields>(plans: readonly T[]): T[] {
  return [...plans].sort((left, right) => {
    const leftKey = left.archivedAt ?? left.createdAt;
    const rightKey = right.archivedAt ?? right.createdAt;
    return rightKey.localeCompare(leftKey) || right.planId.localeCompare(left.planId);
  });
}

/**
 * Which verbs an archived row offers. Restore always; delete only for a plan
 * that is still fully private — "Delete is not offered here for published
 * plans" is the same rule the tree row reads, from the same helper.
 */
export function resolveArchivedRowActions(plan: Pick<ArchivedPlanFields, "hasPublishedCommits">): {
  readonly canRestore: boolean;
  readonly canDelete: boolean;
} {
  return { canRestore: true, canDelete: resolvePlanRowActions(plan).canDelete };
}
