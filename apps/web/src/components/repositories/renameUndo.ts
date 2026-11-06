/**
 * Astrolabe: a rename or code action the environment applied, kept to take back. It is not in any
 * editor's own undo history, so Undo Rename and the view of its changed places share this one.
 */
export type UndoState = "ready" | "undoing" | "undone" | "partly" | "failed";

/** What the environment put back, and the files it left because they changed since. */
export interface UndoOutcome {
  readonly files: readonly string[];
  readonly skipped: readonly string[];
}

export interface UndoableRename {
  readonly label: string;
  readonly run: () => void;
  readonly state: () => UndoState;
  /** The files left as they are, once it has run. */
  readonly skipped: () => readonly string[];
  readonly subscribe: (listener: () => void) => () => void;
}

let last: UndoableRename | null = null;

export const lastRename = {
  get: (): UndoableRename | null => last,
  set(rename: UndoableRename | null) {
    last = rename;
  },
};

const stateOf = ({ files, skipped }: UndoOutcome): UndoState =>
  files.length === 0 ? "failed" : skipped.length > 0 ? "partly" : "undone";

/** The edit behind `undo`, taken back once however many places offer it; null if it could not. */
export function undoableEdit(
  label: string,
  undo: () => Promise<UndoOutcome | null>,
): UndoableRename {
  let state: UndoState = "ready";
  let skipped: readonly string[] = [];
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
        (outcome) => {
          skipped = outcome?.skipped ?? [];
          become(outcome ? stateOf(outcome) : "failed");
        },
        () => become("failed"),
      );
    },
    state: () => state,
    skipped: () => skipped,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return edit;
}
