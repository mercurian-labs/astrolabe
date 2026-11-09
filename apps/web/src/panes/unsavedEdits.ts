/**
 * Asks before a tab with unsaved edits closes or is replaced. A view registers how to tell
 * whether its edits are unsaved, under its tab's key, while it is mounted.
 */
const unsaved = new Map<string, () => boolean>();
const savers = new Map<string, () => Promise<boolean>>();

export function registerUnsavedCheck(
  key: string,
  check: () => boolean,
  save?: () => Promise<boolean>,
) {
  unsaved.set(key, check);
  if (save !== undefined) savers.set(key, save);
  return () => {
    if (unsaved.get(key) !== check) return;
    unsaved.delete(key);
    savers.delete(key);
  };
}

/** Lands what a tab holds now. False when it couldn't, so it's still the tab's to save. */
export const saveEdits = (key: string): Promise<boolean> =>
  savers.get(key)?.() ?? Promise.resolve(true);

export function hasUnsavedEdits(key: string): boolean {
  return unsaved.get(key)?.() ?? false;
}
