import { describe, expect, it } from "vite-plus/test";

import {
  buildPlanRowMenuItems,
  resolveAdjacentId,
  resolvePlanRowActions,
  resolveRollupStatus,
  resolveTreeActivePlanId,
  resolveTreeSelection,
} from "./planListing.logic";

describe("resolveTreeSelection", () => {
  it("selects a plan and keeps it selected on its subpages", () => {
    expect(resolveTreeSelection("/plans/plan-1").activePlanId).toBe("plan-1");
    expect(resolveTreeSelection("/plans/plan-1/anything/deeper").activePlanId).toBe("plan-1");
  });

  it("selects nothing for an unsent draft", () => {
    expect(resolveTreeSelection("/plans/draft/draft-1").activePlanId).toBeNull();
  });

  it("selects a coding session by its thread id", () => {
    const selection = resolveTreeSelection("/sessions/thread%20one");
    expect(selection).toMatchObject({
      activePlanId: null,
      activeSessionThreadId: "thread one",
    });
    expect(
      resolveTreeActivePlanId(selection, [
        { planId: "plan-1", codingSessions: [{ threadId: "thread one" }] },
        { planId: "plan-2", codingSessions: [] },
      ]),
    ).toBe("plan-1");
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
