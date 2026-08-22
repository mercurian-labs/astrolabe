import type {
  MercurianCommitId,
  PlanningModelSelection,
  PlanTimelineItem,
} from "@t3tools/contracts";

import type { PlanGraph } from "./planGraph.ts";

export function standingModelChoice(
  graph: PlanGraph,
  itemsById: ReadonlyMap<string, PlanTimelineItem>,
  fromCommitId: MercurianCommitId | null,
): PlanningModelSelection | null {
  let current: MercurianCommitId | undefined = fromCommitId ?? undefined;
  for (let step = 0; current !== undefined && step <= graph.nodes.length; step += 1) {
    const item = itemsById.get(current);
    if (item?._tag === "message" && item.ranUnder !== undefined) {
      return { provider: item.ranUnder.provider, model: item.ranUnder.model };
    }
    current = graph.byId.get(current)?.parents[0];
  }
  return null;
}
