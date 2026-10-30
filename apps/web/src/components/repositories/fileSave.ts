import { type EditorState, Facet } from "@codemirror/state";

/**
 * Astrolabe: a repository file's explicit save (mod+s, `:w`), which formats a code file first when
 * format on save is on. The file writes itself anyway as you type; this is the save you ask for.
 */
export const fileSave = Facet.define<() => void, (() => void) | null>({
  combine: (values) => values[0] ?? null,
});

export function hasFileSave(state: EditorState): boolean {
  return state.facet(fileSave) !== null;
}
