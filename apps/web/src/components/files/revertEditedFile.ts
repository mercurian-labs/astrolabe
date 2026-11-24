/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { isolateHistory } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import {
  type DocumentEditor,
  DocumentSession,
  type DocumentSessionState,
  replacingChanges,
} from "@t3tools/client-runtime/state/document-session";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";

import { documentsEnvironment } from "~/state/documents";
import { projectEnvironment } from "~/state/projects";
import { openFileEditor } from "../repositories/openFileEditors";
import { newClientId } from "../repositories/useRepositoryDocument";

/**
 * Astrolabe: "Revert to agent's version" applied as one edit of the user's own, never a write from
 * the environment: in the file's open editor here, where Mod-z takes it back and redo reverts
 * again, or else in a document opened for it in the background, saved and closed.
 */

export interface FileRevertTarget {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  /** Told once the edit is on disk, so the thread records it. */
  readonly onSaved: () => void;
}

export type FileRevertOutcome =
  | {
      readonly ok: true;
      /** Puts back the text from before as one edit; a message when it can't. Null for a recreated file. */
      readonly undo: (() => Promise<string | null>) | null;
    }
  | { readonly ok: false; readonly message: string };

const lineBreak = /\r\n?|\n/;
const normalized = (text: string) => text.split(lineBreak).join("\n");

const COULD_NOT_SAVE = "The file could not be saved.";

function until(
  session: DocumentSession,
  done: (state: DocumentSessionState) => boolean,
): Promise<DocumentSessionState> {
  return new Promise((resolve) => {
    let stop = () => {};
    const check = () => {
      const state = session.getState();
      if (!done(state)) return false;
      stop();
      resolve(state);
      return true;
    };
    if (check()) return;
    const unsubscribe = session.subscribe(check);
    stop = () => void unsubscribe();
  });
}

const broken = (state: DocumentSessionState) =>
  state.status === "closed" || state.status === "failed" || state.status === "conflict";

/** Waits for the session's edits to reach disk; `now` saves at once rather than on its delay. */
async function onDisk(session: DocumentSession, now: boolean): Promise<boolean> {
  if (now) {
    const sent = await until(session, (state) => !state.unsent || broken(state));
    if (broken(sent) || (await session.save())?.ok !== true) return false;
  }
  return !broken(await until(session, (state) => !state.unsaved || broken(state)));
}

/** Replaces the editor's text with `next` as a step of its own in its undo history. */
function replaceText(editor: DocumentEditor, next: string): void {
  editor.dispatch({
    changes: replacingChanges(editor.state.doc.toString(), next),
    annotations: isolateHistory.of("full"),
    userEvent: "input.revert",
  });
}

/** Runs `edit` on the file's live document, opened for it alone, and closes it after. */
async function inBackground(
  target: FileRevertTarget,
  edit: (editor: DocumentEditor, session: DocumentSession) => Promise<string | null>,
): Promise<string | null> {
  const document = { cwd: target.cwd, relativePath: target.path };
  const session = new DocumentSession({
    target: document,
    clientId: newClientId(),
    channel: documentsEnvironment.channel(target.registry, target.environmentId, document),
    canWrite: () => true,
  });
  const unmount = target.registry.mount(documentsEnvironment.follow(target.environmentId, session));
  try {
    const opened = await until(session, (state) => state.status !== "opening");
    const initial = session.initialState();
    if (opened.status !== "open" || initial === null) {
      return opened.failure?.message ?? "The file could not be opened.";
    }
    let state = EditorState.create({ doc: initial.text, extensions: initial.extension });
    const editor: DocumentEditor = {
      get state() {
        return state;
      },
      dispatch: (spec) => {
        state = (spec instanceof Transaction ? spec : state.update(spec)).state;
      },
    };
    session.attach(editor);
    return await edit(editor, session);
  } finally {
    session.detach();
    unmount();
  }
}

/**
 * Makes the file read `next` as one edit, if it reads `expected` (any text when null). Returns
 * the text it replaced, or why it couldn't.
 */
async function replaceFile(
  target: FileRevertTarget,
  next: string,
  expected: string | null,
  recreate: boolean,
): Promise<{ readonly replaced: string } | { readonly message: string }> {
  const changedSince = "The file changed since the revert; undo it in the editor instead.";
  const open = openFileEditor(target.environmentId, target.cwd, target.path);
  if (open?.session) {
    const replaced = open.view.state.doc.toString();
    if (expected !== null && replaced !== expected) return { message: changedSince };
    replaceText(open.view, next);
    if (!(await onDisk(open.session, recreate))) return { message: COULD_NOT_SAVE };
    target.onSaved();
    return { replaced };
  }
  let replaced = "";
  const message = await inBackground(target, async (editor, session) => {
    replaced = editor.state.doc.toString();
    if (expected !== null && replaced !== expected) return changedSince;
    replaceText(editor, next);
    session.changed();
    return (await onDisk(session, true)) ? null : COULD_NOT_SAVE;
  });
  if (message !== null) return { message };
  target.onSaved();
  return { replaced };
}

/**
 * Puts the file back as `text`, the agent's version. A file deleted since is recreated: in its open
 * editor if one still holds it, else written anew, since a document can't be opened on a missing
 * file; there is nothing to undo back to then.
 */
export async function revertEditedFile(
  target: FileRevertTarget,
  revert: { readonly text: string; readonly missing: boolean },
): Promise<FileRevertOutcome> {
  if (revert.missing && openFileEditor(target.environmentId, target.cwd, target.path) === null) {
    const written = await projectEnvironment.writeFile.run(target.registry, {
      environmentId: target.environmentId,
      input: { cwd: target.cwd, relativePath: target.path, contents: revert.text },
    });
    if (!AsyncResult.isSuccess(written))
      return { ok: false, message: "The file could not be recreated." };
    target.onSaved();
    return { ok: true, undo: null };
  }
  const reverted = normalized(revert.text);
  const result = await replaceFile(target, reverted, null, revert.missing);
  if ("message" in result) return { ok: false, message: result.message };
  if (revert.missing) return { ok: true, undo: null };
  return {
    ok: true,
    undo: async () => {
      const undone = await replaceFile(target, result.replaced, reverted, false);
      return "message" in undone ? undone.message : null;
    },
  };
}
