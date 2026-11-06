// @effect-diagnostics nodeBuiltinImport:off - file URLs are converted synchronously, between writes.
import { ChangeSet, Text } from "@codemirror/state";
import {
  type CodeLocation,
  type CodeLocationKind,
  type CodeLocations,
  type DocumentError,
  type DocumentSaveInput,
  type DocumentSaveResult,
  type DocumentStreamItem,
  type FileDiagnostic,
  type FileDiagnostics,
  type LanguageServerAppliedEdit,
  type LanguageServerCheck,
  type LanguageServerCheckResult,
  type LanguageServerInfo,
  type LanguageServerLogItem,
  type LanguageServerSetTraceInput,
  type LanguageServerUndoEditInput,
  type LanguageServerUndoEditResult,
  languageServerForPath,
  LanguageServerError,
  type LanguageServerId,
  type LanguageServerProblemsItem,
  type LanguageServerSendInput,
  type LanguageServerSessionInput,
  type LanguageServerSessionItem,
  type LanguageServerStatus,
  type LanguageServerTarget,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeURL from "node:url";

import * as ServerConfig from "../config.ts";
import * as Documents from "../documents/Documents.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import {
  connect,
  ContentModified,
  type LspConnection,
  RequestCancelled,
  type ResponseError,
  ServerCancelled,
} from "./connection.ts";
import {
  DEFAULT_REGISTRY,
  describeDownload,
  makeInstaller,
  type ResolvedServer,
} from "./install.ts";
import { parseJson, stringifyJson } from "./json.ts";
import { type LogEvent, type LogSubscriber, makeServerLog, type ServerLog } from "./logs.ts";
import { makeMemoryReader, type MemoryReader } from "./memory.ts";
import {
  browserToAuthority,
  forwardMapper,
  inverseMapper,
  LOCATION_METHODS,
  locationsOf,
  mapDiagnostics,
  mapParams,
  mapResult,
  toPosition,
  trimCompletion,
  trimHover,
  Unrepresentable,
  wordBefore,
} from "./positions.ts";
import { LANGUAGE_SERVERS, type LanguageServerSpec } from "./registry.ts";
import { makeProjectTrust } from "./trust.ts";
import {
  type FileWatcher,
  FILE_CHANGE_TYPES,
  mergeChange,
  type WatchedFileChange,
  watched,
  watchersOf,
} from "./watchedFiles.ts";
import { changeSetOf, editsByFile } from "./workspaceEdits.ts";

/**
 * One server per language per checkout, and the environment as its only LSP client; see
 * docs/internals/language-servers.md for how browsers reach it through the gateway.
 */
export class LanguageServers extends Context.Service<
  LanguageServers,
  {
    /** Every server now, then the whole list on each change. */
    readonly subscribe: Stream.Stream<ReadonlyArray<LanguageServerStatus>>;
    /** What each server would run for a checkout, starting and downloading none. */
    readonly check: (cwd: string) => Effect.Effect<LanguageServerCheckResult, LanguageServerError>;
    readonly restart: (input: LanguageServerTarget) => Effect.Effect<void, LanguageServerError>;
    readonly stop: (input: LanguageServerTarget) => Effect.Effect<void, LanguageServerError>;
    /** Trusts a checkout's repository; its servers that are held back or restricted restart. */
    readonly trustProject: (cwd: string) => Effect.Effect<void, LanguageServerError>;
    /** Takes the trust back; the repository's servers restart in their restricted form. */
    readonly revokeProjectTrust: (cwd: string) => Effect.Effect<void, LanguageServerError>;
    /** A server's kept output, then what follows in batches, surviving its restarts. */
    readonly logs: (
      input: LanguageServerTarget,
    ) => Stream.Stream<LanguageServerLogItem, LanguageServerError>;
    readonly setTrace: (
      input: LanguageServerSetTraceInput,
    ) => Effect.Effect<void, LanguageServerError>;
    /** One LSP connection: the server's status, then messages from the gateway. */
    readonly session: (
      input: LanguageServerSessionInput,
    ) => Stream.Stream<LanguageServerSessionItem, LanguageServerError>;
    readonly send: (input: LanguageServerSendInput) => Effect.Effect<void, LanguageServerError>;
    /** Diagnostics for a file as it is now: a write made before the call is in them. */
    readonly diagnostics: (input: {
      readonly cwd: string;
      readonly relativePath: string;
    }) => Effect.Effect<FileDiagnostics, LanguageServerError>;
    /**
     * The documents' save, formatting the file first when asked and a server can. A formatter
     * slower than `formatTimeout` is skipped: the file saves as it is.
     */
    readonly save: (input: DocumentSaveInput) => Effect.Effect<DocumentSaveResult, DocumentError>;
    /** Puts back the files of an edit the environment applied (a rename), as far as it can. */
    readonly undoEdit: (
      input: LanguageServerUndoEditInput,
    ) => Effect.Effect<LanguageServerUndoEditResult, LanguageServerError>;
    /**
     * Files in a checkout that changed outside its documents, for the servers watching them. A
     * burst reaches each server as one `workspace/didChangeWatchedFiles`.
     */
    readonly filesChanged: (input: FilesChangedInput) => Effect.Effect<void>;
    /**
     * Where the symbol at a file's line and column (from 1) is defined, or used, as the file is
     * now: a write made before the call is in it.
     */
    readonly locate: (input: {
      readonly cwd: string;
      readonly relativePath: string;
      readonly line: number;
      /** The column, or the symbol's text, whose first occurrence on the line is used. */
      readonly column?: number;
      readonly symbol?: string;
      readonly kind: CodeLocationKind;
    }) => Effect.Effect<CodeLocations, LanguageServerError>;
    /** A checkout's problems in every file a server has checked, then each file's changes. */
    readonly problems: (cwd: string) => Stream.Stream<LanguageServerProblemsItem>;
  }
>()("t3/languageServers/LanguageServers") {}

export interface FilesChangedInput {
  readonly cwd: string;
  readonly changes: ReadonlyArray<WatchedFileChange>;
}

export interface LanguageServersOptions {
  readonly specs: Readonly<Partial<Record<LanguageServerId, LanguageServerSpec>>>;
  /** No documents and no sessions for this long stops a server. */
  readonly idleTimeout: Duration.Input;
  /** Resident memory every server may use together; past it the least recently used stop. */
  readonly memoryBudgetBytes: number;
  readonly memorySampleInterval: Duration.Input;
  /** Waits before each restart after a crash; one more crash than there are delays gives up. */
  readonly restartDelays: ReadonlyArray<Duration.Input>;
  readonly initializeTimeout: Duration.Input;
  readonly diagnosticsTimeout: Duration.Input;
  /**
   * How long a file's diagnostics must stand before an agent is told them: a server may publish
   * nothing for a file and its real results a moment later.
   */
  readonly diagnosticsQuiet: Duration.Input;
  /** How long a server's file changes wait for more before it hears of them. */
  readonly fileChangeQuiet: Duration.Input;
  /** How long a save waits for its formatter. */
  readonly formatTimeout: Duration.Input;
  readonly registry: string;
  /** Defaults to `caches/language-servers` under T3 home, shared by every checkout. */
  readonly cacheDir?: string;
  readonly readMemory?: MemoryReader;
  /**
   * Whether a checkout's project is trusted, in place of the environment's record. A trusted one
   * gets every launch, downloading as needed; an untrusted one only restricted-safe launches
   * already here, and nothing of its own runs.
   */
  readonly trusted?: ((cwd: string) => Effect.Effect<boolean>) | undefined;
}

/** Versions of each document kept to map an editor's positions from; older ones get ContentModified. */
const VERSIONS_KEPT = 200;
const PULL_RETRIES = 3;
const DIAGNOSTICS_LISTED = 200;
/** Applied edits kept for undo; older ones can no longer be undone. */
const EDITS_KEPT = 20;
const LOCATIONS_LISTED = 200;
const PREVIEW_LENGTH = 200;

const LOCATE_METHODS: Readonly<
  Record<CodeLocationKind, { readonly method: string; readonly capability: string }>
> = {
  definition: { method: "textDocument/definition", capability: "definitionProvider" },
  declaration: { method: "textDocument/declaration", capability: "declarationProvider" },
  typeDefinition: { method: "textDocument/typeDefinition", capability: "typeDefinitionProvider" },
  implementation: { method: "textDocument/implementation", capability: "implementationProvider" },
  references: { method: "textDocument/references", capability: "referencesProvider" },
};
const SHUTDOWN_TIMEOUT = Duration.seconds(2);
/** Log events a subscriber may fall behind by; past it the oldest are dropped. */
const LOG_EVENTS_QUEUED = 8192;
const LOG_BATCH_SIZE = 1024;
/** Batches reach a client at most this often, however fast a server writes. */
const LOG_BATCH_WINDOW = Duration.millis(150);
const LOG_SEVERITIES = [undefined, "error", "warning", "info", "log"] as const;

// LSP messages are untyped JSON; each use checks the shape it reads.
type Json = any;

interface Update {
  readonly clientID: string;
  readonly changes: ChangeSet;
}

interface PublishedDiagnostics {
  readonly version: number;
  readonly diagnostics: ReadonlyArray<Json>;
}

interface GatewayDoc {
  readonly relativePath: string;
  readonly uri: string;
  readonly languageId: string;
  holders: number;
  loadId: string | null;
  /** The environment's version, as the last update this copy has seen. */
  version: number;
  /** Texts from `oldest` to `version`, and the updates between them. */
  oldest: number;
  readonly texts: Map<number, Text>;
  updates: Array<Update>;
  /** The process generation the document is open on. */
  openOn: number | null;
  latest: PublishedDiagnostics | null;
  /** A server may do both (rust-analyzer pushes `cargo check`), each replacing only its own. */
  pulled: ReadonlyArray<Json>;
  pushed: ReadonlyArray<Json>;
  /** Bumped by each publish, to tell when they have stopped. */
  published: number;
  pulling: boolean;
  dirty: boolean;
  readonly waiters: Set<() => void>;
  readonly scope: Scope.Closeable;
}

/** A file as the server last saw it: what its edits' positions are in. */
interface ServerText {
  readonly loadId: string;
  readonly version: number;
  readonly text: Text;
}

/** One file of an applied edit: the update it became, and its inverse. */
interface AppliedFile {
  readonly relativePath: string;
  readonly loadId: string;
  /** The document's version right after the edit. */
  readonly version: number;
  readonly inverse: ChangeSet;
  /** The file's text right after the edit, to recognise it once the document was reloaded. */
  readonly after: string;
}

interface AppliedEdit {
  readonly cwd: string;
  readonly files: ReadonlyArray<AppliedFile>;
}

interface PendingForward {
  serverId: number | null;
  fiber: Fiber.Fiber<void> | null;
}

