import {
  collab,
  getClientID,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import { forEachDiagnostic } from "@codemirror/lint";
import { ChangeSet, EditorState, type Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  type EnvironmentDocument,
  environmentLsp,
  type LspDocumentState,
} from "./environmentLsp.ts";

/** Test-only: an editor with lsp-client on a fake environment and gateway. */

export const URI = "file:///repo/src/main.ts";

/**
 * The environment's copy of the file and an editor on it, as collab has them: the editor takes
 * the environment's updates only when `deliver` is called.
 */
export function setup(
  text: string,
  options: {
    readonly extensions?: Extension;
    /** Answers requests as the gateway would; unanswered ones wait for `lsp.receive`. */
    readonly answer?: (
      method: string,
      params: any,
      document: LspDocumentState | undefined,
    ) => unknown;
    readonly capabilities?: Record<string, unknown>;
  } = {},
) {
  const texts = [Text.of(text.split("\n"))];
  const updates: Array<{ clientID: string; changes: ChangeSet }> = [];
  const listeners = new Set<() => void>();
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: text, extensions: [collab({ clientID: "editor" })] }),
  });
  const document_: EnvironmentDocument = {
    lspState: () => ({
      loadId: "load",
      version: getSyncedVersion(view.state),
      clientId: getClientID(view.state),
      unconfirmed: sendableUpdates(view.state).map((update) => update.changes.toJSON()),
    }),
    changesSince: (version) => {
      const synced = getSyncedVersion(view.state);
      if (version > synced) return "behind";
      let changes = ChangeSet.empty(texts[version]!.length);
      for (const update of updates.slice(version, synced))
        changes = changes.compose(update.changes);
      for (const update of sendableUpdates(view.state)) changes = changes.compose(update.changes);
      return { text: texts[version]!, changes };
    },
    onVersion: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const sent: Array<{ message: any; document: LspDocumentState | undefined }> = [];
  const lsp = environmentLsp({
    uri: URI,
    languageId: "typescript",
    rootUri: "file:///repo",
    document: document_,
    channel: {
      send: (message, state) => {
        const parsed = JSON.parse(message);
        sent.push({ message: parsed, document: state });
        if (!options.answer || parsed.id === undefined || parsed.method === "initialize") return;
        const result = options.answer(parsed.method, parsed.params, state);
        if (result === undefined) return;
        // As over a socket: the answer arrives after the request has gone.
        setTimeout(() => lsp.receive(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result })));
      },
    },
  });
  view.setState(
    EditorState.create({
      doc: text,
      extensions: [collab({ clientID: "editor" }), lsp.extension, options.extensions ?? []],
    }),
  );
  return {
    view,
    lsp,
    sent,
    /** Another client's edit, accepted by the environment and not yet seen by the editor. */
    agent: (spec: { from: number; to?: number; insert: string }) => {
      const changes = ChangeSet.of([spec], texts.at(-1)!.length);
      updates.push({ clientID: "agent", changes });
      texts.push(changes.apply(texts.at(-1)!));
      return texts.length - 1;
    },
    deliver: () => {
      const synced = getSyncedVersion(view.state);
      view.dispatch(receiveUpdates(view.state, updates.slice(synced)));
      for (const listener of listeners) listener();
    },
    type: (from: number, insert: string) => view.dispatch({ changes: { from, insert } }),
    /** Answers the client's `initialize` as the gateway does. */
    initialize: async () => {
      lsp.connect();
      const init = sent.find((entry) => entry.message.method === "initialize")!;
      lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: init.message.id,
          result: {
            capabilities: {
              textDocumentSync: { openClose: true, change: 0 },
              ...options.capabilities,
            },
          },
        }),
      );
      await lsp.client.initializing;
      await Promise.resolve();
    },
    diagnostics: () => {
      const found: Array<string> = [];
      forEachDiagnostic(view.state, (_diagnostic, from, to) =>
        found.push(view.state.sliceDoc(from, to)),
      );
      return found;
    },
  };
}

export const range = (doc: Text, from: number, to: number) => {
  const at = (offset: number) => {
    const line = doc.lineAt(offset);
    return { line: line.number - 1, character: offset - line.from };
  };
  return { start: at(from), end: at(to) };
};
