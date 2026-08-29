import type { MemoryNote } from "@t3tools/contracts";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";

interface SuggestionTimelineItem {
  readonly _tag: string;
  readonly text?: string;
}

export interface PlanSuggestion {
  readonly id: string;
  readonly noteName: string;
  readonly question: string;
  readonly label: string;
  readonly message: string;
}

export function collectMentionedMemoryNoteNames(
  timeline: ReadonlyArray<SuggestionTimelineItem>,
): ReadonlyArray<string> {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of timeline) {
    if (item._tag !== "message" || item.text === undefined) continue;
    for (const token of collectComposerInlineTokens(item.text, { includeNotes: true })) {
      if (token.type !== "note") continue;
      const identity = token.value.toLocaleLowerCase();
      if (seen.has(identity)) continue;
      seen.add(identity);
      names.push(token.value);
    }
  }
  return names;
}

export function planSuggestionMessage(noteName: string, question: string): string {
  return `Let's resolve the open decision on [[${noteName}]]: "${question}".`;
}

export function unresolvedMemoryNoteSuggestions(
  notes: ReadonlyArray<MemoryNote>,
): ReadonlyArray<PlanSuggestion> {
  const suggestions: PlanSuggestion[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    for (const decision of note.openDecisions) {
      if (decision.resolved) continue;
      const id = `${note.name}\0${decision.title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      suggestions.push({
        id,
        noteName: note.name,
        question: decision.title,
        label: `${note.name}: ${decision.title}`,
        message: planSuggestionMessage(note.name, decision.title),
      });
    }
  }
  return suggestions;
}

/** A dismissed row stays hidden until the current set contains a new identity. */
export function suggestionsAfterDismiss(
  suggestions: ReadonlyArray<PlanSuggestion>,
  dismissedIds: ReadonlySet<string>,
): ReadonlyArray<PlanSuggestion> {
  return suggestions.some((suggestion) => !dismissedIds.has(suggestion.id)) ? suggestions : [];
}
