import { EnvironmentId, MercurianProjectId, type MercurianProject } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPlanListFilterMenu } from "./plan-list-filter-menu";

const environment = (id: string) => ({ environmentId: EnvironmentId.make(id), label: id });
const project = (id: string, createdAt: string): MercurianProject => ({
  projectId: MercurianProjectId.make(id),
  name: id,
  createdAt,
  updatedAt: createdAt,
});

describe("buildPlanListFilterMenu", () => {
  it("shows the Workspace submenu only for multiple paired workspaces", () => {
    const one = buildPlanListFilterMenu({
      environments: [environment("one")],
      projects: [],
      selectedEnvironmentId: EnvironmentId.make("one"),
      selectedProjectId: null,
    });
    const two = buildPlanListFilterMenu({
      environments: [environment("one"), environment("two")],
      projects: [],
      selectedEnvironmentId: EnvironmentId.make("one"),
      selectedProjectId: null,
    });
    expect(one.some((item) => item.title === "Workspace")).toBe(false);
    expect(two.find((item) => item.title === "Workspace")?.subactions).toHaveLength(2);
  });

  it("checks All projects by default and orders project entries like the tree", () => {
    const menu = buildPlanListFilterMenu({
      environments: [],
      projects: [
        project("new", "2026-08-03T00:00:00.000Z"),
        project("old", "2026-08-01T00:00:00.000Z"),
      ],
      selectedEnvironmentId: null,
      selectedProjectId: null,
    });
    expect(menu.find((item) => item.title === "Project")?.subactions).toMatchObject([
      { title: "All projects", state: "on" },
      { title: "old" },
      { title: "new" },
    ]);
  });
});
