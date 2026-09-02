export interface PlanSuggestion {
  readonly id: string;
  readonly noteName: string;
  readonly question: string;
  readonly label: string;
  readonly message: string;
}

/** A dismissed row stays hidden until the current set contains a new identity. */
export function suggestionsAfterDismiss(
  suggestions: ReadonlyArray<PlanSuggestion>,
  dismissedIds: ReadonlySet<string>,
): ReadonlyArray<PlanSuggestion> {
  return suggestions.some((suggestion) => !dismissedIds.has(suggestion.id)) ? suggestions : [];
}
