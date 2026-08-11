/** Structural shape, not the wire type: this helper only reads the tag and the author. */
interface TimelineItemFields {
  readonly _tag: "message" | "plan-revision" | "issue-revision";
  readonly authorKind: "human" | "assistant";
  readonly createdAt: string;
}

/** Likewise: only the tag and the identity are read. */
interface RevisionIdentityFields {
  readonly _tag: "message" | "plan-revision" | "issue-revision";
  readonly commitId: string;
}

function lastRevisionId(timeline: ReadonlyArray<RevisionIdentityFields>): string | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item !== undefined && item._tag === "plan-revision") return item.commitId;
  }
  return null;
}

/**
 * Whether the plan text riding the snapshot is *this path's* plan text.
 *
 * The server folds every revision in the history in sequence order, because it
 * has no idea which path a given window is standing on. While the history is
 * one line that is the same answer. Once it forks it is not: the newest
 * revision anywhere may belong to a branch this window is not on, and showing
 * it here would put another branch's plan beside this branch's conversation.
 *
 * The two agree exactly when the last revision on this path is also the last
 * revision in the history — including when neither exists. When they disagree,
 * the path's text has to be read at its own head.
 */
export function snapshotTextIsForPath(
  timeline: ReadonlyArray<RevisionIdentityFields>,
  pathTimeline: ReadonlyArray<RevisionIdentityFields>,
): boolean {
  return lastRevisionId(timeline) === lastRevisionId(pathTimeline);
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
