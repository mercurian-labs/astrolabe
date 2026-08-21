interface TimelineItemFields {
  readonly _tag: "message" | "plan-revision" | "spec-revision" | "coding-session";
  readonly authorKind: "human" | "assistant";
  readonly createdAt: string;
}

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
