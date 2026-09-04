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
