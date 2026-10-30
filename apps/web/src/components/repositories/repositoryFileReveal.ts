import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Astrolabe: the line a Repositories file tab was last asked to show, by whatever opened it (project
 * search). The file view reads it for its own tab key and scrolls there; a repeated request for the
 * same line is new by its id.
 */
export interface RepositoryFileReveal {
  readonly tabKey: string;
  readonly line: number;
  /** From 1; the line's start when not given. */
  readonly column?: number;
  readonly id: number;
}

const listeners = new Set<() => void>();
let current: RepositoryFileReveal | null = null;
let nextId = 1;

function changed() {
  for (const listener of listeners) listener();
}

export const repositoryFileReveal = {
  request(tabKey: string, line: number, column?: number) {
    current = { tabKey, line, ...(column === undefined ? {} : { column }), id: nextId++ };
    changed();
  },
  get: (): RepositoryFileReveal | null => current,
  /** The view has shown request `id`, so a tab opened again later does not jump back there. */
  done(id: number) {
    if (current?.id !== id) return;
    current = null;
    changed();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * The cursor at 1-based `line` (the last line past the end) and `column` (its start when not
 * given, its end past the end), scrolled to the middle.
 */
export function revealLine(state: EditorState, line: number, column = 1): TransactionSpec {
  const { from, to } = state.doc.line(Math.min(Math.max(line, 1), state.doc.lines));
  const at = Math.min(from + Math.max(column, 1) - 1, to);
  return {
    selection: { anchor: at },
    effects: EditorView.scrollIntoView(at, { y: "center" }),
  };
}
