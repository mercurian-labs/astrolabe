import type { MercurianLineMemoryChanges, PlanDetail } from "@t3tools/contracts";

export interface PlanSuggestion {
  readonly id: string;
  readonly noteName: string;
  readonly question: string;
  readonly label: string;
  readonly message: string;
}

export function memoryMergeHomeSuggestion(
  detail: PlanDetail,
  lineChanges: MercurianLineMemoryChanges,
): PlanSuggestion | null {
  const hasChanges =
    lineChanges.marked.length > 0 || lineChanges.hand.length > 0 || lineChanges.unmarked !== null;
  const shipped = detail.codingSessions.some((session) => session.prState === "merged");
  if (!hasChanges || (!shipped && detail.plan.archivedAt == null)) return null;
  return {
    id: "memory-merge-home",
    noteName: "Memory",
    question: "Merge this line's memory home?",
    label: "Merge this line's memory home",
    message: "Merge this line's memory home",
  };
}

/** A dismissed row stays hidden until the current set contains a new identity. */
export function suggestionsAfterDismiss(
  suggestions: ReadonlyArray<PlanSuggestion>,
  dismissedIds: ReadonlySet<string>,
): ReadonlyArray<PlanSuggestion> {
  return suggestions.some((suggestion) => !dismissedIds.has(suggestion.id)) ? suggestions : [];
}
