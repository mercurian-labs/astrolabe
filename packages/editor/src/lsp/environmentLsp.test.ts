import {
  collab,
  getClientID,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import { forEachDiagnostic } from "@codemirror/lint";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vite-plus/test";

import { diagnosticsUi } from "./diagnostics.ts";
import {
  type EnvironmentDocument,
  environmentLsp,
  type LspDocumentState,
} from "./environmentLsp.ts";

const URI = "file:///repo/src/main.ts";

/**
 * The environment's copy of the file and an editor on it, as collab has them: the editor takes
 * the environment's updates only when `deliver` is called.
 */
function setup(text: string) {
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
      send: (message, state) => sent.push({ message: JSON.parse(message), document: state }),
    },
  });
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
          result: { capabilities: { textDocumentSync: { openClose: true, change: 0 } } },
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

const range = (doc: Text, from: number, to: number) => {
  const at = (offset: number) => {
    const line = doc.lineAt(offset);
    return { line: line.number - 1, character: offset - line.from };
  };
  return { start: at(from), end: at(to) };
};

describe("environmentLsp", () => {
  const mount = (text: string) => {
    const editor = setup(text);
    editor.view.setState(
      EditorState.create({
        doc: text,
        extensions: [
          collab({ clientID: "editor" }),
          editor.lsp.extension,
          diagnosticsUi({ keys: { next: [], previous: [] } }),
        ],
      }),
    );
    return editor;
  };

  it("sends no didChange, and gives each request the editor's version and unconfirmed edits", async () => {
    const editor = mount("const a = 1;\n");
    try {
      await editor.initialize();
      expect(editor.sent.map((entry) => entry.message.method)).toEqual([
        "initialize",
        "initialized",
        "textDocument/didOpen",
      ]);
      editor.agent({ from: 0, insert: "// agent\n" });
      editor.deliver();
      editor.type(0, "let b = 2;\n");
      const pending = editor.lsp.client.request("textDocument/hover", {
        textDocument: { uri: URI },
        position: { line: 0, character: 4 },
      });
      void pending.catch(() => undefined);
      editor.lsp.client.sync();
      await Promise.resolve();
      const hover = editor.sent.find((entry) => entry.message.method === "textDocument/hover")!;
      expect(hover.document).toMatchObject({ loadId: "load", version: 1, clientId: "editor" });
      expect(hover.document!.unconfirmed).toHaveLength(1);
      expect(editor.sent.some((entry) => entry.message.method === "textDocument/didChange")).toBe(
        false,
      );
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("initializes again when it connects after the gateway session was reset", async () => {
    const editor = mount("const a = 1;\n");
    try {
      await editor.initialize();
      editor.sent.length = 0;
      editor.lsp.reset();
      await editor.initialize();
      expect(editor.sent.map((entry) => entry.message.method)).toEqual([
        "initialize",
        "initialized",
        "textDocument/didOpen",
      ]);
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("holds diagnostics until the editor has their version, then lands them on the right text", async () => {
    const editor = mount("let value = 1;\n");
    try {
      await editor.initialize();
      // The agent adds two lines the editor hasn't received; the editor types its own meanwhile.
      const version = editor.agent({ from: 0, insert: "// one\n// two\n" });
      editor.type(0, "const mine = 0;\n");
      const environmentText = "// one\n// two\nlet value = 1;\n";
      const at = environmentText.indexOf("value");
      editor.lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: {
            uri: URI,
            version,
            diagnostics: [
              {
                range: range(Text.of(environmentText.split("\n")), at, at + 5),
                severity: 1,
                message: "unused",
              },
            ],
          },
        }),
        version,
      );
      expect(editor.diagnostics()).toEqual([]);
      editor.deliver();
      expect(editor.diagnostics()).toEqual(["value"]);
      expect(editor.view.state.doc.toString()).toBe(
        "// one\n// two\nconst mine = 0;\nlet value = 1;\n",
      );
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("writes the cursor line's messages below it", async () => {
    const editor = mount("let value = 1;\nlet other = 2;\n");
    try {
      await editor.initialize();
      const doc = editor.view.state.doc;
      editor.lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: {
            uri: URI,
            version: 0,
            diagnostics: [{ range: range(doc, 4, 9), severity: 1, message: "value is unused" }],
          },
        }),
        0,
      );
      editor.view.dispatch({ selection: { anchor: 2 } });
      await Promise.resolve();
      await Promise.resolve();
      const messages = editor.view.dom.querySelectorAll(".atlas-diagnostic-message");
      expect([...messages].map((element) => element.textContent)).toEqual(["value is unused"]);
      editor.view.dispatch({ selection: { anchor: doc.line(2).from } });
      await Promise.resolve();
      await Promise.resolve();
      expect(editor.view.dom.querySelectorAll(".atlas-diagnostic-message")).toHaveLength(0);
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });
});
