import type { ChangeSet, Extension, Text } from "@codemirror/state";
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
    params: { uri: string; version?: number; diagnostics: Array<{ range: Range }> };
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

/** Cold projects take seconds before a server answers; lsp-client's default is 3. */
const REQUEST_TIMEOUT = 30_000;

export interface EnvironmentLsp {
  readonly client: LSPClient;
  /** For the file's editor; the file opens on the server once connected. */
  readonly extension: Extension;
  /** Call once the gateway's server is ready. */
  readonly connect: () => void;
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
  });
  const transport: Transport = {
    send(message) {
      const parsed = JSON.parse(message) as {
        id?: unknown;
        method?: string;
        params?: { textDocument?: { uri?: string } };
      };
      const uri = parsed.params?.textDocument?.uri;
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
      for (const diagnostic of entry.message.params.diagnostics) {
        const from = since.changes.mapPos(offsetOf(since.text, diagnostic.range.start), 1);
        const to = Math.max(
          from,
          since.changes.mapPos(offsetOf(since.text, diagnostic.range.end), -1),
        );
        diagnostic.range = { start: positionOf(current, from), end: positionOf(current, to) };
      }
      // lsp-client reads positions against its synced text and drops other versions: make both now.
      client.sync();
      entry.message.params.version = file.version;
      deliver(JSON.stringify(entry.message));
    }
  };
  const stopFollowing = document.onVersion(release);

  return {
    client,
    extension: client.plugin(options.uri, options.languageId),
    connect: () => {
      if (!client.connected) client.connect(transport);
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
      if (client.connected) client.disconnect();
    },
  };
}
