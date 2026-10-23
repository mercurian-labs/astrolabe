/** The note a wikilink names: `Note#Heading` and `Note|Alias` both open `Note`. */
export function wikilinkNoteName(target: string): string | null {
  const name = target.split("|")[0]!.split("#")[0]!.trim();
  return name.length > 0 ? name : null;
}

/**
 * What a fresh read of the note does to the buffer that shows it. `baseline` is the text the
 * buffer was loaded from, `buffer` the text in it now, `incoming` the text just read.
 * - `keep`: nothing changed underneath.
 * - `adopt`: the read caught up with the buffer (our own save landed); it becomes the baseline.
 * - `reload`: the buffer has no edits, so it takes the new text.
 * - `conflict`: the buffer has edits and the note changed underneath; never clobber them.
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
