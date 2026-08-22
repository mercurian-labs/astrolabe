import { describe, expect, it } from "vite-plus/test";

import {
  filterPlansByProjectScope,
  pageArchivedPlans,
  partitionPlansByLifecycle,
  resolvePlanCardStatus,
  resolvePlanRowStatus,
  sortPlansNewestArchivedFirst,
  sortPlansNewestFirst,
  sortProjectsForTree,
} from "./planListing.js";

const plan = (
  planId: string,
  overrides: {
    readonly projectId?: string;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly visitedAt?: string | undefined;
    readonly archivedAt?: string | null;
    readonly hasPendingInput?: boolean;
    readonly isWorking?: boolean;
  } = {},
) => ({
  planId,
  projectId: overrides.projectId ?? "project-a",
  createdAt: overrides.createdAt ?? "2026-08-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-08-03T00:00:00.000Z",
  visitedAt: "visitedAt" in overrides ? overrides.visitedAt : "2026-08-03T00:00:00.000Z",
  archivedAt: overrides.archivedAt ?? null,
  hasPublishedCommits: false,
  hasPendingInput: overrides.hasPendingInput ?? false,
  isWorking: overrides.isWorking ?? false,
});

describe("shared plan listing order", () => {
  it("orders active plans newest first and breaks ties by id", () => {
    const sorted = sortPlansNewestFirst([
      plan("b", { updatedAt: "2026-08-01T00:00:00.000Z" }),
      plan("c", { updatedAt: "2026-08-03T00:00:00.000Z" }),
      plan("a", { updatedAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(sorted.map((entry) => entry.planId)).toEqual(["c", "a", "b"]);
  });

  it("orders projects oldest first", () => {
    const sorted = sortProjectsForTree([
      { projectId: "b", createdAt: "2026-08-02T00:00:00.000Z" },
      { projectId: "a", createdAt: "2026-08-01T00:00:00.000Z" },
    ]);
    expect(sorted.map((entry) => entry.projectId)).toEqual(["a", "b"]);
  });

  it("orders archived plans by the newest archive stamp", () => {
    const sorted = sortPlansNewestArchivedFirst([
      plan("old", { archivedAt: "2026-08-02T00:00:00.000Z" }),
      plan("new", { archivedAt: "2026-08-06T00:00:00.000Z" }),
      plan("mid", { archivedAt: "2026-08-04T00:00:00.000Z" }),
    ]);
    expect(sorted.map((entry) => entry.planId)).toEqual(["new", "mid", "old"]);
  });
});

describe("partitionPlansByLifecycle", () => {
  it("splits active and archived plans without changing source order", () => {
    const { active, archived } = partitionPlansByLifecycle([
      plan("z"),
      plan("archived", { archivedAt: "2026-08-04T00:00:00.000Z" }),
      plan("a"),
    ]);
    expect(active.map((entry) => entry.planId)).toEqual(["z", "a"]);
    expect(archived.map((entry) => entry.planId)).toEqual(["archived"]);
  });
});

describe("plan row status grammar", () => {
  it("prioritizes awaiting input, then working, then unseen", () => {
    expect(
      resolvePlanRowStatus(
        plan("asking", {
          hasPendingInput: true,
          isWorking: true,
          visitedAt: "2026-08-02T00:00:00.000Z",
        }),
      ),
    ).toBe("awaiting-input");
    expect(
      resolvePlanRowStatus(
        plan("working", { isWorking: true, visitedAt: "2026-08-02T00:00:00.000Z" }),
      ),
    ).toBe("working");
    expect(resolvePlanRowStatus(plan("unseen", { visitedAt: "2026-08-02T00:00:00.000Z" }))).toBe(
      "unseen",
    );
  });

  it("returns null when quiet and handles never-visited and malformed stamps", () => {
    expect(resolvePlanRowStatus(plan("quiet"))).toBeNull();
    expect(resolvePlanRowStatus(plan("never", { visitedAt: undefined }))).toBe("unseen");
    expect(
      resolvePlanRowStatus(plan("bad", { updatedAt: "not a date", visitedAt: undefined })),
    ).toBeNull();
  });

  it("keeps the live slot independent from unread title emphasis", () => {
    expect(
      resolvePlanCardStatus(
        plan("working-unread", {
          updatedAt: "2026-08-08T00:00:00.000Z",
          visitedAt: "2026-08-02T00:00:00.000Z",
          isWorking: true,
        }),
      ),
    ).toEqual({ slot: "working", unread: true });
  });
});

describe("project scope and archive paging", () => {
  it("filters plans to the selected project or keeps all by default", () => {
    const plans = [plan("a"), plan("b", { projectId: "project-b" })];
    expect(filterPlansByProjectScope(plans, null).map((entry) => entry.planId)).toEqual(["a", "b"]);
    expect(filterPlansByProjectScope(plans, "project-b").map((entry) => entry.planId)).toEqual([
      "b",
    ]);
  });

  it("shows 10 archived plans first and 25 more per page", () => {
    const plans = Array.from({ length: 70 }, (_, index) => ({ planId: `plan-${index}` }));
    expect(pageArchivedPlans(plans, 0)).toMatchObject({
      visible: plans.slice(0, 10),
      hiddenCount: 60,
      nextPageCount: 25,
    });
    expect(pageArchivedPlans(plans, 1)).toMatchObject({
      visible: plans.slice(0, 35),
      hiddenCount: 35,
      nextPageCount: 25,
    });
    expect(pageArchivedPlans(plans, 2)).toMatchObject({
      visible: plans.slice(0, 60),
      hiddenCount: 10,
      nextPageCount: 10,
    });
  });
});
