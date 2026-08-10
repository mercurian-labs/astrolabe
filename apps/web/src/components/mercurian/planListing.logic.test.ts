import { describe, expect, it } from "vite-plus/test";

import {
  buildPlanRowMenuItems,
  partitionPlansByLifecycle,
  resolveAdjacentId,
  resolvePlanRowActions,
  resolvePlanRowStatus,
  resolveRollupStatus,
  resolveTreeSelection,
  sortPlansNewestFirst,
  sortProjectsForTree,
} from "./planListing.logic";

const plan = (planId: string, updatedAt: string) => ({ planId, updatedAt });

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

describe("sortProjectsForTree", () => {
  it("orders projects by creation, oldest first", () => {
    const sorted = sortProjectsForTree([
      { projectId: "b", createdAt: "2026-08-02T00:00:00.000Z" },
      { projectId: "a", createdAt: "2026-08-01T00:00:00.000Z" },
    ]);
    expect(sorted.map((entry) => entry.projectId)).toEqual(["a", "b"]);
  });
});

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
    expect(resolvePlanRowStatus(row({ updatedAt: "not a date", visitedAt: undefined }))).toBeNull();
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

describe("buildPlanRowMenuItems", () => {
  it("offers mark-unread beside the two ways out of the listing", () => {
    expect(buildPlanRowMenuItems({ hasPublishedCommits: false })).toEqual([
      { id: "mark-unread", label: "Mark unread" },
      { id: "archive", label: "Archive" },
      { id: "delete", label: "Delete", destructive: true },
    ]);
  });

  it("drops delete entirely once the plan has published work", () => {
    expect(buildPlanRowMenuItems({ hasPublishedCommits: true })).toEqual([
      { id: "mark-unread", label: "Mark unread" },
      { id: "archive", label: "Archive" },
    ]);
  });
});

describe("partitionPlansByLifecycle", () => {
  it("keeps archived plans out of the active listing", () => {
    const { active, archived } = partitionPlansByLifecycle([
      { planId: "a", archivedAt: null },
      { planId: "b", archivedAt: "2026-08-04T00:00:00.000Z" },
      { planId: "c", archivedAt: null },
    ]);
    expect(active.map((entry) => entry.planId)).toEqual(["a", "c"]);
    expect(archived.map((entry) => entry.planId)).toEqual(["b"]);
  });

  it("keeps source order so callers stay in charge of sorting", () => {
    const { active } = partitionPlansByLifecycle([
      { planId: "z", archivedAt: null },
      { planId: "a", archivedAt: null },
    ]);
    expect(active.map((entry) => entry.planId)).toEqual(["z", "a"]);
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

describe("resolveAdjacentId", () => {
  const ids = ["a", "b", "c"];

  it("steps either way and clamps at the ends", () => {
    expect(resolveAdjacentId({ ids, currentId: "b", direction: "next" })).toBe("c");
    expect(resolveAdjacentId({ ids, currentId: "b", direction: "previous" })).toBe("a");
    expect(resolveAdjacentId({ ids, currentId: "c", direction: "next" })).toBeNull();
    expect(resolveAdjacentId({ ids, currentId: "a", direction: "previous" })).toBeNull();
  });

  it("enters from the near end when nothing is open", () => {
    expect(resolveAdjacentId({ ids, currentId: null, direction: "next" })).toBe("a");
    expect(resolveAdjacentId({ ids, currentId: null, direction: "previous" })).toBe("c");
  });

  it("has nowhere to go from a row that is not there", () => {
    expect(resolveAdjacentId({ ids, currentId: "gone", direction: "next" })).toBeNull();
    expect(resolveAdjacentId({ ids: [], currentId: null, direction: "next" })).toBeNull();
  });
});
