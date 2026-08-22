import { EnvironmentId, MercurianProjectId, PlanId, type PlanTreeRow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildPlanListItems,
  derivePlanListEmptyState,
  planListItemsAreEqual,
  resolvePlanListEnvironmentId,
} from "./planListItems";

const makePlan = (id: string, overrides: Partial<PlanTreeRow> = {}): PlanTreeRow => ({
  planId: PlanId.make(id),
  projectId: MercurianProjectId.make("project-a"),
  title: `Plan ${id}`,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  hasPendingInput: false,
  isWorking: false,
  archivedAt: null,
  hasPublishedCommits: false,
  codingSessions: [],
  ...overrides,
});

const catalogState = {
  isLoadingConnections: false,
  hasConnections: true,
  connectionState: "connected" as const,
  connectionError: null,
};

describe("buildPlanListItems", () => {
  const activeOld = makePlan("active-old", { updatedAt: "2026-08-02T00:00:00.000Z" });
  const activeNew = makePlan("active-new", { updatedAt: "2026-08-08T00:00:00.000Z" });
  const archived = Array.from({ length: 40 }, (_, index) =>
    makePlan(`archived-${index}`, {
      archivedAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
    }),
  );

  it("draws newest active rows before a collapsed archived shelf", () => {
    const items = buildPlanListItems({
      plans: [activeOld, ...archived, activeNew],
      projectScopeId: null,
      archivedExpanded: false,
      archivedPage: 0,
    });
    expect(items.map((item) => item.type)).toEqual(["plan", "plan", "archived-shelf"]);
    expect(items[0]).toMatchObject({ type: "plan", plan: { planId: activeNew.planId } });
    expect(items[2]).toMatchObject({ type: "archived-shelf", count: 40, expanded: false });
  });

  it("pages expanded archived rows and reports how many remain", () => {
    const firstPage = buildPlanListItems({
      plans: archived,
      projectScopeId: null,
      archivedExpanded: true,
      archivedPage: 0,
    });
    expect(firstPage.filter((item) => item.type === "archived-plan")).toHaveLength(10);
    expect(firstPage.at(-1)).toMatchObject({
      type: "archived-show-more",
      hiddenCount: 30,
      nextPageCount: 25,
    });

    const secondPage = buildPlanListItems({
      plans: archived,
      projectScopeId: null,
      archivedExpanded: true,
      archivedPage: 1,
    });
    expect(secondPage.filter((item) => item.type === "archived-plan")).toHaveLength(35);
    expect(secondPage.at(-1)).toMatchObject({
      type: "archived-show-more",
      hiddenCount: 5,
      nextPageCount: 5,
    });
  });

  it("applies project scope to both lifecycle sections", () => {
    const projectB = MercurianProjectId.make("project-b");
    const items = buildPlanListItems({
      plans: [
        activeOld,
        makePlan("active-b", { projectId: projectB }),
        makePlan("archived-b", {
          projectId: projectB,
          archivedAt: "2026-08-09T00:00:00.000Z",
        }),
      ],
      projectScopeId: projectB,
      archivedExpanded: true,
      archivedPage: 0,
    });
    expect(items.map((item) => item.type)).toEqual(["plan", "archived-shelf", "archived-plan"]);
  });

  it("keeps unchanged rows equal when the shelf toggles", () => {
    const collapsed = buildPlanListItems({
      plans: [activeNew, ...archived],
      projectScopeId: null,
      archivedExpanded: false,
      archivedPage: 0,
    });
    const expanded = buildPlanListItems({
      plans: [activeNew, ...archived],
      projectScopeId: null,
      archivedExpanded: true,
      archivedPage: 0,
    });
    expect(planListItemsAreEqual(collapsed[0]!, expanded[0]!)).toBe(true);
    expect(planListItemsAreEqual(collapsed[1]!, expanded[1]!)).toBe(false);
  });
});

describe("resolvePlanListEnvironmentId", () => {
  const first = EnvironmentId.make("first");
  const second = EnvironmentId.make("second");

  it("keeps an available selection and clamps a vanished one to the first workspace", () => {
    expect(resolvePlanListEnvironmentId(second, [first, second])).toBe(second);
    expect(resolvePlanListEnvironmentId(EnvironmentId.make("gone"), [first, second])).toBe(first);
    expect(resolvePlanListEnvironmentId(null, [])).toBeNull();
  });
});

describe("derivePlanListEmptyState", () => {
  const environmentId = EnvironmentId.make("environment-1");

  it("covers loading, unpaired, unavailable, connecting, and tree-pending phases", () => {
    expect(
      derivePlanListEmptyState({
        catalogState: { ...catalogState, isLoadingConnections: true },
        environmentId: null,
        environmentConnectionState: null,
        treePending: false,
        itemCount: 0,
        projectScopeName: null,
      }),
    ).toMatchObject({ title: "Loading environments", loading: true });
    expect(
      derivePlanListEmptyState({
        catalogState: { ...catalogState, hasConnections: false },
        environmentId: null,
        environmentConnectionState: null,
        treePending: false,
        itemCount: 0,
        projectScopeName: null,
      }),
    ).toMatchObject({ title: "No environments connected", canAddEnvironment: true });
    expect(
      derivePlanListEmptyState({
        catalogState: { ...catalogState, connectionState: "offline" },
        environmentId,
        environmentConnectionState: "offline",
        treePending: true,
        itemCount: 0,
        projectScopeName: null,
      }),
    ).toMatchObject({ title: "Environment unavailable", loading: false });
    expect(
      derivePlanListEmptyState({
        catalogState,
        environmentId,
        environmentConnectionState: "connecting",
        treePending: true,
        itemCount: 0,
        projectScopeName: null,
      }),
    ).toMatchObject({ title: "Connecting to environment", loading: true });
    expect(
      derivePlanListEmptyState({
        catalogState,
        environmentId,
        environmentConnectionState: "connected",
        treePending: true,
        itemCount: 0,
        projectScopeName: null,
      }),
    ).toMatchObject({ title: "Loading plans", loading: true });
  });

  it("names the all-project and scoped empty states", () => {
    expect(
      derivePlanListEmptyState({
        catalogState,
        environmentId,
        environmentConnectionState: "connected",
        treePending: false,
        itemCount: 0,
        projectScopeName: null,
      }),
    ).toMatchObject({ title: "No plans yet" });
    expect(
      derivePlanListEmptyState({
        catalogState,
        environmentId,
        environmentConnectionState: "connected",
        treePending: false,
        itemCount: 0,
        projectScopeName: "Website",
      }),
    ).toMatchObject({ title: "No plans in Website yet" });
    expect(
      derivePlanListEmptyState({
        catalogState,
        environmentId,
        environmentConnectionState: "connected",
        treePending: false,
        itemCount: 1,
        projectScopeName: null,
      }),
    ).toBeNull();
  });
});
