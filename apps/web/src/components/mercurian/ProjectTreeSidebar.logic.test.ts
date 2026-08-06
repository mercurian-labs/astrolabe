import { describe, expect, it } from "vite-plus/test";

import {
  getVisiblePlansForProject,
  groupPlansByProject,
  partitionPlansByLifecycle,
  resolvePlanRowActions,
  resolveTreeSelection,
  sortPlansNewestFirst,
  sortProjectsForTree,
} from "./ProjectTreeSidebar.logic";

const plan = (planId: string, updatedAt: string, projectId = "project-a") => ({
  planId,
  projectId,
  updatedAt,
});

describe("resolveTreeSelection", () => {
  it("selects a plan and keeps it selected on its subpages", () => {
    expect(resolveTreeSelection("/plans/plan-1").activePlanId).toBe("plan-1");
    expect(resolveTreeSelection("/plans/plan-1/anything/deeper").activePlanId).toBe("plan-1");
  });

  it("selects nothing for an unsent draft", () => {
    expect(resolveTreeSelection("/plans/draft/draft-1").activePlanId).toBeNull();
  });

  it("selects the workspace rows by prefix", () => {
    expect(resolveTreeSelection("/repositories").isRepositoriesActive).toBe(true);
    expect(resolveTreeSelection("/settings/appearance").isSettingsActive).toBe(true);
    expect(resolveTreeSelection("/settings/trackers").isSettingsActive).toBe(true);
    expect(resolveTreeSelection("/settings/preferences").isSettingsActive).toBe(true);
    expect(resolveTreeSelection("/settings/appearance").isRepositoriesActive).toBe(false);
    expect(resolveTreeSelection("/").activePlanId).toBeNull();
  });
});

describe("sortPlansNewestFirst", () => {
  it("orders by updatedAt descending, then by id", () => {
    const sorted = sortPlansNewestFirst([
      plan("b", "2026-08-01T00:00:00.000Z"),
      plan("c", "2026-08-03T00:00:00.000Z"),
      plan("a", "2026-08-01T00:00:00.000Z"),
    ]);
    expect(sorted.map((entry) => entry.planId)).toEqual(["c", "a", "b"]);
  });
});

describe("groupPlansByProject", () => {
  it("groups plans under their project, newest first", () => {
    const grouped = groupPlansByProject([
      plan("a", "2026-08-01T00:00:00.000Z", "one"),
      plan("b", "2026-08-02T00:00:00.000Z", "one"),
      plan("c", "2026-08-02T00:00:00.000Z", "two"),
    ]);
    expect(grouped.get("one")?.map((entry) => entry.planId)).toEqual(["b", "a"]);
    expect(grouped.get("two")?.map((entry) => entry.planId)).toEqual(["c"]);
  });
});

describe("getVisiblePlansForProject", () => {
  const plans = ["a", "b", "c", "d"].map((id, index) =>
    plan(id, `2026-08-0${4 - index}T00:00:00.000Z`),
  );

  it("shows everything when the project fits under the limit", () => {
    const result = getVisiblePlansForProject({
      plans,
      activePlanId: null,
      isPlanListExpanded: false,
      previewLimit: 6,
    });
    expect(result.hasHiddenPlans).toBe(false);
    expect(result.visiblePlans).toHaveLength(4);
    expect(result.hiddenPlans).toHaveLength(0);
  });

  it("slices to the preview limit and reports the overflow", () => {
    const result = getVisiblePlansForProject({
      plans,
      activePlanId: null,
      isPlanListExpanded: false,
      previewLimit: 2,
    });
    expect(result.hasHiddenPlans).toBe(true);
    expect(result.visiblePlans.map((entry) => entry.planId)).toEqual(["a", "b"]);
    expect(result.hiddenPlans.map((entry) => entry.planId)).toEqual(["c", "d"]);
  });

  it("keeps the open plan visible even past the limit", () => {
    const result = getVisiblePlansForProject({
      plans,
      activePlanId: "d",
      isPlanListExpanded: false,
      previewLimit: 2,
    });
    expect(result.visiblePlans.map((entry) => entry.planId)).toEqual(["a", "b", "d"]);
    expect(result.hiddenPlans.map((entry) => entry.planId)).toEqual(["c"]);
  });

  it("shows everything once the list is expanded", () => {
    const result = getVisiblePlansForProject({
      plans,
      activePlanId: null,
      isPlanListExpanded: true,
      previewLimit: 2,
    });
    expect(result.hasHiddenPlans).toBe(true);
    expect(result.hiddenPlans).toHaveLength(0);
    expect(result.visiblePlans).toHaveLength(4);
  });
});

describe("sortProjectsForTree", () => {
  it("orders projects by creation, oldest first", () => {
    const sorted = sortProjectsForTree([
      { projectId: "b", createdAt: "2026-08-02T00:00:00.000Z" },
      { projectId: "a", createdAt: "2026-08-01T00:00:00.000Z" },
    ]);
    expect(sorted.map((entry) => entry.projectId)).toEqual(["a", "b"]);
  });
});

describe("partitionPlansByLifecycle", () => {
  it("keeps archived plans out of the active listing", () => {
    const { active, archived } = partitionPlansByLifecycle([
      { planId: "a", archivedAt: null },
      { planId: "b", archivedAt: "2026-08-04T00:00:00.000Z" },
      { planId: "c", archivedAt: null },
    ]);
    expect(active.map((plan) => plan.planId)).toEqual(["a", "c"]);
    expect(archived.map((plan) => plan.planId)).toEqual(["b"]);
  });

  it("keeps the order it was given, so callers stay in charge of sorting", () => {
    const { active } = partitionPlansByLifecycle([
      { planId: "z", archivedAt: null },
      { planId: "a", archivedAt: null },
    ]);
    expect(active.map((plan) => plan.planId)).toEqual(["z", "a"]);
  });
});

describe("resolvePlanRowActions", () => {
  it("offers delete only while the plan is fully private", () => {
    expect(resolvePlanRowActions({ hasPublishedCommits: false })).toEqual({
      canArchive: true,
      canDelete: true,
    });
    expect(resolvePlanRowActions({ hasPublishedCommits: true })).toEqual({
      canArchive: true,
      canDelete: false,
    });
  });
});
