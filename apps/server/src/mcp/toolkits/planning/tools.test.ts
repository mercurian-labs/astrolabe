import { expect, it } from "vite-plus/test";
import { PlanningToolkit } from "./tools.ts";
it("exposes memory amendments while plans and specs use ordinary file tools", () => {
  expect(Object.keys(PlanningToolkit.tools)).toEqual(["propose_memory_amendment"]);
  expect(PlanningToolkit.tools.propose_memory_amendment.description).toContain(
    "One call creates one memory-only commit",
  );
});
