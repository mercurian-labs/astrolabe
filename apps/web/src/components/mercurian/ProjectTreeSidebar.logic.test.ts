import { describe, expect, it } from "vite-plus/test";

import {
  buildPlanRowContextMenuItems,
  getVisiblePlansForProject,
  groupPlansByProject,
  resolvePlanRowStatus,
  resolveRollupStatus,
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

/**
 * The producer facts stand in synthetically here. No user act can raise them
 * until planning turns and session approvals ship, so the ladder they will feed
 * is exercised at the shape of the contract they will feed it through.
 */
const row = (fields: {
  readonly hasPendingInput?: boolean;
  readonly isWorking?: boolean;
  readonly updatedAt?: string;
  readonly visitedAt?: string | undefined;
}) => ({
  hasPendingInput: fields.hasPendingInput ?? false,
  isWorking: fields.isWorking ?? false,
  updatedAt: fields.updatedAt ?? "2026-08-03T00:00:00.000Z",
  visitedAt: fields.visitedAt,
});

describe("resolvePlanRowStatus", () => {
  it("shows one status: the most urgent thing true of the row", () => {
    expect(
      resolvePlanRowStatus(
        row({ hasPendingInput: true, isWorking: true, visitedAt: "2026-08-02T00:00:00.000Z" }),
      ),
    ).toBe("awaiting-input");
    expect(
      resolvePlanRowStatus(row({ isWorking: true, visitedAt: "2026-08-02T00:00:00.000Z" })),
    ).toBe("working");
    expect(resolvePlanRowStatus(row({ visitedAt: "2026-08-02T00:00:00.000Z" }))).toBe("unseen");
  });

  it("says nothing about a quiet row", () => {
    expect(resolvePlanRowStatus(row({ visitedAt: "2026-08-03T00:00:00.000Z" }))).toBeNull();
    expect(resolvePlanRowStatus(row({ visitedAt: "2026-08-04T00:00:00.000Z" }))).toBeNull();
  });

  it("outranks unseen with a working row even when both are true", () => {
    expect(
      resolvePlanRowStatus(row({ isWorking: true, visitedAt: "2026-08-01T00:00:00.000Z" })),
    ).toBe("working");
  });

  it("treats a plan you have never opened as unseen", () => {
    expect(resolvePlanRowStatus(row({ visitedAt: undefined }))).toBe("unseen");
  });

  it("does not let a malformed timestamp decide anything it should not", () => {
    // Activity we cannot read is not evidence that anything happened.
    expect(resolvePlanRowStatus(row({ updatedAt: "not a date", visitedAt: undefined }))).toBeNull();
    // A visit we cannot read is not evidence that you have seen it.
    expect(resolvePlanRowStatus(row({ visitedAt: "not a date" }))).toBe("unseen");
  });
});

describe("resolveRollupStatus", () => {
  it("gives the row the most urgent status among its children", () => {
    expect(resolveRollupStatus(["unseen", "awaiting-input", "working"])).toBe("awaiting-input");
    expect(resolveRollupStatus(["unseen", "working"])).toBe("working");
    expect(resolveRollupStatus(["unseen", "unseen"])).toBe("unseen");
  });

  it("ignores quiet children, and stays quiet when they all are", () => {
    expect(resolveRollupStatus([null, "unseen", null])).toBe("unseen");
    expect(resolveRollupStatus([null, null])).toBeNull();
    expect(resolveRollupStatus([])).toBeNull();
  });
});

describe("buildPlanRowContextMenuItems", () => {
  it("offers the way back to unseen, and nothing else yet", () => {
    expect(buildPlanRowContextMenuItems()).toEqual([{ id: "mark-unread", label: "Mark unread" }]);
  });
});
