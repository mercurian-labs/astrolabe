import { describe, expect, it } from "vite-plus/test";

import { planTreeRow } from "../../test/fixtures/plan";

import {
  codingSessionDetailLabel,
  filterPlansByProjectScope,
  listJumpTargets,
  pageArchivedPlans,
  partitionSidebarPlans,
  resolveDraftRows,
  resolvePlanCardStatus,
  resolveSidebarSelection,
} from "./PlanListSidebar.logic";

describe("codingSessionDetailLabel", () => {
  it("keeps session state and branch in the detail popover", () => {
    expect(codingSessionDetailLabel({ branch: "mercurian/ship-12345678", endedAt: null })).toBe(
      "Running · mercurian/ship-12345678",
    );
    expect(
      codingSessionDetailLabel({
        branch: "renamed/session",
        endedAt: "2026-08-18T00:00:00.000Z",
      }),
    ).toBe("Ended · renamed/session");
  });
});

const plan = (
  planId: string,
  overrides: {
    readonly projectId?: string;
    readonly updatedAt?: string;
    readonly visitedAt?: string | undefined;
    readonly archivedAt?: string | null;
    readonly hasPendingInput?: boolean;
    readonly isWorking?: boolean;
  } = {},
) =>
  planTreeRow(planId, {
    projectId: overrides.projectId ?? "project-a",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-03T00:00:00.000Z",
    visitedAt: "visitedAt" in overrides ? overrides.visitedAt : "2026-08-03T00:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    hasPendingInput: overrides.hasPendingInput ?? false,
    isWorking: overrides.isWorking ?? false,
  });

describe("filterPlansByProjectScope", () => {
  const plans = [plan("a"), plan("b", { projectId: "project-b" })];

  it("keeps every project in the default scope", () => {
    expect(filterPlansByProjectScope(plans, null).map((row) => row.planId)).toEqual(["a", "b"]);
  });

  it("keeps only the selected project's plans", () => {
    expect(filterPlansByProjectScope(plans, "project-b").map((row) => row.planId)).toEqual(["b"]);
  });
});

describe("partitionSidebarPlans", () => {
  it("splits active from archived and applies each section's newest-first order", () => {
    const rows = partitionSidebarPlans(
      [
        plan("active-old", { updatedAt: "2026-08-02T00:00:00.000Z" }),
        plan("archived-old", { archivedAt: "2026-08-04T00:00:00.000Z" }),
        plan("active-new", { updatedAt: "2026-08-08T00:00:00.000Z" }),
        plan("archived-new", { archivedAt: "2026-08-07T00:00:00.000Z" }),
      ],
      null,
    );

    expect(rows.active.map((row) => row.planId)).toEqual(["active-new", "active-old"]);
    expect(rows.archived.map((row) => row.planId)).toEqual(["archived-new", "archived-old"]);
  });

  it("scopes both lifecycle sections", () => {
    const rows = partitionSidebarPlans(
      [
        plan("active-a"),
        plan("active-b", { projectId: "project-b" }),
        plan("archived-b", {
          projectId: "project-b",
          archivedAt: "2026-08-07T00:00:00.000Z",
        }),
      ],
      "project-b",
    );

    expect(rows.active.map((row) => row.planId)).toEqual(["active-b"]);
    expect(rows.archived.map((row) => row.planId)).toEqual(["archived-b"]);
  });
});

describe("resolvePlanCardStatus", () => {
  it("puts working and awaiting-input in the slot using the existing priority", () => {
    expect(resolvePlanCardStatus(plan("working", { isWorking: true })).slot).toBe("working");
    expect(
      resolvePlanCardStatus(plan("asking", { hasPendingInput: true, isWorking: true })).slot,
    ).toBe("awaiting-input");
  });

  it("maps unseen activity to title weight, independently of the live slot", () => {
    const updatedAt = "2026-08-08T00:00:00.000Z";
    expect(
      resolvePlanCardStatus(
        plan("unread-working", {
          updatedAt,
          visitedAt: "2026-08-02T00:00:00.000Z",
          isWorking: true,
        }),
      ),
    ).toEqual({ slot: "working", unread: true });
    expect(resolvePlanCardStatus(plan("unread", { updatedAt, visitedAt: undefined }))).toEqual({
      slot: null,
      unread: true,
    });
    expect(resolvePlanCardStatus(plan("quiet"))).toEqual({ slot: null, unread: false });
  });
});

describe("pageArchivedPlans", () => {
  const plans = Array.from({ length: 70 }, (_, index) => ({ planId: `plan-${index}` }));

  it("shows 10 initially, then 25 more per page", () => {
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

  it("resets to the first ten when the caller resets the page index", () => {
    expect(pageArchivedPlans(plans, 2).visible).toHaveLength(60);
    expect(pageArchivedPlans(plans, 0).visible).toHaveLength(10);
  });
});

describe("listJumpTargets", () => {
  it("lists active plan ids in drawn order and excludes archived rows", () => {
    const { active } = partitionSidebarPlans(
      [
        plan("new", { updatedAt: "2026-08-08T00:00:00.000Z" }),
        plan("archived", { archivedAt: "2026-08-09T00:00:00.000Z" }),
        plan("old", { updatedAt: "2026-08-01T00:00:00.000Z" }),
      ],
      null,
    );
    expect(listJumpTargets(active)).toEqual(["new", "old"]);
    expect(listJumpTargets([])).toEqual([]);
  });
});

describe("resolveDraftRows", () => {
  const drafts = {
    empty: {
      draftId: "empty",
      projectId: "project-a",
      text: "  \n",
      createdAt: "2026-08-09T00:00:00.000Z",
    },
    old: {
      draftId: "old",
      projectId: "project-a",
      text: "First idea",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    newest: {
      draftId: "newest",
      projectId: "project-b",
      text: "Second idea",
      createdAt: "2026-08-08T00:00:00.000Z",
    },
  };

  it("keeps invested drafts only and orders them newest first", () => {
    expect(resolveDraftRows(drafts, null).map((row) => row.draftId)).toEqual(["newest", "old"]);
  });

  it("applies the same project scope as plan cards", () => {
    expect(resolveDraftRows(drafts, "project-a").map((row) => row.draftId)).toEqual(["old"]);
  });
});

describe("resolveSidebarSelection", () => {
  it("selects plan routes and their subpages", () => {
    expect(resolveSidebarSelection("/plans/plan-1/timeline")).toMatchObject({
      activePlanId: "plan-1",
      activeDraftId: null,
    });
    expect(resolveSidebarSelection("/threads/plan-1")).toMatchObject({
      activePlanId: "plan-1",
      activeDraftId: null,
    });
  });

  it("selects draft routes without selecting a plan", () => {
    expect(resolveSidebarSelection("/plans/draft/draft%201")).toMatchObject({
      activePlanId: null,
      activeDraftId: "draft 1",
    });
  });

  it("carries over repositories and settings selection", () => {
    expect(resolveSidebarSelection("/repositories").isRepositoriesActive).toBe(true);
    expect(resolveSidebarSelection("/memory").isMemoryActive).toBe(true);
    expect(resolveSidebarSelection("/repositories").isMemoryActive).toBe(false);
    expect(resolveSidebarSelection("/settings/archived").isSettingsActive).toBe(true);
  });
});
