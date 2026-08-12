import { describe, expect, it } from "vite-plus/test";

import { PlanningToolkit } from "./tools.ts";

describe("PlanningToolkit", () => {
  it("offers the reply and implement write doors beside the shared read", () => {
    expect(Object.keys(PlanningToolkit.tools).sort()).toEqual([
      "read_plan",
      "save_implement_proposal",
      "save_plan_revision",
    ]);
    expect(PlanningToolkit.tools.save_plan_revision.description).toContain("whole text");
    expect(PlanningToolkit.tools.save_implement_proposal.description).toContain(
      "complete implement analysis",
    );
    expect(PlanningToolkit.tools.read_plan.description).toContain("current text");
  });
});
