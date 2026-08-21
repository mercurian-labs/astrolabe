import {
  filterPlansByProjectScope,
  pageArchivedPlans,
  partitionPlansByLifecycle,
  sortPlansNewestArchivedFirst,
  sortPlansNewestFirst,
} from "@t3tools/client-runtime/state/plan-listing";
import type { EnvironmentId, PlanTreeRow } from "@t3tools/contracts";

import type { WorkspaceState } from "../../state/workspaceModel";

export type PlanListItem =
  | { readonly type: "plan"; readonly key: string; readonly plan: PlanTreeRow }
  | {
      readonly type: "archived-shelf";
      readonly key: "archived-shelf";
      readonly count: number;
      readonly expanded: boolean;
    }
  | { readonly type: "archived-plan"; readonly key: string; readonly plan: PlanTreeRow }
  | {
      readonly type: "archived-show-more";
      readonly key: "archived-show-more";
      readonly hiddenCount: number;
      readonly nextPageCount: number;
    };

export function buildPlanListItems(input: {
  readonly plans: ReadonlyArray<PlanTreeRow>;
  readonly projectScopeId: string | null;
  readonly archivedExpanded: boolean;
  readonly archivedPage: number;
}): ReadonlyArray<PlanListItem> {
  const scoped = filterPlansByProjectScope(input.plans, input.projectScopeId);
  const { active, archived } = partitionPlansByLifecycle(scoped);
  const items: PlanListItem[] = sortPlansNewestFirst(active).map((plan) => ({
    type: "plan",
    key: `plan:${plan.planId}`,
    plan,
  }));

  if (archived.length === 0) return items;

  items.push({
    type: "archived-shelf",
    key: "archived-shelf",
    count: archived.length,
    expanded: input.archivedExpanded,
  });
  if (!input.archivedExpanded) return items;

  const page = pageArchivedPlans(sortPlansNewestArchivedFirst(archived), input.archivedPage);
  items.push(
    ...page.visible.map((plan) => ({
      type: "archived-plan" as const,
      key: `archived-plan:${plan.planId}`,
      plan,
    })),
  );
  if (page.hiddenCount > 0) {
    items.push({
      type: "archived-show-more",
      key: "archived-show-more",
      hiddenCount: page.hiddenCount,
      nextPageCount: page.nextPageCount,
    });
  }
  return items;
}

export function planListItemsAreEqual(previous: PlanListItem, item: PlanListItem): boolean {
  switch (item.type) {
    case "plan":
      return previous.type === "plan" && previous.plan === item.plan;
    case "archived-shelf":
      return (
        previous.type === "archived-shelf" &&
        previous.count === item.count &&
        previous.expanded === item.expanded
      );
    case "archived-plan":
      return previous.type === "archived-plan" && previous.plan === item.plan;
    case "archived-show-more":
      return (
        previous.type === "archived-show-more" &&
        previous.hiddenCount === item.hiddenCount &&
        previous.nextPageCount === item.nextPageCount
      );
  }
}

export function resolvePlanListEnvironmentId(
  selectedId: EnvironmentId | null,
  available: ReadonlyArray<EnvironmentId>,
): EnvironmentId | null {
  if (selectedId !== null && available.includes(selectedId)) return selectedId;
  return available[0] ?? null;
}

export interface PlanListEmptyState {
  readonly title: string;
  readonly detail: string;
  readonly loading: boolean;
  readonly canAddEnvironment: boolean;
}

export function derivePlanListEmptyState(input: {
  readonly catalogState: Pick<
    WorkspaceState,
    "isLoadingConnections" | "hasConnections" | "connectionState" | "connectionError"
  >;
  readonly environmentId: EnvironmentId | null;
  readonly environmentConnectionState: WorkspaceState["connectionState"] | null;
  readonly treePending: boolean;
  readonly itemCount: number;
  readonly projectScopeName: string | null;
}): PlanListEmptyState | null {
  if (input.catalogState.isLoadingConnections) {
    return {
      title: "Loading environments",
      detail: "Checking saved environments on this device.",
      loading: true,
      canAddEnvironment: false,
    };
  }
  if (!input.catalogState.hasConnections || input.environmentId === null) {
    return {
      title: "No environments connected",
      detail: "Add an environment to load plans.",
      loading: false,
      canAddEnvironment: true,
    };
  }
  if (
    input.treePending &&
    (input.environmentConnectionState === "available" ||
      input.environmentConnectionState === "offline" ||
      input.environmentConnectionState === "error")
  ) {
    return {
      title: "Environment unavailable",
      detail:
        input.catalogState.connectionError ??
        "The saved environment is offline. Check the URL or start the environment, then retry.",
      loading: false,
      canAddEnvironment: true,
    };
  }
  if (
    input.treePending &&
    (input.environmentConnectionState === "connecting" ||
      input.environmentConnectionState === "reconnecting")
  ) {
    return {
      title: "Connecting to environment",
      detail: "Loading plans from the saved environment.",
      loading: true,
      canAddEnvironment: false,
    };
  }
  if (input.treePending) {
    return {
      title: "Loading plans",
      detail: "Waiting for the planning tree.",
      loading: true,
      canAddEnvironment: false,
    };
  }
  if (input.itemCount > 0) return null;
  if (input.projectScopeName !== null) {
    return {
      title: `No plans in ${input.projectScopeName} yet`,
      detail: "Choose another project to see its plans.",
      loading: false,
      canAddEnvironment: false,
    };
  }
  return {
    title: "No plans yet",
    detail: "Plans created in this workspace will appear here.",
    loading: false,
    canAddEnvironment: false,
  };
}
