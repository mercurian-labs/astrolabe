/** How many chats stay mounted, out of sight, so showing one again never remounts it. */
export const KEPT_CHATS = 5;

/**
 * The chats to keep mounted, most recently shown first: those on screen now (the focused pane's
 * first), then the rest as they were, up to `cap` (more only while more are on screen). Closed
 * chats drop out. `recent` itself when nothing changed, so a render can compare by identity.
 */
export function recentChats(
  recent: readonly string[],
  onScreen: readonly string[],
  open: ReadonlySet<string>,
  cap = KEPT_CHATS,
): readonly string[] {
  const shown = new Set(onScreen);
  const next = [...onScreen, ...recent.filter((key) => !shown.has(key) && open.has(key))].slice(
    0,
    Math.max(cap, onScreen.length),
  );
  return next.length === recent.length && next.every((key, index) => recent[index] === key)
    ? recent
    : next;
}
