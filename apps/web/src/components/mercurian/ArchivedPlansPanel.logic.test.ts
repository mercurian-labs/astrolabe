import { describe, expect, it } from "vite-plus/test";

import { groupArchivedPlansByProject, resolveArchivedRowActions } from "./ArchivedPlansPanel.logic";

const project = (projectId: string, createdAt: string) => ({
  projectId,
  name: `Project ${projectId}`,
  createdAt,
});

const plan = (
  planId: string,
  overrides: {
    readonly projectId?: string;
    readonly archivedAt?: string | null;
    readonly createdAt?: string;
    readonly hasPublishedCommits?: boolean;
  } = {},
) => ({
  planId,
  projectId: overrides.projectId ?? "one",
  title: `Plan ${planId}`,
  createdAt: overrides.createdAt ?? "2026-08-01T00:00:00.000Z",
  archivedAt:
    overrides.archivedAt === undefined ? "2026-08-04T00:00:00.000Z" : overrides.archivedAt,
  hasPublishedCommits: overrides.hasPublishedCommits ?? false,
});

describe("groupArchivedPlansByProject", () => {
  const projects = [
    project("one", "2026-08-01T00:00:00.000Z"),
    project("two", "2026-08-02T00:00:00.000Z"),
  ];

  it("groups archived plans under their project, in the tree's project order", () => {
    const groups = groupArchivedPlansByProject({
      projects: projects.toReversed(),
      plans: [plan("a", { projectId: "two" }), plan("b", { projectId: "one" })],
    });
    expect(groups.map((group) => group.project.projectId)).toEqual(["one", "two"]);
  });

  it("shows nothing for a project with nothing archived", () => {
    const groups = groupArchivedPlansByProject({
      projects,
      plans: [plan("a", { projectId: "one" }), plan("b", { projectId: "two", archivedAt: null })],
    });
    expect(groups.map((group) => group.project.projectId)).toEqual(["one"]);
    expect(groups[0]?.plans.map((entry) => entry.planId)).toEqual(["a"]);
  });

  it("orders a project's plans by most recently archived", () => {
    const groups = groupArchivedPlansByProject({
      projects,
      plans: [
        plan("old", { archivedAt: "2026-08-02T00:00:00.000Z" }),
        plan("new", { archivedAt: "2026-08-06T00:00:00.000Z" }),
        plan("mid", { archivedAt: "2026-08-04T00:00:00.000Z" }),
      ],
    });
    expect(groups[0]?.plans.map((entry) => entry.planId)).toEqual(["new", "mid", "old"]);
  });

  it("is empty when nothing has been archived", () => {
    expect(
      groupArchivedPlansByProject({
        projects,
        plans: [plan("a", { archivedAt: null }), plan("b", { archivedAt: null })],
      }),
    ).toEqual([]);
    expect(groupArchivedPlansByProject({ projects, plans: [] })).toEqual([]);
  });
});

describe("resolveArchivedRowActions", () => {
  it("always restores, and deletes only what is still fully private", () => {
    expect(resolveArchivedRowActions({ hasPublishedCommits: false })).toEqual({
      canRestore: true,
      canDelete: true,
    });
    // "Delete is not offered here for published plans."
    expect(resolveArchivedRowActions({ hasPublishedCommits: true })).toEqual({
      canRestore: true,
      canDelete: false,
    });
  });
});
