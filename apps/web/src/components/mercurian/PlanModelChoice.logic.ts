import type { MercurianCommitId, PlanModelDirective, PlanTimelineItem } from "@t3tools/contracts";

import type { PlanGraph } from "./PlanGraph.logic";

const FOLLOW_DEFAULT = { _tag: "follow-default" } as const satisfies PlanModelDirective;

/**
 * The branch's standing model choice at one position.
 *
 * History is walked self-first through the first parent. A message that
 * followed the default records the pair it ran under, but descendants retain
 * the mode — they follow whatever the workspace default is now.
 */
export function standingModelChoice(
  graph: PlanGraph,
  itemsById: ReadonlyMap<string, PlanTimelineItem>,
  fromCommitId: MercurianCommitId | null,
): PlanModelDirective {
  let current: MercurianCommitId | undefined = fromCommitId ?? undefined;
  for (let step = 0; current !== undefined && step <= graph.nodes.length; step += 1) {
    const item = itemsById.get(current);
    if (item?._tag === "message" && item.ranUnder !== undefined) {
      return item.ranUnder.followedDefault
        ? FOLLOW_DEFAULT
        : {
            _tag: "override",
            selection: { provider: item.ranUnder.provider, model: item.ranUnder.model },
          };
    }
    current = graph.byId.get(current)?.parents[0];
  }
  return FOLLOW_DEFAULT;
}
