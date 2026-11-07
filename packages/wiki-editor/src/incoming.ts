/** The note a wikilink names: `Note#Heading` and `Note|Alias` both open `Note`. */
export function wikilinkNoteName(target: string): string | null {
  // In a Markdown table, a link's bar is written `\\|`.
  const name = target.split(/\\?\|/)[0]!.split("#")[0]!.replace(/\\$/, "").trim();
  return name.length > 0 ? name : null;
}

/** An embedded file's address, and when to look for it again. */
export interface WikiEmbedAddress {
  readonly url: string | null;
  readonly expiresAt: number;
}

const NO_ADDRESS_MS = 60_000;

/**
 * A note's embeds as an editor asks for them, on every redraw: one promise per target until its
 * address runs out, so typing neither reloads an image nor asks again for a missing one.
 */
export function wikiEmbeds(
  find: (target: string) => Promise<WikiEmbedAddress>,
  now: () => number = Date.now,
) {
  const known = new Map<string, { url: Promise<string | null>; expiresAt: number }>();
  return (target: string): Promise<string | null> => {
    const held = known.get(target);
    if (held !== undefined && held.expiresAt > now()) return held.url;
    const entry = {
      url: Promise.resolve<string | null>(null),
      expiresAt: Number.POSITIVE_INFINITY,
    };
    entry.url = find(target).then(
      ({ url, expiresAt }) => {
        entry.expiresAt = url === null ? now() + NO_ADDRESS_MS : expiresAt;
        return url;
      },
      () => {
        entry.expiresAt = now() + NO_ADDRESS_MS;
        return null;
      },
    );
    known.set(target, entry);
    return entry.url;
  };
}

const OTHERS_SHOWN = 3;

const pathOf = (file: string) => file.replace(/\.md$/i, "");

/** What a link says when more than one file fits it: which it chose, and the rest. */
export function ambiguousLink(link: {
  readonly file: string | null;
  readonly others: ReadonlyArray<string>;
}): string | undefined {
  if (link.file === null || link.others.length === 0) return undefined;
  const shown = link.others.slice(0, OTHERS_SHOWN).map(pathOf).join(", ");
  const more = link.others.length - OTHERS_SHOWN;
  return `Goes to ${pathOf(link.file)}. Also fits ${shown}${more > 0 ? ` and ${more} more` : ""}.`;
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
