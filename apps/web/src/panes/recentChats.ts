/** How many chats stay mounted, out of sight, so showing one again never remounts it. */
export const KEPT_CHATS = 5;

/**
 * The chats to keep mounted, most recently shown first: those on screen now (the focused pane's
 * first), then the rest as they were, up to `cap` (more only while more are on screen, or `busy`
 * with live work). Closed chats drop out. `recent` itself when nothing changed, so a render can
 * compare by identity.
 */
export function recentChats(
  recent: readonly string[],
  onScreen: readonly string[],
  open: ReadonlySet<string>,
  cap = KEPT_CHATS,
  busy: ReadonlySet<string> = new Set(),
): readonly string[] {
  const shown = new Set(onScreen);
  const limit = Math.max(cap, onScreen.length);
  const next = [...onScreen, ...recent.filter((key) => !shown.has(key) && open.has(key))].filter(
    (key, index) => index < limit || busy.has(key),
  );
  return next.length === recent.length && next.every((key, index) => recent[index] === key)
    ? recent
    : next;
}