interface Session {
  readonly id: string;
  readonly queue: Queue.Queue<LanguageServerSessionItem>;
  /** Uris as the client named them, by path. */
  readonly open: Map<string, string>;
  readonly pending: Map<number | string, PendingForward>;
  readonly scope: Scope.Closeable;
  /** The file of the last completion list: `completionItem/resolve` names no document. */
  completionPath: string | null;
  /** The last code actions offered, as the server gave them, and the texts they are about. */
  codeActions: {
    readonly actions: ReadonlyArray<Json>;
    readonly seen: ReadonlyMap<string, ServerText>;
  } | null;
}

interface Running {
  readonly generation: number;
  readonly connection: LspConnection;
  readonly capabilities: Json;
  readonly pull: boolean;
  /** What the server says it is, from its `initialize` answer. */
  readonly version: string | null;
}

interface ServerEdit {
  readonly edit: Json;
  readonly done: (applied: LanguageServerAppliedEdit | null) => void;
}

interface Instance {
  readonly key: string;
  readonly cwd: string;
  /** `cwd` with links resolved, as servers often name files (`/private/var` on macOS). */
  readonly realCwd: string;
  readonly spec: LanguageServerSpec;
  readonly lock: Semaphore.Semaphore;
  readonly scope: Scope.Closeable;
  status: LanguageServerStatus;
  readonly sessions: Map<string, Session>;
  readonly docs: Map<string, GatewayDoc>;
  /** Documents waiting for a diagnostics pull. */
  readonly pulls: Queue.Queue<GatewayDoc>;
  running: Running | null;
  /** Still loading the project, for a server that says when it has finished. */
  loading: boolean;
  /** The resolved launch's answers to `workspace/configuration`, by section. */
  settings: Readonly<Record<string, unknown>>;
  /** The server's `workspace/applyEdit` requests, applied one at a time. */
  readonly serverEdits: Queue.Queue<ServerEdit>;
  /** While a command runs for a code action: the edits the server applied meanwhile. */
  collecting: Array<LanguageServerAppliedEdit> | null;
  /** The process's `workspace/didChangeWatchedFiles` registrations, by id. */
  readonly watchers: Map<string, ReadonlyArray<FileWatcher>>;
  /** File changes waiting out a burst, by path; `changesGeneration` restarts the wait. */
  readonly changes: Map<string, WatchedFileChange["type"]>;
  changesGeneration: number;
  /** Called on each status change, for those waiting on one. */
  readonly statusWatchers: Set<() => void>;
  /** Kept apart from the process and the instance: a crash's output outlives both. */
  readonly log: ServerLog;
  /** The last launch. */
  launched: ResolvedServer | null;
  /** Resolves when the current or next process is ready. */
  ready: Deferred.Deferred<Running>;
  processScope: Scope.Closeable | null;
  /** Bumped by every start and stop, so a stale exit or idle timer does nothing. */
  generation: number;
  crashes: number;
  lastUsed: number;
}

const failure = (reason: LanguageServerError["reason"], message: string, cause?: unknown) =>
  new LanguageServerError({ reason, message, ...(cause === undefined ? {} : { cause }) });

const errorMessage = (error: ResponseError) => ({ code: error.code, message: error.message });

/** What the gateway asks of a server: everything `@codemirror/lsp-client` can use, and pulls. */
const CLIENT_CAPABILITIES = {
  general: { markdown: { parser: "marked" }, positionEncodings: ["utf-16"] },
  textDocument: {
    synchronization: { dynamicRegistration: false },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ["markdown", "plaintext"],
        insertReplaceSupport: false,
        resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] },
      },
      completionList: { itemDefaults: ["commitCharacters", "editRange", "insertTextFormat"] },
      completionItemKind: { valueSet: [] },
      contextSupport: true,
    },
    hover: { contentFormat: ["markdown", "plaintext"] },
    formatting: {},
    rename: { prepareSupport: true },
    signatureHelp: {
      contextSupport: true,
      signatureInformation: {
        documentationFormat: ["markdown", "plaintext"],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
      },
    },
    definition: { linkSupport: true },
    declaration: {},
    implementation: {},
    typeDefinition: {},
    references: {},
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            "",
            "quickfix",
            "refactor",
            "refactor.extract",
            "refactor.inline",
            "refactor.rewrite",
            "source",
            "source.organizeImports",
            "source.fixAll",
          ],
        },
      },
      isPreferredSupport: true,
      disabledSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ["edit"] },
    },
    diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
    publishDiagnostics: { versionSupport: true, relatedInformation: true },
  },
  workspace: {
    configuration: true,
    workspaceFolders: true,
    applyEdit: true,
    didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
  },
  window: { workDoneProgress: false, showMessage: {} },
};

const QUIESCENCE_CAPABILITIES = {
  ...CLIENT_CAPABILITIES,
  experimental: { serverStatusNotification: true },
};

/** A `workspace/configuration` item's answer: its dotted section, or every setting without one. */
const settingsSection = (settings: Readonly<Record<string, unknown>>, section: unknown) => {
  if (typeof section !== "string" || section === "") return settings;
  let value: Json = settings;
  for (const key of section.split(".")) {
    value = typeof value === "object" && value !== null ? value[key] : undefined;
  }
  return value ?? null;
};

const severityName = (severity: unknown): FileDiagnostic["severity"] =>
  severity === 2 ? "warning" : severity === 3 ? "info" : severity === 4 ? "hint" : "error";

const contentModified = (message: string) => ({ code: ContentModified, message });

interface Translation {
  readonly browserDoc: Text;
  readonly authorityDoc: Text;
  readonly changes: ChangeSet;
}

/**
 * The request's params in the environment's copy: the editor's text (its confirmed version plus
 * its unconfirmed edits) mapped through what it has not received. Synchronous on purpose.
 */
const translateRequest = (
  doc: GatewayDoc | undefined,
  state: LanguageServerSendInput["document"],
  rawParams: Json,
): { readonly params: Json; readonly context: Translation | null } | { readonly error: Json } => {
  const params = structuredClone(rawParams ?? null);
  if (doc === undefined) return { params, context: null };
  if (params?.textDocument) params.textDocument.uri = doc.uri;
  if (state === undefined) return { params, context: null };
  const base = doc.texts.get(state.version);
  if (state.loadId !== doc.loadId || base === undefined) {
    return { error: contentModified("The editor is too far behind.") };
  }
  try {
    const unconfirmed = state.unconfirmed.map((json) => ChangeSet.fromJSON(json));
    const browserDoc = unconfirmed.reduce((text, changes) => changes.apply(text), base);
    const changes = browserToAuthority(
      doc.updates.slice(state.version - doc.oldest),
      state.clientId,
      unconfirmed,
      browserDoc.length,
    );
    const authorityDoc = doc.texts.get(doc.version)!;
    mapParams(params, forwardMapper(browserDoc, authorityDoc, changes));
    return { params, context: { browserDoc, authorityDoc, changes } };
  } catch {
    return { error: contentModified("The edits could not be mapped.") };
  }
};

/** The answer back in the request's coordinates; edits into text it lacks refuse the whole answer. */
const mapAnswer = (
  method: string,
  raw: Json,
  doc: GatewayDoc | undefined,
  context: Translation | null,
  query: string,
): { readonly result: Json } | { readonly error: Json } => {
  const result =
    method === "textDocument/completion"
      ? trimCompletion(raw, query)
      : method === "textDocument/hover"
        ? trimHover(raw)
        : raw;
  if (context === null || doc === undefined) return { result };
  try {
    return {
      result: mapResult(
        method,
        result,
        doc.uri,
        inverseMapper(context.authorityDoc, context.browserDoc, context.changes),
      ),
    };
  } catch (error) {
    if (error instanceof Unrepresentable) {
      return { error: contentModified("The answer edits text this editor has not received.") };
    }
    throw error;
  }
};

