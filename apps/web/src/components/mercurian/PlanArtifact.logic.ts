/** Structural shape, not the wire type: this helper only reads the tag and the author. */
interface TimelineItemFields {
  readonly _tag: "message" | "plan-revision";
  readonly authorKind: "human" | "assistant";
  readonly createdAt: string;
}

export interface PlanAttribution {
  readonly authorKind: "human" | "assistant";
  readonly createdAt: string;
}

/**
 * Who last changed the plan, and when — or nothing for a plan nobody has
 * edited yet.
 *
 * Read from the history rather than tracked beside it, the same way the plan's
 * text is: the last revision on the path *is* the attribution.
 */
export function lastPlanRevision(
  timeline: ReadonlyArray<TimelineItemFields>,
): PlanAttribution | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item !== undefined && item._tag === "plan-revision") {
      return { authorKind: item.authorKind, createdAt: item.createdAt };
    }
  }
  return null;
}
