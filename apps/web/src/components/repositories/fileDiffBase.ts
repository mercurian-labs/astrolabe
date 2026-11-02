import { Facet, type EditorState } from "@codemirror/state";
import type { VcsBaseTextBase, VcsBaseTextResult } from "@t3tools/contracts";

/**
 * Astrolabe: what a Repositories code file's change markers compare against: its last commit
 * (`head`), or the start of the latest turn that changed it in its checkout (`turn`).
 */
export type FileDiffBase = VcsBaseTextBase;

/**
 * The base a file opens on as a turn base arrives: the turn while the file has changes from it
 * (a running turn is only offered once it has written the file), else HEAD. Decided then, not
 * as you type, so your own edits never switch it.
 */
export function openingDiffBase(
  turn: NonNullable<VcsBaseTextResult>,
  contents: string,
): FileDiffBase {
  return turn.turn?.running === true || turn.text !== contents ? "turn" : "head";
}

/**
 * The base a file shows: HEAD without a turn base, else the one picked in its header, else the
 * one it opened on. Undefined while the turn base is still loading, so a file that opens on it
 * does not show HEAD's markers first.
 */
export function pickDiffBase(
  chosen: FileDiffBase | null,
  turn: VcsBaseTextResult | undefined,
  opening: FileDiffBase | undefined,
): FileDiffBase | undefined {
  if (turn === null) return "head";
  if (chosen !== null) return chosen;
  return turn === undefined ? undefined : opening;
}

/** The file view's base, for the keyboard menu and Command Palette to read and switch. */
export interface DiffBaseControl {
  readonly current: () => { readonly base: FileDiffBase; readonly turnAvailable: boolean };
  readonly toggle: () => void;
}

export const diffBaseControl = Facet.define<DiffBaseControl, DiffBaseControl | null>({
  combine: (controls) => controls[0] ?? null,
});

export function hasDiffBaseControl(state: EditorState): boolean {
  return state.facet(diffBaseControl) !== null;
}