const make = Effect.fn("LanguageServers.make")(function* (options: LanguageServersOptions) {
  const documents = yield* Documents.Documents;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const cacheDir = options.cacheDir ?? path.join(config.providerStatusCacheDir, "language-servers");
  const installer = yield* makeInstaller({ cacheDir, registry: options.registry });
  const trust = yield* makeProjectTrust({
    file: path.join(path.dirname(cacheDir), "language-server-trust.json"),
    repositoryOf: installer.repositoryOf,
  });
  const isTrusted = options.trusted ?? trust.isTrusted;
  const readMemory = options.readMemory ?? (yield* makeMemoryReader());
  const processServices = yield* Effect.context<
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >();
  const serviceScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const instances = new Map<string, Instance>();
  const sessions = new Map<string, { readonly instance: Instance; readonly session: Session }>();
  const statuses = yield* SubscriptionRef.make<ReadonlyArray<LanguageServerStatus>>([]);
  const applied = new Map<string, AppliedEdit>();
  const logs = new Map<string, ServerLog>();
  let editCount = 0;
  let clock = 0;

  const fork = <A, E>(effect: Effect.Effect<A, E>, scope: Scope.Scope = serviceScope) =>
    effect.pipe(
      Effect.ignore({ log: "Warn", message: "A language-server task failed." }),
      Effect.forkIn(scope, { startImmediately: true }),
    );

  const publishList = () =>
    SubscriptionRef.set(
      statuses,
      [...instances.values()].map((instance) => instance.status),
    );

  const setStatus = (instance: Instance, patch: Partial<LanguageServerStatus>) =>
    Effect.suspend(() => {
      instance.status = { ...instance.status, ...patch };
      for (const session of instance.sessions.values()) {
        Queue.offerUnsafe(session.queue, { type: "status", status: instance.status });
      }
      for (const watcher of instance.statusWatchers) watcher();
      instance.log.stateChanged();
      return instances.get(instance.key) === instance ? publishList() : Effect.void;
    });

  const toMessage = (message: object): string => stringifyJson({ jsonrpc: "2.0", ...message });

  const sendTo = (session: Session, message: object, version?: number) => {
    Queue.offerUnsafe(session.queue, {
      type: "message",
      message: toMessage(message),
      ...(version === undefined ? {} : { version }),
    });
  };

  /** A document's latest diagnostics, carried to its current version, as tools list them. */
  const listedDiagnostics = (doc: GatewayDoc): FileDiagnostics => {
    const latest = doc.latest ?? { version: doc.version, diagnostics: [] };
    const text = doc.texts.get(latest.version) ?? doc.texts.get(doc.version);
    const current = doc.texts.get(doc.version);
    // Pulled before the latest edits: carry them to the version reported.
    const items =
      latest.version === doc.version || text === undefined || current === undefined
        ? latest.diagnostics
        : mapDiagnostics(
            structuredClone(latest.diagnostics),
            forwardMapper(
              text,
              current,
              doc.updates
                .slice(latest.version - doc.oldest)
                .reduce((all, update) => all.compose(update.changes), ChangeSet.empty(text.length)),
            ),
          );
    const listed = items.slice(0, DIAGNOSTICS_LISTED).map((item: Json): FileDiagnostic => ({
      severity: severityName(item.severity),
      line: (item.range?.start?.line ?? 0) + 1,
      column: (item.range?.start?.character ?? 0) + 1,
      endLine: (item.range?.end?.line ?? 0) + 1,
      endColumn: (item.range?.end?.character ?? 0) + 1,
      message: String(
        typeof item.message === "string" ? item.message : (item.message?.value ?? ""),
      ),
      ...(item.code === undefined || item.code === null ? {} : { code: String(item.code) }),
      ...(typeof item.source === "string" ? { source: item.source } : {}),
    }));
    return {
      path: doc.relativePath,
      version: doc.version,
      diagnostics: listed,
      truncated: items.length > listed.length,
    };
  };

  // Astrolabe: each checkout's latest problems by file, kept after a file closes until its
  // server stops, for the problems view.
  const problems = new Map<
    string,
    { readonly instance: string; readonly cwd: string; readonly file: FileDiagnostics }
  >();
  const problemEvents = yield* PubSub.unbounded<{
    readonly cwd: string;
    readonly file: FileDiagnostics;
  }>();
  const problemKey = (cwd: string, relativePath: string) => `${path.resolve(cwd)}\0${relativePath}`;

  const noteProblems = (instance: Instance, doc: GatewayDoc) => {
    // Closing a file nobody holds clears it for its editors; its problems stay listed.
    if (doc.holders === 0) return;
    const file = listedDiagnostics(doc);
    const key = problemKey(instance.cwd, doc.relativePath);
    const known = problems.get(key);
    if (file.diagnostics.length === 0) {
      if (known === undefined) return;
      problems.delete(key);
    } else problems.set(key, { instance: instance.key, cwd: path.resolve(instance.cwd), file });
    PubSub.publishUnsafe(problemEvents, { cwd: path.resolve(instance.cwd), file });
  };

  /** Forgets a stopped server's problems for files it no longer has open. */
  const forgetProblems = (instance: Instance) => {
    for (const [key, entry] of problems) {
      if (entry.instance !== instance.key || instance.docs.has(entry.file.path)) continue;
      problems.delete(key);
      PubSub.publishUnsafe(problemEvents, {
        cwd: path.resolve(instance.cwd),
        file: { ...entry.file, diagnostics: [], truncated: false },
      });
    }
  };

  const fanOutDiagnostics = (instance: Instance, doc: GatewayDoc) => {
    noteProblems(instance, doc);
    const latest = doc.latest ?? { version: doc.version, diagnostics: [] };
    for (const session of instance.sessions.values()) {
      const uri = session.open.get(doc.relativePath);
      if (uri === undefined) continue;
      sendTo(
        session,
        {
          method: "textDocument/publishDiagnostics",
          params: { uri, version: latest.version, diagnostics: latest.diagnostics },
        },
        latest.version,
      );
    }
  };

  const setDiagnostics = (instance: Instance, doc: GatewayDoc, published: PublishedDiagnostics) => {
    doc.published += 1;
    if (doc.latest !== null && doc.latest.version > published.version) return;
    doc.latest = published;
    fanOutDiagnostics(instance, doc);
    for (const wake of doc.waiters) wake();
  };

  const clearDiagnostics = (instance: Instance) => {
    forgetProblems(instance);
    for (const doc of instance.docs.values()) {
      if (doc.latest === null) continue;
      doc.latest = { version: doc.version, diagnostics: [] };
      doc.pulled = [];
      doc.pushed = [];
      fanOutDiagnostics(instance, doc);
    }
  };

  /** One pull at a time per document; edits meanwhile ask for one more after it. */
  const schedulePull = (instance: Instance, doc: GatewayDoc) => {
    const running = instance.running;
    if (running === null || !running.pull || doc.openOn !== running.generation) return;
    if (doc.pulling) {
      doc.dirty = true;
      return;
    }
    doc.pulling = true;
    Queue.offerUnsafe(instance.pulls, doc);
  };

  // Untraced: one per pull, which follows every batch of edits.
  const pull = Effect.fnUntraced(function* (instance: Instance, doc: GatewayDoc) {
    const running = instance.running;
    if (running === null) {
      doc.pulling = false;
      return;
    }
    yield* Effect.gen(function* () {
      let retries = 0;
      do {
        doc.dirty = false;
        if (instance.running !== running || doc.openOn !== running.generation) break;
        // Read with the write: the server answers for the last version it was sent.
        const version = doc.version;
        const { response } = running.connection.request("textDocument/diagnostic", {
          textDocument: { uri: doc.uri },
        });
        const result = yield* response.pipe(
          Effect.map((report) => ({ ok: true as const, report: report as Json })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
        );
        if (!result.ok) {
          const retry =
            (result.error.code === ServerCancelled || result.error.code === ContentModified) &&
            retries++ < PULL_RETRIES;
          if (retry) doc.dirty = true;
          continue;
        }
        if (result.report?.kind === "full" && Array.isArray(result.report.items)) {
          doc.pulled = result.report.items;
          setDiagnostics(instance, doc, { version, diagnostics: [...doc.pulled, ...doc.pushed] });
        }
      } while (doc.dirty);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          doc.pulling = false;
          for (const wake of doc.waiters) wake();
        }),
      ),
    );
  });

  const openOnServer = (instance: Instance, doc: GatewayDoc) => {
    const running = instance.running;
    const text = doc.texts.get(doc.version);
    if (running === null || doc.loadId === null || text === undefined) return;
    if (doc.openOn === running.generation) return;
    doc.openOn = running.generation;
    running.connection.notify("textDocument/didOpen", {
      textDocument: {
        uri: doc.uri,
        languageId: doc.languageId,
        version: doc.version,
        text: text.toString(),
      },
    });
    schedulePull(instance, doc);
  };

  const closeOnServer = (instance: Instance, doc: GatewayDoc) => {
    const running = instance.running;
    if (running !== null && doc.openOn === running.generation) {
      running.connection.notify("textDocument/didClose", { textDocument: { uri: doc.uri } });
      if (instance.spec.forgetsClosedFiles) {
        running.connection.notify("workspace/didChangeWatchedFiles", {
          changes: [{ uri: doc.uri, type: FILE_CHANGE_TYPES.created }],
        });
      }
    }
    doc.openOn = null;
  };

  const trimHistory = (doc: GatewayDoc) => {
    while (doc.version - doc.oldest > VERSIONS_KEPT) {
      doc.texts.delete(doc.oldest);
      doc.updates.shift();
      doc.oldest += 1;
    }
  };

  const onDocumentItem = (instance: Instance, doc: GatewayDoc, item: Json) => {
    if (item.type === "snapshot") {
      closeOnServer(instance, doc);
      doc.loadId = item.loadId;
      doc.version = item.version;
      doc.oldest = item.version;
      doc.texts.clear();
      doc.texts.set(item.version, Text.of(String(item.text).split("\n")));
      doc.updates = [];
      doc.latest = null;
      doc.pulled = [];
      doc.pushed = [];
      openOnServer(instance, doc);
    } else if (item.type === "updates") {
      const running = instance.running;
      const open = running !== null && doc.openOn === running.generation;
      for (const [index, wire] of (item.updates as Array<Json>).entries()) {
        if (item.version + index < doc.version) continue;
        const previous = doc.texts.get(doc.version)!;
        const changes = ChangeSet.fromJSON(wire.changes);
        const next = changes.apply(previous);
        doc.updates.push({ clientID: wire.clientId, changes });
        doc.version += 1;
        doc.texts.set(doc.version, next);
        if (open) {
          const contentChanges: Array<Json> = [];
          changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            contentChanges.push({
              range: { start: toPosition(previous, fromA), end: toPosition(previous, toA) },
              text: inserted.toString(),
            });
          });
          // Each change's range is in the text before it; from the end, the earlier ones hold.
          running.connection.notify("textDocument/didChange", {
            textDocument: { uri: doc.uri, version: doc.version },
            contentChanges: contentChanges.reverse(),
          });
        }
      }
      trimHistory(doc);
      if (open) schedulePull(instance, doc);
    }
    for (const wake of doc.waiters) wake();
  };

  /** Resolves once `ready` holds, re-checked after each change to the document. */
  const until = (doc: GatewayDoc, ready: () => boolean) =>
    Effect.callback<void>((resume) => {
      if (ready()) return resume(Effect.void);
      const wake = () => {
        if (!ready()) return;
        doc.waiters.delete(wake);
        resume(Effect.void);
      };
      doc.waiters.add(wake);
      return Effect.sync(() => doc.waiters.delete(wake));
    });

  const holdDoc = Effect.fn("LanguageServers.holdDoc")(function* (
    instance: Instance,
    relativePath: string,
    languageId: string,
  ) {
    let doc = instance.docs.get(relativePath);
    if (doc === undefined) {
      const created: GatewayDoc = {
        relativePath,
        uri: NodeURL.pathToFileURL(path.join(instance.cwd, relativePath)).href,
        languageId,
        holders: 0,
        loadId: null,
        version: 0,
        oldest: 0,
        texts: new Map(),
        updates: [],
        openOn: null,
        latest: null,
        pulled: [],
        pushed: [],
        published: 0,
        pulling: false,
        dirty: false,
        waiters: new Set(),
        scope: yield* Scope.fork(instance.scope),
      };
      doc = created;
      instance.docs.set(relativePath, created);
      yield* documents.subscribe({ cwd: instance.cwd, relativePath }).pipe(
        Stream.runForEach((item) => Effect.sync(() => onDocumentItem(instance, created, item))),
        Effect.ignore({ log: "Warn", message: "A language server lost its document." }),
        Effect.ensuring(
          Effect.sync(() => {
            // The document closed (deleted and discarded) or failed to open.
            closeOnServer(instance, created);
            if (instance.docs.get(relativePath) === created) instance.docs.delete(relativePath);
            created.latest = { version: created.version, diagnostics: [] };
            fanOutDiagnostics(instance, created);
            created.loadId = null;
            for (const wake of created.waiters) wake();
          }),
        ),
        Effect.forkIn(created.scope, { startImmediately: true }),
      );
    }
    doc.holders += 1;
    instance.lastUsed = ++clock;
    return doc;
  });

  const releaseDoc = (instance: Instance, doc: GatewayDoc) =>
    Effect.suspend(() => {
      doc.holders -= 1;
      if (doc.holders > 0) return Effect.void;
      closeOnServer(instance, doc);
      if (instance.docs.get(doc.relativePath) === doc) instance.docs.delete(doc.relativePath);
      return Scope.close(doc.scope, Exit.void).pipe(Effect.andThen(scheduleIdle(instance)));
    });

  const logMessage = (log: ServerLog, source: "log" | "message", params: Json) =>
    log.line(source, String(params?.message ?? ""), LOG_SEVERITIES[params?.type]);

  const onRequestFromServer = (instance: Instance) => (method: string, params: Json) => {
    switch (method) {
      case "workspace/configuration":
        return Array.isArray(params?.items)
          ? params.items.map((item: Json) => settingsSection(instance.settings, item?.section))
          : [];
      case "workspace/workspaceFolders":
        return [
          { uri: NodeURL.pathToFileURL(instance.cwd).href, name: path.basename(instance.cwd) },
        ];
      case "client/registerCapability":
        for (const registration of Array.isArray(params?.registrations)
          ? params.registrations
          : []) {
          if (registration?.method !== "workspace/didChangeWatchedFiles") continue;
          instance.watchers.set(String(registration.id), watchersOf(registration.registerOptions));
        }
        return null;
      case "client/unregisterCapability":
        // LSP spells it `unregisterations`.
        for (const registration of Array.isArray(params?.unregisterations)
          ? params.unregisterations
          : []) {
          instance.watchers.delete(String(registration?.id));
        }
        return null;
      case "window/showMessageRequest":
        logMessage(instance.log, "message", params);
        return null;
      case "window/workDoneProgress/create":
        return null;
      case "workspace/applyEdit":
        return new Promise((resolve) =>
          Queue.offerUnsafe(instance.serverEdits, {
            edit: params?.edit,
            done: (applied) => resolve({ applied: applied !== null }),
          }),
        );
      default:
        return undefined;
    }
  };

  const onNotificationFromServer = (instance: Instance) => (method: string, params: Json) => {
    if (method === "experimental/serverStatus") {
      instance.loading = params?.quiescent !== true;
      for (const doc of instance.docs.values()) {
        // What it answered while loading was nothing; now it can say.
        if (!instance.loading) schedulePull(instance, doc);
        for (const wake of doc.waiters) wake();
      }
      return;
    }
    if (method === "window/logMessage") return logMessage(instance.log, "log", params);
    if (method === "window/showMessage") return logMessage(instance.log, "message", params);
    if (method !== "textDocument/publishDiagnostics" || typeof params?.uri !== "string") return;
    const doc = [...instance.docs.values()].find((candidate) => candidate.uri === params.uri);
    if (doc === undefined || !Array.isArray(params.diagnostics)) return;
    const version = typeof params.version === "number" ? params.version : doc.version;
    doc.pushed = params.diagnostics;
    setDiagnostics(instance, doc, { version, diagnostics: [...doc.pulled, ...doc.pushed] });
  };

  /** Ends the process if one runs; `generation` moves on so its exit isn't taken as a crash. */
  const stopProcess = Effect.fn("LanguageServers.stopProcess")(function* (instance: Instance) {
    instance.generation += 1;
    const running = instance.running;
    const processScope = instance.processScope;
    instance.running = null;
    instance.processScope = null;
    for (const doc of instance.docs.values()) doc.openOn = null;
    clearDiagnostics(instance);
    if (running !== null) {
      yield* running.connection
        .request("shutdown", null)
        .response.pipe(Effect.timeoutOption(SHUTDOWN_TIMEOUT), Effect.ignore);
      running.connection.notify("exit");
    }
    if (processScope !== null) yield* Scope.close(processScope, Exit.void);
  });

  const failWith = (instance: Instance, message: string) =>
    setStatus(instance, { state: "failed", message, memoryBytes: null });

  /** Resolves the binary (downloading if allowed), spawns it and initializes it. */
  const startProcess: (instance: Instance) => Effect.Effect<void> = Effect.fn(
    "LanguageServers.startProcess",
  )(function* (instance: Instance) {
    const generation = ++instance.generation;
    if (Deferred.isDoneUnsafe(instance.ready)) instance.ready = Deferred.makeUnsafe();
    const trusted = yield* isTrusted(instance.cwd);
    yield* setStatus(instance, { state: "starting", message: null, restricted: !trusted });
    let resolution = yield* installer
      .resolve(instance.cwd, instance.spec, trusted)
      .pipe(
        Effect.catch((error) =>
          Effect.succeed({ type: "unavailable" as const, message: error.message }),
        ),
      );
    if (resolution.type === "trust-needed") {
      return yield* setStatus(instance, {
        state: "trust-needed",
        name: resolution.name,
        message: resolution.message,
        memoryBytes: null,
      });
    }
    if (resolution.type === "download") {
      yield* setStatus(instance, { state: "downloading", name: resolution.name, message: null });
      const downloaded = yield* installer.download(resolution.download).pipe(
        Effect.as(null),
        Effect.catch((error) => Effect.succeed(error.message)),
      );
      if (downloaded !== null) return yield* failWith(instance, downloaded);
      if (instance.generation !== generation) return;
      resolution = yield* installer
        .resolve(instance.cwd, instance.spec, trusted)
        .pipe(
          Effect.catch((error) =>
            Effect.succeed({ type: "unavailable" as const, message: error.message }),
          ),
        );
    }
    if (resolution.type === "unavailable") {
      return yield* setStatus(instance, {
        state: "missing",
        message: resolution.message,
        memoryBytes: null,
      });
    }
    if (resolution.type !== "ready") {
      return yield* failWith(instance, "The download did not install.");
    }
    const server = resolution.server;
    instance.launched = server;
    yield* setStatus(instance, { state: "starting", name: server.name, source: server.source });
    if (instance.spec.writes !== undefined) {
      yield* installer.excludeFromGit(instance.cwd, instance.spec.writes);
    }
    const processScope = yield* Scope.fork(instance.scope);
    instance.processScope = processScope;
    instance.settings = server.settings;
    instance.loading = server.reportsQuiescence;
    instance.watchers.clear();
    const connection = yield* connect(
      { executable: server.executable, args: server.args, cwd: instance.cwd, env: server.env },
      {
        onNotification: onNotificationFromServer(instance),
        onRequest: onRequestFromServer(instance),
        onStderr: instance.log.stderr,
        tracing: () => instance.log.tracing,
        onMessage: instance.log.trace,
      },
    ).pipe(Scope.provide(processScope), Effect.option);
    if (Option.isNone(connection)) {
      instance.processScope = null;
      yield* Scope.close(processScope, Exit.void);
      return yield* onCrash(instance, generation, "The language server could not be started.");
    }
    instance.log.line("environment", `Started ${server.binary} (process ${connection.value.pid}).`);
    // From here a failure ends the process, and its exit is what counts as the crash.
    yield* connection.value.exited.pipe(
      Effect.tap((code) =>
        Effect.sync(() => {
          instance.log.endStderr();
          instance.log.line("environment", `The process exited with code ${code}.`);
        }),
      ),
      Effect.flatMap(() => onExit(instance, generation, connection.value)),
      Effect.forkIn(serviceScope, { startImmediately: true }),
    );
    const rootUri = NodeURL.pathToFileURL(instance.cwd).href;
    const init = yield* connection.value
      .request("initialize", {
        processId: process.pid,
        clientInfo: { name: "Astrolabe" },
        rootUri,
        rootPath: instance.cwd,
        workspaceFolders: [{ uri: rootUri, name: path.basename(instance.cwd) }],
        capabilities: server.reportsQuiescence ? QUIESCENCE_CAPABILITIES : CLIENT_CAPABILITIES,
        initializationOptions: server.initializationOptions,
      })
      .response.pipe(Effect.timeoutOption(options.initializeTimeout), Effect.option);
    if (instance.generation !== generation) return;
    if (Option.isNone(init) || Option.isNone(init.value)) {
      return yield* Scope.close(processScope, Exit.void);
    }
    connection.value.notify("initialized", {});
    const answer = init.value.value as Json;
    const capabilities = answer?.capabilities ?? {};
    const version = answer?.serverInfo?.version;
    const running: Running = {
      generation,
      connection: connection.value,
      capabilities,
      pull: capabilities?.diagnosticProvider != null,
      version: typeof version === "string" ? version : null,
    };
    instance.running = running;
    for (const doc of instance.docs.values()) openOnServer(instance, doc);
    yield* setStatus(instance, { state: "ready", message: null });
    Deferred.doneUnsafe(instance.ready, Exit.succeed(running));
    yield* fork(checkMemory);
  }, Effect.provideContext(processServices));

  const onCrash = Effect.fn("LanguageServers.onCrash")(function* (
    instance: Instance,
    generation: number,
    message: string,
  ) {
    if (instance.generation !== generation) return;
    instance.generation += 1;
    instance.running = null;
    for (const doc of instance.docs.values()) doc.openOn = null;
    clearDiagnostics(instance);
    const delay = options.restartDelays[instance.crashes++];
    if (delay === undefined) return yield* failWith(instance, message);
    yield* setStatus(instance, { state: "starting", message, memoryBytes: null });
    const scheduled = instance.generation;
    yield* Effect.sleep(delay).pipe(
      Effect.andThen(
        instance.lock.withPermit(
          Effect.suspend(() =>
            instance.generation === scheduled ? startProcess(instance) : Effect.void,
          ),
        ),
      ),
      Effect.forkIn(instance.scope, { startImmediately: true }),
    );
  });

  const onExit = (instance: Instance, generation: number, connection: LspConnection) =>
    Effect.suspend(() => {
      if (instance.generation !== generation) return Effect.void;
      const tail = connection.stderrTail().trim().split("\n").slice(-5).join("\n");
      const processScope = instance.processScope;
      instance.processScope = null;
      return (processScope === null ? Effect.void : Scope.close(processScope, Exit.void)).pipe(
        Effect.andThen(
          onCrash(
            instance,
            generation,
            tail ? `The language server stopped: ${tail}` : "The language server stopped.",
          ),
        ),
      );
    });

  const isIdle = (instance: Instance) => instance.sessions.size === 0 && instance.docs.size === 0;

  const scheduleIdle = (instance: Instance) =>
    Effect.suspend(() => {
      if (!isIdle(instance)) return Effect.void;
      const generation = instance.generation;
      return Effect.sleep(options.idleTimeout).pipe(
        Effect.andThen(
          instance.lock.withPermit(
            Effect.suspend(() => {
              if (!isIdle(instance) || instance.generation !== generation) return Effect.void;
              return removeInstance(instance);
            }),
          ),
        ),
        Effect.forkIn(serviceScope, { startImmediately: true }),
        Effect.asVoid,
      );
    });

  const removeInstance = Effect.fn("LanguageServers.remove")(function* (instance: Instance) {
    yield* stopProcess(instance);
    if (instances.get(instance.key) === instance) instances.delete(instance.key);
    yield* Scope.close(instance.scope, Exit.void);
    if (instance.log.subscribers.size === 0) logs.delete(instance.key);
    instance.log.stateChanged();
    yield* publishList();
  });

  /** Over the budget, the least recently used servers stop until the rest fit; never the newest. */
  const checkMemory: Effect.Effect<void> = Effect.gen(function* () {
    const running = [...instances.values()].filter((instance) => instance.running !== null);
    if (running.length === 0) return;
    const memory = yield* readMemory(running.map((instance) => instance.running!.connection.pid));
    let total = 0;
    for (const instance of running) {
      const bytes = memory.get(instance.running?.connection.pid ?? -1) ?? null;
      total += bytes ?? 0;
      if (bytes !== instance.status.memoryBytes) yield* setStatus(instance, { memoryBytes: bytes });
    }
    const byAge = running.toSorted((a, b) => a.lastUsed - b.lastUsed);
    for (const instance of byAge.slice(0, -1)) {
      if (total <= options.memoryBudgetBytes) break;
      total -= instance.status.memoryBytes ?? 0;
      yield* instance.lock.withPermit(
        Effect.gen(function* () {
          yield* stopProcess(instance);
          yield* setStatus(instance, {
            state: "capped",
            message: "Stopped to stay within the environment's language-server memory budget.",
            memoryBytes: null,
          });
        }),
      );
    }
  });

  yield* checkMemory.pipe(
    Effect.repeat(Schedule.spaced(options.memorySampleInterval)),
    Effect.ignore,
    Effect.forkIn(serviceScope, { startImmediately: true }),
  );

  const assertProject = (cwd: string) =>
    knownWorkspaces
      .assertContains(cwd)
      .pipe(
        Effect.mapError((cause) =>
          failure("unsupported", "That folder is not a project here.", cause),
        ),
      );

  const logOf = (key: string) => {
    const known = logs.get(key);
    if (known !== undefined) return known;
    const log = makeServerLog();
    logs.set(key, log);
    return log;
  };

  const instanceOf = Effect.fn("LanguageServers.instance")(function* (
    target: LanguageServerTarget,
  ) {
    const key = `${target.cwd}\0${target.server}`;
    const existing = instances.get(key);
    if (existing !== undefined) return existing;
    const spec = options.specs[target.server];
    if (spec === undefined) {
      return yield* failure("unsupported", "That language server is not available here.");
    }
    yield* assertProject(target.cwd);
    const realCwd = yield* fileSystem
      .realPath(target.cwd)
      .pipe(Effect.orElseSucceed(() => target.cwd));
    const again = instances.get(key);
    if (again !== undefined) return again;
    const instance: Instance = {
      key,
      cwd: target.cwd,
      realCwd,
      spec,
      lock: yield* Semaphore.make(1),
      scope: yield* Scope.fork(serviceScope),
      status: {
        cwd: target.cwd,
        server: target.server,
        name: spec.name,
        state: "starting",
        source: null,
        restricted: false,
        message: null,
        memoryBytes: null,
      },
      sessions: new Map(),
      docs: new Map(),
      pulls: yield* Queue.unbounded<GatewayDoc>(),
      serverEdits: yield* Queue.unbounded<ServerEdit>(),
      collecting: null,
      watchers: new Map(),
      changes: new Map(),
      changesGeneration: 0,
      running: null,
      loading: false,
      settings: {},
      statusWatchers: new Set(),
      log: logOf(key),
      launched: null,
      ready: Deferred.makeUnsafe(),
      processScope: null,
      generation: 0,
      crashes: 0,
      lastUsed: ++clock,
    };
    instances.set(key, instance);
    yield* Queue.take(instance.pulls).pipe(
      Effect.flatMap((doc) => Effect.forkIn(pull(instance, doc), instance.scope)),
      Effect.forever,
      Effect.forkIn(instance.scope, { startImmediately: true }),
    );
    // A server applying an edit itself (while a code action's command runs) asks the environment.
    yield* Queue.take(instance.serverEdits).pipe(
      Effect.flatMap(({ edit, done }) =>
        applyWorkspaceEdit(instance, edit, serverTexts(instance)).pipe(
          Effect.match({
            onFailure: () => done(null),
            onSuccess: (applied) => {
              instance.collecting?.push(applied);
              done(applied);
            },
          }),
        ),
      ),
      Effect.forever,
      Effect.forkIn(instance.scope, { startImmediately: true }),
    );
    yield* fork(instance.lock.withPermit(startProcess(instance)), instance.scope);
    return instance;
  });

  /** Lazy start: a server that was capped comes back when a file needs it; a stopped one doesn't. */
  const use = Effect.fn("LanguageServers.use")(function* (target: LanguageServerTarget) {
    const instance = yield* instanceOf(target);
    instance.lastUsed = ++clock;
    if (instance.status.state === "capped") {
      yield* fork(
        instance.lock.withPermit(
          Effect.suspend(() =>
            instance.status.state === "capped" ? startProcess(instance) : Effect.void,
          ),
        ),
        instance.scope,
      );
    }
    return instance;
  });

  const existing = (target: LanguageServerTarget) =>
    Effect.suspend(() => {
      const instance = instances.get(`${target.cwd}\0${target.server}`);
      return instance === undefined
        ? Effect.fail(failure("not-running", "That language server is not running."))
        : Effect.succeed(instance);
    });

  const restart: LanguageServers["Service"]["restart"] = Effect.fn("LanguageServers.restart")(
    function* (target) {
      const instance = yield* instanceOf(target);
      instance.crashes = 0;
      instance.lastUsed = ++clock;
      yield* fork(
        instance.lock.withPermit(
          stopProcess(instance).pipe(Effect.andThen(startProcess(instance))),
        ),
        instance.scope,
      );
    },
  );

  const stop: LanguageServers["Service"]["stop"] = Effect.fn("LanguageServers.stop")(
    function* (target) {
      const instance = yield* existing(target);
      yield* instance.lock.withPermit(
        stopProcess(instance).pipe(
          Effect.andThen(
            setStatus(instance, { state: "stopped", message: null, memoryBytes: null }),
          ),
        ),
      );
    },
  );

  const check: LanguageServers["Service"]["check"] = Effect.fn("LanguageServers.check")(function* (
    cwd,
  ) {
    yield* assertProject(cwd);
    const trusted = yield* isTrusted(cwd);
    const specs = Object.values(options.specs).filter((spec) => spec !== undefined);
    const servers = yield* Effect.forEach(
      specs,
      Effect.fnUntraced(function* (spec): Effect.fn.Return<
        LanguageServerCheck,
        never,
        FileSystem.FileSystem | Path.Path
      > {
        const resolution = yield* installer
          .resolve(cwd, spec, trusted)
          .pipe(
            Effect.catch((error) =>
              Effect.succeed({ type: "unavailable" as const, message: error.message }),
            ),
          );
        const hinted = spec.hint;
        const hint =
          hinted === undefined ||
          (yield* Effect.forEach(hinted.unless, (file) =>
            fileSystem.exists(path.join(cwd, file)).pipe(Effect.orElseSucceed(() => false)),
          )).some(Boolean)
            ? null
            : hinted.message;
        const base = { server: spec.id, languages: spec.languages };
        switch (resolution.type) {
          case "ready":
            return {
              ...base,
              name: resolution.server.name,
              state: "found",
              source: resolution.server.source,
              executable: resolution.server.binary,
              message: hint,
            };
          case "download":
            return {
              ...base,
              name: resolution.name,
              state: "download",
              source: null,
              executable: null,
              message: [describeDownload(resolution.download), hint].filter(Boolean).join(" "),
            };
          case "trust-needed":
            return {
              ...base,
              name: resolution.name,
              state: "trust",
              source: null,
              executable: null,
              message: [resolution.message, hint].filter(Boolean).join(" "),
            };
          case "unavailable":
            return {
              ...base,
              name: spec.name,
              state: "missing",
              source: null,
              executable: null,
              message: resolution.message,
            };
        }
      }),
      { concurrency: "unbounded" },
    );
    return { trusted, servers };
  }, Effect.provideContext(processServices));

  const changeTrust = Effect.fn("LanguageServers.changeTrust")(function* (
    cwd: string,
    trusted: boolean,
  ) {
    yield* assertProject(cwd);
    yield* trust
      .set(cwd, trusted)
      .pipe(Effect.mapError((cause) => failure("failed", "Could not record the trust.", cause)));
    const project = yield* trust.keyOf(cwd);
    for (const instance of instances.values()) {
      if ((yield* trust.keyOf(instance.cwd)) !== project) continue;
      const { state, restricted } = instance.status;
      // A stopped or capped one takes the new trust when it next starts.
      if (state === "stopped" || state === "capped") continue;
      if (state === "ready" && restricted === !trusted) continue;
      instance.crashes = 0;
      yield* fork(
        instance.lock.withPermit(
          stopProcess(instance).pipe(Effect.andThen(startProcess(instance))),
        ),
        instance.scope,
      );
    }
  }, Effect.provideContext(processServices));

  const trustProject: LanguageServers["Service"]["trustProject"] = (cwd) => changeTrust(cwd, true);
  const revokeProjectTrust: LanguageServers["Service"]["revokeProjectTrust"] = (cwd) =>
    changeTrust(cwd, false);

  const infoOf = (key: string): LanguageServerInfo | null => {
    const instance = instances.get(key);
    if (instance === undefined) return null;
    const running = instance.running;
    return {
      ...instance.status,
      binary: instance.launched?.binary ?? null,
      args: instance.launched?.args ?? [],
      version: running?.version ?? null,
      pid: running?.connection.pid ?? null,
      capabilities: running === null ? null : JSON.stringify(running.capabilities, null, 2),
    };
  };

  /** A batch of log events as one item, each kind in order. */
  const logBatch = (key: string, log: ServerLog, events: ReadonlyArray<LogEvent>) => ({
    type: "batch" as const,
    ...(events.some((event) => event.type === "state")
      ? { state: { info: infoOf(key), tracing: log.tracing } }
      : {}),
    lines: events.flatMap((event) => (event.type === "line" ? [event.line] : [])),
    trace: events.flatMap((event) => (event.type === "trace" ? [event.entry] : [])),
  });

  const logsOf: LanguageServers["Service"]["logs"] = (target) =>
    Stream.unwrap(
      Effect.gen(function* () {
        if (options.specs[target.server] === undefined) {
          return yield* failure("unsupported", "That language server is not available here.");
        }
        yield* assertProject(target.cwd);
        const key = `${target.cwd}\0${target.server}`;
        const log = logOf(key);
        const events = yield* Queue.sliding<LogEvent>(LOG_EVENTS_QUEUED);
        const subscriber: LogSubscriber = {
          offer: (event) => void Queue.offerUnsafe(events, event),
        };
        log.subscribers.add(subscriber);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            log.subscribers.delete(subscriber);
            if (log.subscribers.size > 0) return;
            log.onLastSubscriberGone();
            if (!instances.has(key) && logs.get(key) === log) logs.delete(key);
          }),
        );
        const snapshot: LanguageServerLogItem = {
          type: "snapshot",
          state: { info: infoOf(key), tracing: log.tracing },
          lines: log.lines(),
          trace: log.entries(),
        };
        return Stream.concat(
          Stream.succeed(snapshot),
          Stream.fromQueue(events).pipe(
            Stream.groupedWithin(LOG_BATCH_SIZE, LOG_BATCH_WINDOW),
            Stream.map((batch) => logBatch(key, log, batch)),
          ),
        );
      }),
    );

  const setTrace: LanguageServers["Service"]["setTrace"] = Effect.fn("LanguageServers.setTrace")(
    function* (input) {
      const log = logs.get(`${input.cwd}\0${input.server}`);
      // Only for someone reading: a trace nobody watches would hold file contents for nothing.
      if (log === undefined || log.subscribers.size === 0) {
        return yield* failure("not-running", "Open that language server's logs first.");
      }
      log.setTracing(input.enabled);
    },
  );

  const relativePathOf = (instance: Instance, uri: unknown): string | null => {
    if (typeof uri !== "string" || !uri.startsWith("file:")) return null;
    let absolute: string;
    try {
      absolute = NodeURL.fileURLToPath(uri);
    } catch {
      return null;
    }
    for (const root of [instance.cwd, instance.realCwd]) {
      const relative = path.relative(root, absolute);
      if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) continue;
      return relative.split(path.sep).join("/");
    }
    return null;
  };

  /** Replaces the server's uris for this session's documents with the session's own. */
  const toSessionUris = (instance: Instance, session: Session, value: Json): Json => {
    const uris = new Map<string, string>();
    for (const [relativePath, uri] of session.open) {
      const doc = instance.docs.get(relativePath);
      if (doc !== undefined && doc.uri !== uri) uris.set(doc.uri, uri);
    }
    if (uris.size === 0) return value;
    const walk = (node: Json): Json => {
      if (typeof node === "string") return uris.get(node) ?? node;
      if (Array.isArray(node)) return node.map(walk);
      if (typeof node === "object" && node !== null) {
        return Object.fromEntries(
          Object.entries(node).map(([key, item]) => [uris.get(key) ?? key, walk(item)]),
        );
      }
      return node;
    };
    return walk(value);
  };

  /** Each file's text as the server has it: an open document's, else the file on disk. */
  const textsOf = Effect.fn("LanguageServers.textsOf")(function* (
    instance: Instance,
    uris: Iterable<string>,
  ) {
    const texts = new Map<string, Text | null>();
    for (const uri of uris) {
      if (texts.has(uri)) continue;
      const relativePath = relativePathOf(instance, uri);
      const doc = relativePath === null ? undefined : instance.docs.get(relativePath);
      const open = doc?.texts.get(doc.version);
      if (open !== undefined) {
        texts.set(uri, open);
        continue;
      }
      const read = yield* Effect.try(() => NodeURL.fileURLToPath(uri)).pipe(
        Effect.flatMap((file) => fileSystem.readFileString(file)),
        Effect.map((text) => Text.of(text.split(/\r\n?|\n/))),
        Effect.orElseSucceed(() => null),
      );
      texts.set(uri, read);
    }
    return texts;
  });

  const previewOf = (text: Text | null | undefined, line: number) =>
    text && line >= 0 && line < text.lines
      ? text
          .line(line + 1)
          .text.trim()
          .slice(0, PREVIEW_LENGTH)
      : "";

  const describeLocations = Effect.fn("LanguageServers.describeLocations")(function* (
    instance: Instance,
    locations: ReadonlyArray<{ readonly uri: string; readonly range: Json }>,
  ) {
    const texts = yield* textsOf(
      instance,
      locations.map((location) => location.uri),
    );
    return locations.map(({ uri, range }): CodeLocation => {
      const relativePath = relativePathOf(instance, uri);
      let shown = relativePath;
      if (shown === null) {
        try {
          shown = NodeURL.fileURLToPath(uri);
        } catch {
          shown = uri;
        }
      }
      return {
        path: shown,
        line: (range.start?.line ?? 0) + 1,
        column: (range.start?.character ?? 0) + 1,
        endLine: (range.end?.line ?? 0) + 1,
        endColumn: (range.end?.character ?? 0) + 1,
        preview: previewOf(texts.get(uri), range.start?.line ?? 0),
      };
    });
  });

  /**
   * A location answer for an editor, with each place's line of text (`astrolabe/preview`) for
   * files other than `own`, which the editor has.
   */
  const withPreviews = Effect.fn("LanguageServers.withPreviews")(function* (
    instance: Instance,
    result: Json,
    own: string | undefined,
  ) {
    const all = Array.isArray(result) ? result : result == null ? [] : [result];
    const others = all.filter((location: Json) => (location?.targetUri ?? location?.uri) !== own);
    if (others.length === 0) return result;
    const texts = yield* textsOf(
      instance,
      others.map((location: Json) => location.targetUri ?? location.uri),
    );
    for (const location of others) {
      const range = location.targetSelectionRange ?? location.targetRange ?? location.range;
      location["astrolabe/preview"] = previewOf(
        texts.get(location.targetUri ?? location.uri),
        range?.start?.line ?? -1,
      );
    }
    return result;
  });

  /** Every open document's text as the server has it now, before a request that may edit them. */
  const serverTexts = (instance: Instance) => {
    const texts = new Map<string, ServerText>();
    for (const doc of instance.docs.values()) {
      const text = doc.texts.get(doc.version);
      if (doc.loadId !== null && text !== undefined) {
        texts.set(doc.relativePath, { loadId: doc.loadId, version: doc.version, text });
      }
    }
    return texts;
  };

  /**
   * Lands `edits` (in the server's coordinates) on one file's document under `clientId`, and saves.
   * Returns the update it became, read back from the document, so its inverse is exact.
   */
  const applyToFile = Effect.fn("LanguageServers.applyToFile")(function* (
    cwd: string,
    relativePath: string,
    edits: ReadonlyArray<Json>,
    seen: ServerText | undefined,
    clientId: string,
  ) {
    const items = yield* Queue.unbounded<DocumentStreamItem, Cause.Done | DocumentError>();
    yield* documents
      .subscribe({ cwd, relativePath })
      .pipe(Stream.runIntoQueue(items), Effect.forkScoped);
    const first = yield* Queue.take(items);
    if (first.type !== "snapshot") return null;
    let text = Text.of(first.text.split("\n"));
    let version = first.version;
    const base: ServerText =
      seen !== undefined && seen.loadId === first.loadId
        ? seen
        : { loadId: first.loadId, version, text };
    const changes = changeSetOf(base.text, edits);
    if (changes.empty) return null;
    yield* documents.push({
      cwd,
      relativePath,
      loadId: first.loadId,
      version: base.version,
      updates: [{ clientId, changes: changes.toJSON() }],
    });
    for (;;) {
      const item = yield* Queue.take(items);
      if (item.type !== "updates") continue;
      for (const [index, update] of item.updates.entries()) {
        if (item.version + index < version) continue;
        const accepted = ChangeSet.fromJSON(update.changes);
        const before = text;
        text = accepted.apply(text);
        version += 1;
        if (update.clientId !== clientId) continue;
        yield* documents.save({ cwd, relativePath, loadId: first.loadId });
        return {
          relativePath,
          loadId: first.loadId,
          version,
          inverse: accepted.invert(before),
          after: text.toString(),
          edits: edits.length,
        };
      }
    }
  });

  /**
   * Applies a language server's `WorkspaceEdit` to the files it names, open or not, through their
   * documents, and keeps each file's inverse to undo it as one. `seen` holds the texts its
   * positions are in for documents the server had open.
   */
  const applyWorkspaceEdit = Effect.fn("LanguageServers.applyWorkspaceEdit")(function* (
    instance: Instance,
    edit: Json,
    seen: ReadonlyMap<string, ServerText>,
  ) {
    const byFile = editsByFile(edit);
    if (byFile === null) {
      return yield* failure("unsupported", "The edit also creates, renames or deletes files.");
    }
    const id = `edit-${++editCount}-${(yield* Clock.currentTimeMillis).toString(36)}`;
    const files: AppliedFile[] = [];
    let count = 0;
    for (const [uri, edits] of byFile) {
      const relativePath = relativePathOf(instance, uri);
      if (relativePath === null) continue;
      const done = yield* applyToFile(
        instance.cwd,
        relativePath,
        edits,
        seen.get(relativePath),
        `lsp:${id}`,
      ).pipe(
        Effect.scoped,
        Effect.mapError((cause) =>
          failure("document", `'${relativePath}' could not be edited.`, cause),
        ),
      );
      if (done === null) continue;
      files.push(done);
      count += done.edits;
    }
    applied.set(id, { cwd: instance.cwd, files });
    for (const key of [...applied.keys()].slice(0, -EDITS_KEPT)) applied.delete(key);
    return {
      id,
      files: files.map((file) => file.relativePath),
      edits: count,
    } satisfies LanguageServerAppliedEdit;
  });

  const undoFile = Effect.fn("LanguageServers.undoFile")(function* (
    cwd: string,
    file: AppliedFile,
    clientId: string,
  ) {
    const items = yield* Queue.unbounded<DocumentStreamItem, Cause.Done | DocumentError>();
    yield* documents
      .subscribe({
        cwd,
        relativePath: file.relativePath,
        resume: { loadId: file.loadId, version: file.version },
      })
      .pipe(Stream.runIntoQueue(items), Effect.forkScoped);
    const first = yield* Queue.take(items);
    // Still loaded: the inverse is rebased over whatever landed since. Reloaded: only a file
    // nobody changed since takes it.
    const at =
      first.type === "resumed"
        ? { loadId: file.loadId, version: file.version }
        : first.type === "snapshot" && first.text === file.after
          ? { loadId: first.loadId, version: first.version }
          : null;
    if (at === null) return false;
    yield* documents.push({
      cwd,
      relativePath: file.relativePath,
      ...at,
      updates: [{ clientId, changes: file.inverse.toJSON() }],
    });
    yield* documents.save({ cwd, relativePath: file.relativePath, loadId: at.loadId });
    return true;
  });

  const undoEdit: LanguageServers["Service"]["undoEdit"] = Effect.fn("LanguageServers.undoEdit")(
    function* (input) {
      const edit = applied.get(input.id);
      if (edit === undefined) {
        return yield* failure("document", "That edit can no longer be undone.");
      }
      applied.delete(input.id);
      const files: string[] = [];
      const skipped: string[] = [];
      for (const file of edit.files) {
        const undone = yield* undoFile(edit.cwd, file, `lsp-undo:${input.id}`).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => false),
        );
        (undone ? files : skipped).push(file.relativePath);
      }
      return { files, skipped };
    },
  );

  /** Several applied edits as one, undone together. */
  const mergeApplied = (edits: ReadonlyArray<LanguageServerAppliedEdit>) => {
    if (edits.length <= 1) return edits[0] ?? null;
    const files = edits.flatMap((edit) => applied.get(edit.id)?.files ?? []);
    const first = edits[0]!;
    applied.set(first.id, { cwd: applied.get(first.id)?.cwd ?? "", files });
    for (const edit of edits.slice(1)) applied.delete(edit.id);
    return {
      id: first.id,
      files: [...new Set(edits.flatMap((edit) => edit.files))],
      edits: edits.reduce((sum, edit) => sum + edit.edits, 0),
    };
  };

  /**
   * Applies one of the code actions last offered to the session: its edit through the
   * environment, as a rename's, then its command, whose own edits the server sends back here.
   */
  const applyCodeAction = Effect.fn("LanguageServers.applyCodeAction")(function* (
    instance: Instance,
    session: Session,
    index: unknown,
  ) {
    const running = yield* Deferred.await(instance.ready);
    const offered = session.codeActions;
    const chosen = typeof index === "number" ? offered?.actions[index] : undefined;
    if (offered === null || chosen === undefined) {
      return { error: contentModified("The code actions changed; ask for them again.") };
    }
    session.codeActions = null;
    let action: Json = chosen;
    const isCommand = typeof action.command === "string";
    if (
      !isCommand &&
      action.edit === undefined &&
      running.capabilities?.codeActionProvider?.resolveProvider
    ) {
      action = yield* running.connection
        .request("codeAction/resolve", action)
        .response.pipe(Effect.orElseSucceed(() => chosen));
    }
    const done: Array<LanguageServerAppliedEdit> = [];
    if (action.edit) {
      const edit = yield* applyWorkspaceEdit(instance, action.edit, offered.seen).pipe(
        Effect.option,
      );
      if (Option.isNone(edit))
        return { error: { code: -32603, message: "The edit could not be applied." } };
      done.push(edit.value);
    }
    const command = isCommand ? action : action.command;
    if (typeof command?.command === "string") {
      instance.collecting = done;
      yield* running.connection
        .request("workspace/executeCommand", {
          command: command.command,
          ...(command.arguments === undefined ? {} : { arguments: command.arguments }),
        })
        .response.pipe(
          Effect.ignore,
          Effect.ensuring(Effect.sync(() => (instance.collecting = null))),
        );
    }
    return { result: { applied: mergeApplied(done) } };
  });

  const onSessionNotification = Effect.fn("LanguageServers.sessionNotification")(function* (
    instance: Instance,
    session: Session,
    message: Json,
  ) {
    const uri = message.params?.textDocument?.uri;
    switch (message.method) {
      case "textDocument/didOpen": {
        const relativePath = relativePathOf(instance, uri);
        if (relativePath === null || session.open.has(relativePath)) return;
        const languageId =
          languageServerForPath(relativePath)?.languageId ?? message.params.textDocument.languageId;
        session.open.set(relativePath, uri);
        const doc = yield* holdDoc(instance, relativePath, String(languageId));
        if (doc.latest !== null) fanOutDiagnostics(instance, doc);
        return;
      }
      case "textDocument/didClose": {
        const relativePath = relativePathOf(instance, uri);
        if (relativePath === null || !session.open.has(relativePath)) return;
        session.open.delete(relativePath);
        const doc = instance.docs.get(relativePath);
        if (doc !== undefined) yield* releaseDoc(instance, doc);
        return;
      }
      case "$/cancelRequest": {
        const id = message.params?.id;
        const pending = session.pending.get(id);
        if (pending === undefined) return;
        if (pending.serverId !== null) {
          instance.running?.connection.cancel(pending.serverId);
          return;
        }
        session.pending.delete(id);
        if (pending.fiber !== null) yield* Fiber.interrupt(pending.fiber);
        sendTo(session, { id, error: { code: RequestCancelled, message: "Cancelled" } });
        return;
      }
      // didChange is never needed: the server has the environment's documents. The rest are
      // the client's lifecycle, which the gateway already ran with the server.
      default:
        return;
    }
  });

  const forward = Effect.fn("LanguageServers.forward")(function* (
    instance: Instance,
    session: Session,
    message: Json,
    state: LanguageServerSendInput["document"],
    pending: PendingForward,
  ) {
    const running = yield* Deferred.await(instance.ready);
    const method: string = message.method;
    const clientUri = message.params?.textDocument?.uri;
    const relativePath =
      method === "completionItem/resolve"
        ? session.completionPath
        : relativePathOf(instance, clientUri);
    const doc = relativePath === null ? undefined : instance.docs.get(relativePath);
    if (doc !== undefined && state !== undefined) {
      // A file just opened: its text may still be on its way from Documents.
      yield* until(doc, () => doc.loadId !== null || instance.docs.get(doc.relativePath) !== doc);
      if (state.loadId !== doc.loadId)
        return { error: contentModified("The document was reloaded.") };
      if (state.unconfirmed.length > 0) {
        // Landing the editor's unsent edits first means the document and LSP streams need no
        // ordering: collab drops the ones it already took.
        const pushed = yield* documents
          .push({
            cwd: instance.cwd,
            relativePath: doc.relativePath,
            loadId: state.loadId,
            version: state.version,
            updates: state.unconfirmed.map((changes) => ({ clientId: state.clientId, changes })),
          })
          .pipe(Effect.option);
        if (Option.isNone(pushed)) return { error: contentModified("The edits did not fit.") };
        yield* until(doc, () => doc.version >= pushed.value.version || doc.loadId !== state.loadId);
      }
    }
    // From here to the write, nothing yields: the server must get the request at the version
    // the positions were mapped to.
    const translated = translateRequest(doc, state, message.params);
    if ("error" in translated) return translated;
    if (instance.running !== running) return { error: contentModified("The server restarted.") };
    const position = translated.params?.position;
    const query =
      method === "textDocument/completion" && doc !== undefined && position
        ? wordBefore(doc.texts.get(doc.version)!, position)
        : "";
    if (method === "textDocument/completion") session.completionPath = relativePath;
    // A rename is applied here, at the texts the server answers about.
    const seen =
      method === "textDocument/rename" || method === "textDocument/codeAction"
        ? serverTexts(instance)
        : null;
    const request = running.connection.request(method, translated.params);
    pending.serverId = request.id;
    const answer = yield* request.response.pipe(
      Effect.map((result) => ({ ok: true as const, result: result as Json })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
    );
    if (!answer.ok) return { error: errorMessage(answer.error) };
    if (seen !== null && method === "textDocument/codeAction") {
      // The editor gets titles; the actions stay here, in the server's coordinates, to apply.
      const actions: Array<Json> = Array.isArray(answer.result) ? answer.result : [];
      session.codeActions = { actions, seen };
      return {
        result: actions.map((action, index) => ({
          index,
          title: String(action?.title ?? ""),
          ...(typeof action?.kind === "string" ? { kind: action.kind } : {}),
          ...(action?.isPreferred === true ? { isPreferred: true } : {}),
          ...(action?.disabled?.reason ? { disabled: String(action.disabled.reason) } : {}),
        })),
      };
    }
    if (seen !== null) {
      if (answer.result == null) return { result: null };
      const done = yield* applyWorkspaceEdit(instance, answer.result, seen).pipe(
        Effect.map((edit) => ({ result: { applied: edit } })),
        Effect.catch((error) =>
          Effect.succeed({ error: { code: -32603, message: error.message } }),
        ),
      );
      return done;
    }
    const mapped = mapAnswer(method, answer.result, doc, translated.context, query);
    if ("error" in mapped) return mapped;
    if (method === "textDocument/completion") return { result: mapped.result };
    const result = toSessionUris(instance, session, mapped.result);
    if (!LOCATION_METHODS.has(method)) return { result };
    return { result: yield* withPreviews(instance, result, clientUri) };
  });

  const browserCapabilities = (capabilities: Json) => {
    const { diagnosticProvider: _pulledHere, ...rest } = capabilities ?? {};
    // Editors send no document changes: the server has the environment's copy.
    return { ...rest, textDocumentSync: { openClose: true, change: 0 } };
  };

  /** The client's own lifecycle requests are the gateway's to answer; the rest go to the server. */
  const answer = Effect.fn("LanguageServers.answer")(function* (
    instance: Instance,
    session: Session,
    message: Json,
    state: LanguageServerSendInput["document"],
    pending: PendingForward,
  ) {
    if (message.method === "shutdown") return { result: null };
    if (message.method === "astrolabe/applyCodeAction") {
      return yield* applyCodeAction(instance, session, message.params?.index);
    }
    if (message.method !== "initialize") {
      return yield* forward(instance, session, message, state, pending);
    }
    const running = yield* Deferred.await(instance.ready);
    return {
      result: {
        capabilities: browserCapabilities(running.capabilities),
        serverInfo: { name: instance.status.name },
      },
    };
  });

  const onSessionRequest = Effect.fn("LanguageServers.sessionRequest")(function* (
    instance: Instance,
    session: Session,
    message: Json,
    state: LanguageServerSendInput["document"],
  ) {
    const id = message.id;
    const pending: PendingForward = { serverId: null, fiber: null };
    session.pending.set(id, pending);
    const fiber = yield* answer(instance, session, message, state, pending).pipe(
      Effect.flatMap((reply) =>
        Effect.sync(() => {
          if (session.pending.get(id) !== pending) return;
          session.pending.delete(id);
          sendTo(session, { id, ...reply });
        }),
      ),
      Effect.catchDefect(() =>
        Effect.sync(() => {
          session.pending.delete(id);
          sendTo(session, { id, error: { code: -32603, message: "The gateway failed." } });
        }),
      ),
      Effect.forkIn(session.scope, { startImmediately: true }),
    );
    pending.fiber = fiber;
  });

  const session: LanguageServers["Service"]["session"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        if (sessions.has(input.sessionId)) {
          return yield* failure("no-session", "That session is already open.");
        }
        const instance = yield* use(input);
        const queue = yield* Queue.unbounded<LanguageServerSessionItem>();
        const opened: Session = {
          id: input.sessionId,
          queue,
          open: new Map(),
          pending: new Map(),
          scope: yield* Scope.fork(instance.scope),
          completionPath: null,
          codeActions: null,
        };
        instance.sessions.set(opened.id, opened);
        sessions.set(opened.id, { instance, session: opened });
        Queue.offerUnsafe(queue, { type: "status", status: instance.status });
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            sessions.delete(opened.id);
            instance.sessions.delete(opened.id);
            yield* Scope.close(opened.scope, Exit.void);
            for (const relativePath of opened.open.keys()) {
              const doc = instance.docs.get(relativePath);
              if (doc !== undefined) yield* releaseDoc(instance, doc);
            }
            opened.open.clear();
            yield* scheduleIdle(instance);
          }),
        );
        return Stream.fromQueue(queue);
      }),
    );

  const send: LanguageServers["Service"]["send"] = Effect.fn("LanguageServers.send")(
    function* (input) {
      const entry = sessions.get(input.sessionId);
      if (entry === undefined) return yield* failure("no-session", "That session is not open.");
      const message: Json = parseJson(input.message);
      if (typeof message !== "object" || message === null || typeof message.method !== "string") {
        return;
      }
      entry.instance.lastUsed = ++clock;
      if (message.id === undefined || message.id === null) {
        return yield* onSessionNotification(entry.instance, entry.session, message);
      }
      yield* onSessionRequest(entry.instance, entry.session, message, input.document);
    },
  );

  /** Why an agent can't have this server, or null while it runs or is on its way. */
  const whyUnusable = (status: LanguageServerStatus) => {
    switch (status.state) {
      case "stopped":
        return failure("not-running", "The language server was stopped; restart it in Astrolabe.");
      case "trust-needed":
        return failure(
          "trust-needed",
          "The language server needs the user to trust this project in Astrolabe.",
        );
      case "failed":
      case "missing":
        return failure("failed", status.message ?? "The language server failed.");
      default:
        return null;
    }
  };

  const assertUsable = (instance: Instance) =>
    Effect.suspend(() => {
      const why = whyUnusable(instance.status);
      return why === null ? Effect.void : Effect.fail(why);
    });

  /** The running server for an agent, failing as soon as a start ends without one. */
  const readyForAgent = (instance: Instance) =>
    Effect.raceFirst(
      Deferred.await(instance.ready),
      Effect.callback<never, LanguageServerError>((resume) => {
        const watch = () => {
          const why = whyUnusable(instance.status);
          if (why !== null) resume(Effect.fail(why));
        };
        instance.statusWatchers.add(watch);
        watch();
        return Effect.sync(() => instance.statusWatchers.delete(watch));
      }),
    );

  const diagnostics: LanguageServers["Service"]["diagnostics"] = Effect.fn(
    "LanguageServers.diagnostics",
  )(function* (input) {
    const match = languageServerForPath(input.relativePath);
    if (match === null) {
      return yield* failure("unsupported", "No language server reads this kind of file.");
    }
    const instance = yield* use({ cwd: input.cwd, server: match.server });
    yield* assertUsable(instance);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const doc = yield* Effect.acquireRelease(
          holdDoc(instance, input.relativePath, match.languageId),
          (held) => releaseDoc(instance, held),
        );
        yield* until(doc, () => doc.loadId !== null || !instance.docs.has(input.relativePath));
        if (doc.loadId === null) {
          return yield* failure("document", `'${input.relativePath}' could not be opened.`);
        }
        const synced = yield* documents
          .sync({ cwd: instance.cwd, relativePath: input.relativePath })
          .pipe(Effect.mapError((cause) => failure("document", cause.message, cause)));
        yield* readyForAgent(instance);
        yield* until(
          doc,
          () =>
            doc.loadId !== synced.loadId ||
            (!instance.loading &&
              !doc.pulling &&
              doc.version >= synced.version &&
              doc.latest !== null &&
              doc.latest.version >= synced.version),
        );
        for (let seen = -1; seen !== doc.published;) {
          seen = doc.published;
          yield* Effect.sleep(options.diagnosticsQuiet);
        }
        return listedDiagnostics(doc);
      }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: options.diagnosticsTimeout,
        orElse: () =>
          Effect.fail(
            failure(
              "timeout",
              "The language server is still loading the project. Try again shortly.",
            ),
          ),
      }),
    );
  });

  const locate: LanguageServers["Service"]["locate"] = Effect.fn("LanguageServers.locate")(
    function* (input) {
      const match = languageServerForPath(input.relativePath);
      if (match === null) {
        return yield* failure("unsupported", "No language server reads this kind of file.");
      }
      const instance = yield* use({ cwd: input.cwd, server: match.server });
      yield* assertUsable(instance);
      const { method, capability } = LOCATE_METHODS[input.kind];
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const doc = yield* Effect.acquireRelease(
            holdDoc(instance, input.relativePath, match.languageId),
            (held) => releaseDoc(instance, held),
          );
          yield* until(doc, () => doc.loadId !== null || !instance.docs.has(input.relativePath));
          if (doc.loadId === null) {
            return yield* failure("document", `'${input.relativePath}' could not be opened.`);
          }
          const synced = yield* documents
            .sync({ cwd: instance.cwd, relativePath: input.relativePath })
            .pipe(Effect.mapError((cause) => failure("document", cause.message, cause)));
          const running = yield* readyForAgent(instance);
          if (!running.capabilities?.[capability]) {
            return yield* failure(
              "unsupported",
              `The language server cannot find ${input.kind} here.`,
            );
          }
          yield* until(
            doc,
            () =>
              doc.loadId !== synced.loadId ||
              (doc.version >= synced.version && doc.openOn !== null),
          );
          const text = doc.texts.get(doc.version)!;
          if (input.line > text.lines) {
            return yield* failure(
              "document",
              `'${input.relativePath}' has ${text.lines} lines, not ${input.line}.`,
            );
          }
          const lineText = text.line(input.line).text;
          const character =
            input.column !== undefined
              ? input.column - 1
              : input.symbol !== undefined
                ? lineText.indexOf(input.symbol)
                : 0;
          if (character < 0) {
            return yield* failure(
              "document",
              `'${input.symbol}' is not on line ${input.line} of '${input.relativePath}'.`,
            );
          }
          if (instance.running !== running) {
            return yield* failure("failed", "The language server restarted; try again.");
          }
          const { response } = running.connection.request(method, {
            textDocument: { uri: doc.uri },
            position: { line: input.line - 1, character },
            ...(input.kind === "references" ? { context: { includeDeclaration: true } } : {}),
          });
          const answer = yield* response.pipe(
            Effect.mapError((error) => failure("failed", error.message, error)),
          );
          const all = locationsOf(answer);
          const listed = all.slice(0, LOCATIONS_LISTED);
          return {
            locations: yield* describeLocations(instance, listed),
            truncated: all.length > listed.length,
          };
        }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: options.diagnosticsTimeout,
          orElse: () =>
            Effect.fail(
              failure(
                "timeout",
                "The language server is still loading the project. Try again shortly.",
              ),
            ),
        }),
      );
    },
  );

  /** Tells the server of the waiting changes it watches, except to files it has open here. */
  const flushChanges = (instance: Instance) => {
    const running = instance.running;
    const changes = [...instance.changes];
    instance.changes.clear();
    if (running === null) return;
    const watchers = [...instance.watchers.values()].flat();
    // Some servers check only saved files (rust-analyzer's `cargo check`).
    const save = running.capabilities?.textDocumentSync?.save;
    const events = changes.flatMap(([relativePath, type]) => {
      const doc = instance.docs.get(relativePath);
      if (doc?.openOn === running.generation) {
        if (save && type !== "deleted") {
          running.connection.notify("textDocument/didSave", { textDocument: { uri: doc.uri } });
        }
        return [];
      }
      const absolute = [instance.cwd, instance.realCwd].map((root) =>
        path.join(root, relativePath),
      );
      if (!watched(watchers, absolute, type)) return [];
      return [{ uri: NodeURL.pathToFileURL(absolute[0]!).href, type: FILE_CHANGE_TYPES[type] }];
    });
    if (events.length > 0) {
      running.connection.notify("workspace/didChangeWatchedFiles", { changes: events });
    }
  };

  const filesChanged: LanguageServers["Service"]["filesChanged"] = (input) =>
    Effect.suspend(() => {
      const watching = [...instances.values()].filter((instance) => instance.cwd === input.cwd);
      return Effect.forEach(
        watching,
        (instance) => {
          for (const { relativePath, type } of input.changes) {
            const merged = mergeChange(instance.changes.get(relativePath), type);
            if (merged === null) instance.changes.delete(relativePath);
            else instance.changes.set(relativePath, merged);
          }
          const generation = ++instance.changesGeneration;
          return Effect.sleep(options.fileChangeQuiet).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (generation === instance.changesGeneration) flushChanges(instance);
              }),
            ),
            Effect.forkIn(instance.scope, { startImmediately: true }),
          );
        },
        { discard: true },
      );
    });

  // A file saved here is one the server reads from disk, unless it has it open.
  yield* documents.writes.pipe(
    Stream.runForEach((write) =>
      filesChanged({
        cwd: write.cwd,
        changes: [
          { relativePath: write.relativePath, type: write.created ? "created" : "changed" },
        ],
      }),
    ),
    Effect.forkIn(serviceScope, { startImmediately: true }),
  );

  /** The file's formatting edits at the document's version, landed under `clientId`. */
  const formatForSave = Effect.fn("LanguageServers.formatForSave")(function* (
    input: DocumentSaveInput & { readonly format: NonNullable<DocumentSaveInput["format"]> },
  ) {
    const match = languageServerForPath(input.relativePath);
    if (match === null) return;
    const instance = instances.get(`${input.cwd}\0${match.server}`);
    const doc = instance?.docs.get(input.relativePath);
    const running = instance?.running;
    // Only a file an editor holds open here has a running server and the text it formats.
    if (
      !instance ||
      !doc ||
      !running ||
      doc.loadId !== input.loadId ||
      doc.openOn !== running.generation
    ) {
      return;
    }
    if (!running.capabilities?.documentFormattingProvider) return;
    const version = doc.version;
    const text = doc.texts.get(version)!;
    const request = running.connection.request("textDocument/formatting", {
      textDocument: { uri: doc.uri },
      options: input.format,
    });
    const edits = yield* request.response.pipe(
      Effect.orElseSucceed(() => null),
      // Past the save's patience: the server can stop working on it.
      Effect.onInterrupt(() => Effect.sync(() => running.connection.cancel(request.id))),
    );
    if (!Array.isArray(edits) || edits.length === 0) return;
    const changes = changeSetOf(text, edits);
    if (changes.empty) return;
    yield* documents.push({
      cwd: input.cwd,
      relativePath: input.relativePath,
      loadId: input.loadId,
      version,
      updates: [{ clientId: `lsp-format:${++editCount}`, changes: changes.toJSON() }],
    });
  });

  const save: LanguageServers["Service"]["save"] = Effect.fn("LanguageServers.save")(
    function* (input) {
      const format = input.format;
      if (format !== undefined) {
        yield* formatForSave({ ...input, format }).pipe(
          Effect.timeoutOption(options.formatTimeout),
          Effect.ignore({ log: "Warn", message: "Formatting before a save failed." }),
        );
      }
      return yield* documents.save(input);
    },
  );

  const problemsOf: LanguageServers["Service"]["problems"] = (cwd) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const root = path.resolve(cwd);
        const subscription = yield* PubSub.subscribe(problemEvents);
        const files = [...problems.values()]
          .filter((entry) => entry.cwd === root)
          .map((entry) => entry.file);
        return Stream.concat(
          Stream.succeed<LanguageServerProblemsItem>({ type: "snapshot", files }),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => event.cwd === root),
            Stream.map((event): LanguageServerProblemsItem => ({ type: "file", file: event.file })),
          ),
        );
      }),
    );

  return LanguageServers.of({
    problems: problemsOf,
    save,
    filesChanged,
    locate,
    undoEdit,
    subscribe: SubscriptionRef.changes(statuses),
    check,
    restart,
    stop,
    trustProject,
    revokeProjectTrust,
    logs: logsOf,
    setTrace,
    session,
    send,
    diagnostics,
  });
});

export const defaultOptions: LanguageServersOptions = {
  specs: LANGUAGE_SERVERS,
  idleTimeout: Duration.minutes(10),
  // The spike measured 2 to 4 GB per TypeScript server on a large repository.
  memoryBudgetBytes: 8 * 1024 * 1024 * 1024,
  memorySampleInterval: Duration.seconds(30),
  restartDelays: [Duration.seconds(1), Duration.seconds(2), Duration.seconds(4)],
  initializeTimeout: Duration.minutes(1),
  diagnosticsTimeout: Duration.minutes(1),
  diagnosticsQuiet: Duration.millis(300),
  fileChangeQuiet: Duration.millis(200),
  formatTimeout: Duration.seconds(2),
  registry: DEFAULT_REGISTRY,
};

export const layerWith = (options: LanguageServersOptions) =>
  Layer.effect(LanguageServers, make(options));

export const layer = layerWith(defaultOptions);
