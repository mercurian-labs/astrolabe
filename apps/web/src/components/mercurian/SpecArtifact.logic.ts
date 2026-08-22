import type { MercurianCommitId, PlanSpecRevision, PlanTimelineItem } from "@t3tools/contracts";

import type { PlanGraph } from "./PlanGraph.logic";
export {
  planMayBeStaleAt,
  stalePlanLeafIds,
  staleSpecLeafIds,
} from "@t3tools/client-runtime/state/plan-freshness";

export function lastSpecRevision(
  timeline: ReadonlyArray<PlanTimelineItem>,
): PlanSpecRevision | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?._tag === "spec-revision") return item;
  }
  return null;
}

export function snapshotSpecIsForPath(
  timeline: ReadonlyArray<PlanTimelineItem>,
  pathTimeline: ReadonlyArray<PlanTimelineItem>,
): boolean {
  return lastSpecRevision(timeline)?.commitId === lastSpecRevision(pathTimeline)?.commitId;
}

export function specRevisionLabel(revision: PlanSpecRevision | null): string {
  if (revision === null) return "No spec revision yet";
  const who = revision.authorKind === "human" ? "You" : "Assistant";
  if (revision.cause === "import") return `Imported from ${revision.issueId ?? "issue"}`;
  if (revision.cause === "refresh") return `Refreshed from ${revision.issueId ?? "issue"}`;
  if (revision.cause === "reconciliation") {
    return `Reconciled with ${revision.issueId ?? "issue"}`;
  }
  return `${who} revised the spec`;
}

export function expectedSpecRevisionId(
  timeline: ReadonlyArray<PlanTimelineItem>,
): MercurianCommitId | null {
  return lastSpecRevision(timeline)?.commitId ?? null;
}
