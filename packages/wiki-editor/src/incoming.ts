/** The note a wikilink names: `Note#Heading` and `Note|Alias` both open `Note`. */
export function wikilinkNoteName(target: string): string | null {
  const name = target.split("|")[0]!.split("#")[0]!.trim();
  return name.length > 0 ? name : null;
}

/**
 * What a fresh read (`incoming`) does to a buffer loaded from `baseline` and now holding `buffer`:
 * `keep` (nothing changed underneath), `adopt` (our own save landed; it becomes the baseline), `reload`
 * (no edits, take the new text), `conflict` (edits and an underlying change; never clobber them).
 */
export type IncomingNoteAction = "keep" | "adopt" | "reload" | "conflict";

export function resolveIncomingNote(input: {
  readonly baseline: string;
  readonly buffer: string;
  readonly incoming: string;
}): IncomingNoteAction {
  if (input.incoming === input.baseline) return "keep";
  if (input.incoming === input.buffer) return "adopt";
  if (input.buffer === input.baseline) return "reload";
  return "conflict";
}
