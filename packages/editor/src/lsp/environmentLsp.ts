import {
  type ChangeSet,
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  LSPClient,
  LSPPlugin,
  serverDiagnostics,
  type Transport,
  Workspace,
  type WorkspaceFile,
} from "@codemirror/lsp-client";

/**
 * Astrolabe: `@codemirror/lsp-client` for a file whose text the environment owns. The environment
 * is the language server's only client; this editor talks LSP to its gateway, which answers
 * `initialize` with no document sync (so lsp-client never sends `didChange`), maps each request's
 * positions into its own copy, and answers in the request's coordinates.
 */

/** What a request's positions are relative to: `LanguageServerDocumentState`. */
export interface LspDocumentState {
  readonly loadId: string;
  readonly version: number;
  readonly clientId: string;
  /** `ChangeSet.toJSON()` of each. */
  readonly unconfirmed: ReadonlyArray<ReturnType<ChangeSet["toJSON"]>>;
}

/** The environment's document behind the editor; a `DocumentSession` fits. */
export interface EnvironmentDocument {
  /** The editor's text as a request sees it: its confirmed version and unconfirmed edits. */
  lspState(): LspDocumentState | null;
  /** The environment's text at `version`, and the changes from it to the editor's text now. */
  changesSince(
    version: number,
  ): { readonly text: Text; readonly changes: ChangeSet } | "behind" | "gone";
  /** Called when the editor takes more of the environment's versions. */
  onVersion(listener: () => void): () => void;
}

/** One gateway session. */
export interface LspChannel {
  send(message: string, document: LspDocumentState | undefined): void;
}

interface EnvironmentFile extends WorkspaceFile {
  readonly view: EditorView;
  /** Recorded in `syncFiles`, which lsp-client runs just before it computes a request's positions. */
  lastSync: LspDocumentState | null;
}

/**
 * One file, one editor. `syncFiles` still reports its changes: lsp-client maps answers that are in
 * flight through them, including the environment's edits the editor received meanwhile.
 */
export class EnvironmentWorkspace extends Workspace {
  files: EnvironmentFile[] = [];
  private versions = 0;
  private readonly document: EnvironmentDocument;

  constructor(client: LSPClient, document: EnvironmentDocument) {
    super(client);
    this.document = document;
  }

  syncFiles() {
    const result = [];
    for (const file of this.files) {
      file.lastSync = this.document.lspState();
      const plugin = LSPPlugin.get(file.view);
      if (!plugin || plugin.unsyncedChanges.empty) continue;
      result.push({ file, prevDoc: file.doc, changes: plugin.unsyncedChanges });
      file.doc = file.view.state.doc;
      file.version = ++this.versions;
      plugin.clear();
    }
    return result;
  }

  openFile(uri: string, languageId: string, view: EditorView) {
    if (this.getFile(uri)) return;
    const file: EnvironmentFile = {
      uri,
      languageId,
      version: this.versions,
      doc: view.state.doc,
      view,
      getView: () => view,
      lastSync: this.document.lspState(),
    };
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri: string) {
    if (!this.getFile(uri)) return;
    this.files = this.files.filter((file) => file.uri !== uri);
    this.client.didClose(uri);
  }
}

interface Held {
  readonly version: number;
  readonly message: {
    params: {
      uri: string;
      version?: number;
      diagnostics: Array<{ range: Range; message: unknown; source?: unknown }>;
    };
  };
}

interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

const offsetOf = (doc: Text, position: Range["start"]) => {
  const line = doc.line(Math.max(1, Math.min(position.line + 1, doc.lines)));
  return Math.min(line.from + Math.max(0, position.character), line.to);
};

const positionOf = (doc: Text, offset: number) => {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
};

/** lsp-client keeps only a diagnostic's message, so its server's name goes in there to survive. */
const labelled = <T extends { readonly message: unknown; readonly source?: unknown }>(item: T) =>
  typeof item.message === "string" && typeof item.source === "string"
    ? { ...item, message: `${item.message} (${item.source})` }
    : item;

/** Marks an editor whose file has a language server, for menus that run its features. */
const languageServed = Facet.define<boolean>();

/** Whether `state`'s editor talks to a language server (the commands that ask it can run). */
export function hasLanguageServer(state: EditorState): boolean {
  return state.facet(languageServed).length > 0;
}

/** A diagnostic as the server sent it (code actions need its `code`), where it is in the text. */
export interface ServerDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly diagnostic: { readonly message: unknown; readonly [field: string]: unknown };
}

const setServerDiagnostics = StateEffect.define<readonly ServerDiagnostic[]>();

const serverDiagnosticsField = StateField.define<readonly ServerDiagnostic[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setServerDiagnostics)) return effect.value;
    if (!tr.docChanged || value.length === 0) return value;
    return value.map((entry) => {
      const from = tr.changes.mapPos(entry.from, 1);
      return { ...entry, from, to: Math.max(from, tr.changes.mapPos(entry.to, -1)) };
    });
  },
});

