import { create } from "zustand";

/**
 * Astrolabe: Cmd/Ctrl-click and Shift-click selection in the Wikis and Pull Requests sidebars,
 * as Threads keeps its own (`threadSelectionStore`): the rows selected, in the order they were,
 * and the anchor a Shift-click ranges from, which a plain click sets. One section's at a time:
 * selecting in another starts over.
 */
export interface RowSelection {
  readonly section: string | null;
  readonly keys: readonly string[];
  readonly anchor: string | null;
}

export const NO_ROW_SELECTION: RowSelection = { section: null, keys: [], anchor: null };

const inSection = (selection: RowSelection, section: string) =>
  selection.section === section ? selection : { ...NO_ROW_SELECTION, section };

/** A plain click: no rows selected, `key` the anchor for the next Shift-click. */
export function anchorRow(section: string, key: string): RowSelection {
  return { section, keys: [], anchor: key };
}

/** A Cmd/Ctrl-click: `key` in the selection or out of it, and the anchor when it goes in. */
export function toggleRow(selection: RowSelection, section: string, key: string): RowSelection {
  const { keys, anchor } = inSection(selection, section);
  return keys.includes(key)
    ? { section, keys: keys.filter((selected) => selected !== key), anchor }
    : { section, keys: [...keys, key], anchor: key };
}

/**
 * A Shift-click: every row from the anchor to `key` joins the selection, in `ordered` (the
 * list's order), the anchor staying put; with no anchor in the list, `key` alone.
 */
export function rangeToRow(
  selection: RowSelection,
  section: string,
  key: string,
  ordered: readonly string[],
): RowSelection {
  const { keys, anchor } = inSection(selection, section);
  const from = anchor === null ? -1 : ordered.indexOf(anchor);
  const to = ordered.indexOf(key);
  if (from === -1 || to === -1) {
    return { section, keys: keys.includes(key) ? keys : [...keys, key], anchor: key };
  }
  const range = ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
  return { section, keys: [...keys.filter((kept) => !range.includes(kept)), ...range], anchor };
}

/**
 * The rows an action on `key` takes, in list order: the selection when `key` is in it, else
 * `key` alone, as a drag or a menu on a selected row carries the whole selection.
 */
export function rowsActedOn(
  selection: RowSelection,
  section: string,
  key: string,
  ordered: readonly string[],
): readonly string[] {
  if (selection.section !== section || !selection.keys.includes(key)) return [key];
  return ordered.filter((row) => selection.keys.includes(row));
}

export const useRowSelectionStore = create<{
  readonly selection: RowSelection;
  readonly change: (next: (selection: RowSelection) => RowSelection) => void;
}>((set) => ({
  selection: NO_ROW_SELECTION,
  change: (next) => set((state) => ({ selection: next(state.selection) })),
}));
