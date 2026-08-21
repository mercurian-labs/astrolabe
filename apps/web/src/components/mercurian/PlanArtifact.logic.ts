/** Structural shape, not the wire type: this helper only reads the tag and the author. */
interface TimelineItemFields {
  readonly _tag: "message" | "plan-revision" | "spec-revision" | "coding-session";
  readonly authorKind: "human" | "assistant";
  readonly createdAt: string;
}

/** Likewise: only the tag and the identity are read. */
interface RevisionIdentityFields {
  readonly _tag: "message" | "plan-revision" | "spec-revision" | "coding-session";
  readonly commitId: string;
  readonly split?: unknown;
}

function lastRevisionIdIncludingSplits(
  timeline: ReadonlyArray<RevisionIdentityFields>,
): string | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item !== undefined && item._tag === "plan-revision") return item.commitId;
  }
  return null;
}

function lastNonSplitRevisionId(timeline: ReadonlyArray<RevisionIdentityFields>): string | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item !== undefined && item._tag === "plan-revision" && item.split === undefined) {
      return item.commitId;
    }
  }
  return null;
}

/**
 * Whether the plan text riding the snapshot is *this path's* plan text.
 *
 * The server folds every non-split revision in the history in sequence order,
 * because it has no idea which path a given window is standing on. While the
 * history is one line without a split that is the same answer. Once it forks
 * it is not: the newest revision anywhere may belong to a branch this window
 * is not on, and showing it here would put another branch's plan beside this
 * branch's conversation.
 *
 * Snapshot text skips split revisions, while path text does not: a split's
 * projection is read at that path's head. The two agree exactly when the last
 * revision on this path (including splits) is also the last non-split revision
 * in the history — including when neither exists. When they disagree, the
 * path's text has to be read at its own head.
 */
export function snapshotTextIsForPath(
  timeline: ReadonlyArray<RevisionIdentityFields>,
  pathTimeline: ReadonlyArray<RevisionIdentityFields>,
): boolean {
  return lastNonSplitRevisionId(timeline) === lastRevisionIdIncludingSplits(pathTimeline);
}

/**
 * Why a save came back refused, in the pane's own words.
 *
 * The one refusal a person can act on is named: a reply streaming on the
 * edit's own branch, where stopping the reply is the way to act now — the
 * same fact the composer's turn-refusal notice states. Anything else keeps
 * honest without inventing a cause. Either way the edit is still in the
 * editor; the notice says so, because a refusal that looks like data loss
 * is worse than the refusal itself.
 */
export function saveRefusalNotice(error: unknown): string {
  const tag =
    typeof error === "object" && error !== null
      ? (error as { readonly _tag?: unknown })._tag
      : undefined;
  if (tag === "PlanTurnActiveError") {
    return "The assistant is replying on this branch. Stop the reply to save this edit — it is still here.";
  }
  return "The edit could not be saved. It is still here — try again.";
}

export interface PlanAttribution {
  readonly authorKind: "human" | "assistant";
  readonly createdAt: string;
}

/**
 * Who last changed the plan, and when — or nothing for a plan nobody has
 * edited yet.
 *
 * Read from the path rather than tracked beside it: the last revision on the
 * path *is* the attribution, including a split whose projection is the text
 * this path shows.
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
