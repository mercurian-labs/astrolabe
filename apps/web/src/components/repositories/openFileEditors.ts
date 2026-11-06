import { ChangeSet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  madeReplacements,
  type TextReplacement,
  undoReplacements,
} from "@t3tools/shared/textReplace";

/**
 * Astrolabe: the repository files open in an editor in this window, so an edit made for many files
 * at once (replace-all) can go through each open file's own editor, where Mod-z takes it back.
 */
export interface OpenFileEditor {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly view: EditorView;
  /** Whether it is the live document and you may edit it. */
  readonly writable: () => boolean;
  /** Writes what isn't on disk yet, and says whether the file now holds what this editor does. */
  readonly save: () => Promise<boolean>;
}

const editors = new Set<OpenFileEditor>();
const trackers = new Map<EditorView, Set<(changes: ChangeSet) => void>>();

export function registerFileEditor(editor: OpenFileEditor): () => void {
  editors.add(editor);
  return () => {
    editors.delete(editor);
    trackers.delete(editor.view);
  };
}

/** Called by an open file's editor after each change to its text. */
export function fileEditorChanged(view: EditorView, changes: ChangeSet) {
  for (const track of trackers.get(view) ?? []) track(changes);
}

/** A writable editor of the file, if one is open here. */
export function openFileEditor(
  environmentId: EnvironmentId,
  cwd: string,
  path: string,
): OpenFileEditor | null {
  for (const editor of editors) {
    if (
      editor.environmentId === environmentId &&
      editor.cwd === cwd &&
      editor.path === path &&
      editor.writable()
    ) {
      return editor;
    }
  }
  return null;
}

/** Saves every editor of the file open here, so something can read it; false if one couldn't. */
export async function saveOpenFile(environmentId: EnvironmentId, cwd: string, path: string) {
  const open = [...editors].filter(
    (editor) =>
      editor.environmentId === environmentId && editor.cwd === cwd && editor.path === path,
  );
  const saved = await Promise.all(open.map((editor) => editor.save()));
  return saved.every(Boolean);
}

/**
 * Applies `replacements` (positions in the editor's text) in an open editor as one undoable edit,
 * and returns a way to take them back later, over whatever was typed since. A replacement edited
 * or taken back since is left alone; `undo` says whether any was taken back.
 */
export function editInOpenEditor(
  editor: OpenFileEditor,
  replacements: readonly TextReplacement[],
  userEvent: string,
): { readonly undo: () => boolean; readonly stop: () => void } {
  const view = editor.view;
  const made = madeReplacements(view.state.doc.toString(), replacements);
  const applied = ChangeSet.of(replacements, view.state.doc.length);
  view.dispatch({ changes: applied, userEvent });
  let since = ChangeSet.empty(applied.newLength);
  const track = (next: ChangeSet) => {
    since = since.compose(next);
  };
  let set = trackers.get(view);
  if (set === undefined) {
    set = new Set();
    trackers.set(view, set);
  }
  set.add(track);
  const stop = () => trackers.get(view)?.delete(track);
  return {
    stop,
    undo: () => {
      stop();
      if (!editors.has(editor)) return false;
      const { changes } = undoReplacements(made, view.state.doc, (pos, assoc) =>
        since.mapPos(pos, assoc),
      );
      if (changes.length === 0) return false;
      view.dispatch({ changes, userEvent: `${userEvent}.undo` });
      return true;
    },
  };
}
