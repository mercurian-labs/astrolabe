/**
 * Astrolabe: a rename or code action the environment applied, kept to take back. It is not in any
 * editor's own undo history, so Undo Rename and the view of its changed places share this one.
 */
export type UndoState = "ready" | "undoing" | "undone" | "failed";

export interface UndoableRename {
  readonly label: string;
  readonly run: () => void;
  readonly state: () => UndoState;
  readonly subscribe: (listener: () => void) => () => void;
}

let last: UndoableRename | null = null;

export const lastRename = {
  get: (): UndoableRename | null => last,
  set(rename: UndoableRename | null) {
    last = rename;
  },
};

/** The edit behind `undo`, taken back once however many places offer it; `undo` says if it did. */
export function undoableEdit(label: string, undo: () => Promise<boolean>): UndoableRename {
  let state: UndoState = "ready";
  const listeners = new Set<() => void>();
  const become = (next: UndoState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const edit: UndoableRename = {
    label,
    run: () => {
      if (state !== "ready") return;
      if (last === edit) last = null;
      become("undoing");
      void undo().then(
        (done) => become(done ? "undone" : "failed"),
        () => become("failed"),
      );
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return edit;
}
