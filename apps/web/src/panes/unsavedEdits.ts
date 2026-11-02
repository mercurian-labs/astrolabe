/**
 * Asks before a tab with unsaved edits closes or is replaced. A view registers how to tell
 * whether its edits are unsaved, under its tab's key, while it is mounted.
 */
const unsaved = new Map<string, () => boolean>();

export function registerUnsavedCheck(key: string, check: () => boolean) {
  unsaved.set(key, check);
  return () => {
    if (unsaved.get(key) === check) unsaved.delete(key);
  };
}

export function hasUnsavedEdits(key: string): boolean {
  return unsaved.get(key)?.() ?? false;
}
