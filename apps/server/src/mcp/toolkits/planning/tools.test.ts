import { describe, expect, it } from "vite-plus/test";

import { PlanningToolkit } from "./tools.ts";

describe("PlanningToolkit", () => {
  it("offers the source-plan write door beside the shared read", () => {
    expect(Object.keys(PlanningToolkit.tools).sort()).toEqual(["read_plan", "save_plan_revision"]);
    expect(PlanningToolkit.tools.save_plan_revision.description).toContain("whole text");
    expect(PlanningToolkit.tools.read_plan.description).toContain("current text");
  });
});
