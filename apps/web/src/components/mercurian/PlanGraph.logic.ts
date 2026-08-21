import type { PlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import { hasFork } from "@t3tools/client-runtime/state/plan-graph";

export * from "@t3tools/client-runtime/state/plan-graph";

export type PlanExplorerView = "thread" | "columns" | "graph";

export function effectivePlanExplorerView(
  graph: PlanGraph,
  storedView: PlanExplorerView,
): PlanExplorerView {
  return storedView === "columns" && !hasFork(graph) ? "thread" : storedView;
}
