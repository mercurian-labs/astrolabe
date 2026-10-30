import { RegistryContext } from "@effect/atom-react";
import { Multibuffer } from "@mercurian/editor/multibuffer";
import { DocumentSession } from "@t3tools/client-runtime/state/document-session";
import { AuthFilesystemWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { useContext, useEffect, useState, useSyncExternalStore } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { documentsEnvironment } from "~/state/documents";
import { useEnvironmentScope } from "~/state/session";
import { registerUnsavedCheck } from "../../wiki/wikiPanes";

// Unique per document session; `crypto.randomUUID` is missing on plain-HTTP origins.
export const newClientId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

interface OpenDocument {
  readonly session: DocumentSession;
  readonly stop: () => void;
}

/** Whether any file of the view has edits the environment does not have yet, or has not saved. */
export interface MultibufferSaveState {
  readonly unsent: number;
  readonly unsaved: number;
}

/**
 * Astrolabe: a multi-file view's model, with one live document per file it shows, opened the first
 * time one of the file's excerpts scrolls into view and kept until the tab closes. Without write
 * access every excerpt is read only.
 */
export function useMultibuffer(options: {
  readonly tabKey: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly openFile: (path: string, line: number) => void;
}) {
  const { environmentId, cwd } = options;
  const registry = useContext(RegistryContext);
  const canWrite = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const writable = useStableCallback(() => canWrite);
  const openFile = useStableCallback(options.openFile);
  const [binding] = useState(() => {
    const documents = new Map<string, OpenDocument>();
    const saveListeners = new Set<() => void>();
    let saveState: MultibufferSaveState = { unsent: 0, unsaved: 0 };
    const recount = () => {
      let unsent = 0;
      let unsaved = 0;
      for (const { session } of documents.values()) {
        const state = session.getState();
        if (state.unsent) unsent += 1;
        if (state.unsaved) unsaved += 1;
      }
      if (unsent === saveState.unsent && unsaved === saveState.unsaved) return;
      saveState = { unsent, unsaved };
      for (const listener of saveListeners) listener();
    };
    const multibuffer: Multibuffer = new Multibuffer({
      open: (path) => {
        const target = { cwd, relativePath: path };
        const session = new DocumentSession({
          target,
          clientId: newClientId(),
          channel: documentsEnvironment.channel(registry, environmentId, target),
          canWrite: writable,
        });
        const unsubscribe = session.subscribe(() => {
          const file = multibuffer.fileList().find((item) => item.path === path);
          const state = session.getState();
          if (file !== undefined) {
            if (state.status === "failed") {
              multibuffer.documentFailed(
                file,
                state.failure?.message ?? "This file cannot be opened.",
              );
            } else multibuffer.documentReady(file);
          }
          recount();
        });
        const unmount = registry.mount(documentsEnvironment.follow(environmentId, session));
        documents.set(path, {
          session,
          stop: () => {
            unsubscribe();
            unmount();
          },
        });
        return session;
      },
      close: (path) => {
        documents.get(path)?.stop();
        documents.delete(path);
        recount();
      },
      openFile: (path, line) => openFile(path, line),
    });
    return {
      multibuffer,
      documents,
      saveState: {
        get: () => saveState,
        subscribe: (listener: () => void) => {
          saveListeners.add(listener);
          return () => saveListeners.delete(listener);
        },
      },
    };
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- closes the view's documents with the tab
  useEffect(() => () => binding.multibuffer.release(), [binding]);
  useEffect(
    () =>
      registerUnsavedCheck(options.tabKey, () =>
        [...binding.documents.values()].some(({ session }) => session.getState().unsent),
      ),
    [binding, options.tabKey],
  );
  const saveState = useSyncExternalStore(binding.saveState.subscribe, binding.saveState.get);
  return {
    multibuffer: binding.multibuffer,
    /** The files' sessions this view has open, by path. */
    sessions: binding.documents,
    canWrite,
    saveState,
  };
}
