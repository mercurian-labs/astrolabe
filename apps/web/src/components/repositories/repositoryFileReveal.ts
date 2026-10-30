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
  readonly id: number;
}

const listeners = new Set<() => void>();
let current: RepositoryFileReveal | null = null;
let nextId = 1;

function changed() {
  for (const listener of listeners) listener();
}

export const repositoryFileReveal = {
  request(tabKey: string, line: number) {
    current = { tabKey, line, id: nextId++ };
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

/** The cursor at the start of 1-based `line` (the last line past the end), scrolled to the middle. */
export function revealLine(state: EditorState, line: number): TransactionSpec {
  const { from } = state.doc.line(Math.min(Math.max(line, 1), state.doc.lines));
  return {
    selection: { anchor: from },
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  };
}