/** The server's diagnostics touching `from`-`to`, as it sent them, in the text now. */
export function serverDiagnosticsAt(
  state: EditorState,
  from: number,
  to: number,
): readonly ServerDiagnostic[] {
  return (state.field(serverDiagnosticsField, false) ?? []).filter(
    (entry) => entry.from <= to && entry.to >= from,
  );
}

/** Cold projects take seconds before a server answers; lsp-client's default is 3. */
const REQUEST_TIMEOUT = 30_000;

export interface EnvironmentLsp {
  readonly client: LSPClient;
  /** For the file's editor; the file opens on the server once connected. */
  readonly extension: Extension;
  /** Call once the gateway's server is ready. */
  readonly connect: () => void;
  /** The gateway session ended: the next `connect` initializes and opens the file again. */
  readonly reset: () => void;
  /** A message from the gateway; `version` is set when its positions are in the environment's copy. */
  readonly receive: (message: string, version?: number) => void;
  readonly destroy: () => void;
}

export function environmentLsp(options: {
  readonly uri: string;
  readonly languageId: string;
  readonly rootUri: string;
  readonly document: EnvironmentDocument;
  readonly channel: LspChannel;
  readonly timeout?: number;
}): EnvironmentLsp {
  const { document, channel } = options;
  const handlers = new Set<(message: string) => void>();
  let workspace: EnvironmentWorkspace | null = null;
  const client = new LSPClient({
    rootUri: options.rootUri,
    timeout: options.timeout ?? REQUEST_TIMEOUT,
    workspace: (owner) => (workspace = new EnvironmentWorkspace(owner, document)),
    extensions: [serverDiagnostics()],
    notificationHandlers: {
      // Companion servers join after `initialize`, and leave: this is what `client` can do now.
      "astrolabe/capabilities": (target, capabilities) => {
        target.serverCapabilities = capabilities as typeof target.serverCapabilities;
        return true;
      },
    },
  });
  const transport: Transport = {
    send(message) {
      const parsed = JSON.parse(message) as {
        id?: unknown;
        method?: string;
        params?: { textDocument?: { uri?: string } };
      };
      // An item handed back to resolve names no file: it is this editor's one.
      const uri =
        parsed.method === "completionItem/resolve"
          ? workspace?.files[0]?.uri
          : parsed.params?.textDocument?.uri;
      const file =
        parsed.id !== undefined && parsed.method !== undefined && uri !== undefined
          ? (workspace?.getFile(uri) as EnvironmentFile | null)
          : null;
      channel.send(message, file?.lastSync ?? undefined);
    },
    subscribe: (handler) => void handlers.add(handler),
    unsubscribe: (handler) => void handlers.delete(handler),
  };
  const deliver = (message: string) => {
    for (const handler of handlers) handler(message);
  };

  // Diagnostics name the environment's version they were computed at; each waits until the editor
  // has it, then moves through what the editor has done since. Only the newest per file is kept.
  const held = new Map<string, Held>();
  const release = () => {
    for (const [uri, entry] of held) {
      const file = workspace?.getFile(uri) as EnvironmentFile | null | undefined;
      const since = document.changesSince(entry.version);
      if (since === "behind") continue;
      held.delete(uri);
      if (since === "gone" || !file) continue;
      const current = file.view.state.doc;
      const kept: ServerDiagnostic[] = [];
      for (const diagnostic of entry.message.params.diagnostics) {
        const from = since.changes.mapPos(offsetOf(since.text, diagnostic.range.start), 1);
        const to = Math.max(
          from,
          since.changes.mapPos(offsetOf(since.text, diagnostic.range.end), -1),
        );
        diagnostic.range = { start: positionOf(current, from), end: positionOf(current, to) };
        kept.push({
          from,
          to,
          diagnostic: diagnostic as unknown as ServerDiagnostic["diagnostic"],
        });
      }
      file.view.dispatch({ effects: setServerDiagnostics.of(kept) });
      // lsp-client reads positions against its synced text and drops other versions: make both now.
      client.sync();
      entry.message.params.version = file.version;
      deliver(
        JSON.stringify({
          ...entry.message,
          params: {
            ...entry.message.params,
            diagnostics: entry.message.params.diagnostics.map(labelled),
          },
        }),
      );
    }
  };
  const stopFollowing = document.onVersion(release);
  // lsp-client's `disconnect` keeps its transport, so `client.connected` stays true after it.
  let attached = false;
  const detach = () => {
    if (attached) client.disconnect();
    attached = false;
  };

  return {
    client,
    extension: [
      client.plugin(options.uri, options.languageId),
      languageServed.of(true),
      serverDiagnosticsField,
    ],
    connect: () => {
      if (attached) return;
      attached = true;
      client.connect(transport);
    },
    reset: () => {
      held.clear();
      detach();
    },
    receive: (message, version) => {
      if (version === undefined) return deliver(message);
      const parsed = JSON.parse(message) as Held["message"] & { method?: string };
      if (parsed.method !== "textDocument/publishDiagnostics") return deliver(message);
      held.set(parsed.params.uri, { version, message: parsed });
      release();
    },
    destroy: () => {
      stopFollowing();
      held.clear();
      detach();
    },
  };
}
