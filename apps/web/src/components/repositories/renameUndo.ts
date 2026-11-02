/**
 * Astrolabe: the last rename made from this client, which Undo Rename takes back. The environment
 * applied it, so it is not in any editor's own undo history.
 */
export interface UndoableRename {
  readonly label: string;
  readonly run: () => void;
}

let last: UndoableRename | null = null;

export const lastRename = {
  get: (): UndoableRename | null => last,
  set(rename: UndoableRename | null) {
    last = rename;
  },
};
