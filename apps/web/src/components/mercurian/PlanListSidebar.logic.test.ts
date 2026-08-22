import { describe, expect, it } from "vite-plus/test";

import { planTreeRow } from "../../test/fixtures/plan";

import {
  codingSessionDetailLabel,
  listJumpTargets,
  partitionSidebarPlans,
  resolveDraftRows,
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
  });

  it("selects draft routes without selecting a plan", () => {
    expect(resolveSidebarSelection("/plans/draft/draft%201")).toMatchObject({
      activePlanId: null,
      activeDraftId: "draft 1",
    });
  });

  it("carries over repositories and settings selection", () => {
    expect(resolveSidebarSelection("/repositories").isRepositoriesActive).toBe(true);
    expect(resolveSidebarSelection("/settings/archived").isSettingsActive).toBe(true);
  });
});
