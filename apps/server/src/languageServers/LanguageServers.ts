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
  type LanguageServerEditPlace,
  type LanguageServerCheck,
  type LanguageServerCheckResult,
  type LanguageServerInfo,
  type LanguageServerLogItem,
  type LanguageServerSetTraceInput,
  type LanguageServerUndoEditInput,
  type LanguageServerUndoEditResult,
  isCompanionLanguageServer,
  languageServerForPath,
  languageServersForPath,
  LanguageServerError,
  type LanguageServerForPath,
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
  FORMATTING_METHODS,
  hasContent,
  hearsCompletion,
  mergeCapabilities,
  mergeCompletions,
  originOf,
  ROUTES,
  tagCompletions,
} from "./fanOut.ts";
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
 * Per checkout, a language's server and the companions that join it on a file, with the
 * environment as their only LSP client; see docs/internals/language-servers.md for how browsers
 * reach them through the gateway.
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
    /**
     * Diagnostics for a file as it is now: a write made before the call is in them. Those of a
     * companion join in when it is ready within `companionWait`.
     */
    readonly diagnostics: (input: {
      readonly cwd: string;
      readonly relativePath: string;
    }) => Effect.Effect<FileDiagnostics, LanguageServerError>;
    /**
     * The documents' save, formatting the file first when asked and a server can, by its
     * language's one formatter. A formatter slower than `formatTimeout` is skipped: the file saves
     * as it is.
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
     * now, asking its primary server: a write made before the call is in it.
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
  /**
   * Resident memory every server may use together; past it companions stop before primaries,
   * the least recently used first.
   */
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
  /**
   * How long a request asked of several servers waits for them all. After it, what has come in
   * is the answer, or the first thing to come in if nothing has.
   */
  readonly fanOutTimeout: Duration.Input;
  /** How long an agent's diagnostics wait for companions, past their primary. */
  readonly companionWait: Duration.Input;
  /**
   * How long a trace outlives its last reader. A tab behind another has no subscription, and
   * the person may have gone there to make the server do what they want to see.
   */
  readonly traceGrace: Duration.Input;
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
/** Places an applied edit lists; a huge rename's answer stays small, and says how many in all. */
const EDIT_PLACES_LISTED = 200;

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
  /** The sessions showing this document's diagnostics. */
  readonly sessions: Set<Session>;
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
  readonly places: ReadonlyArray<LanguageServerEditPlace>;
}

interface AppliedEdit {
  readonly cwd: string;
  readonly files: ReadonlyArray<AppliedFile>;
}

interface PendingForward {
  /** Cancels each server request in flight for this one. */
  readonly inFlight: Set<() => void>;
  cancelled: boolean;
  fiber: Fiber.Fiber<void> | null;
}

interface Held {
  readonly instance: Instance;
  readonly doc: GatewayDoc;
}

/** A file a session has open. */
interface OpenFile {
  /** As the client named it. */
  readonly uri: string;
  /** On the primary first, then each active companion in server order. */
  readonly held: Array<Held>;
}

/** A code action offered, as its server gave it, and the texts it is about. */
interface OfferedAction {
  readonly action: Json;
  readonly instance: Instance;
  readonly seen: ReadonlyMap<string, ServerText>;
}

interface Session {
  readonly id: string;
  /** Bound for life: the server the client connected to, whose status it follows. */
  readonly primary: Instance;
  readonly queue: Queue.Queue<LanguageServerSessionItem>;
  readonly open: Map<string, OpenFile>;
  readonly pending: Map<number | string, PendingForward>;
  readonly scope: Scope.Closeable;
  /** The last code actions offered, merged. */
  codeActions: ReadonlyArray<OfferedAction> | null;
  /** The capabilities the client was last told, as JSON; null before `initialize`. */
  advertised: string | null;
}

interface Running {
  readonly generation: number;
  readonly connection: LspConnection;
  readonly capabilities: Json;
  readonly pull: boolean;
  /** Takes each change as the whole text, having said it can't take ranges. */
  readonly fullSync: boolean;
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
  /** For a primary: whether the checkout uses each companion, as of its last Restart. */
  readonly activation: Map<LanguageServerId, boolean>;
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

type ServerAnswer =
  | { readonly ok: true; readonly result: Json }
  | { readonly ok: false; readonly error: ResponseError };

/** A request written to one server: its answer, and how to read that answer back. */
interface Asked {
  readonly instance: Instance;
  readonly doc: GatewayDoc | undefined;
  readonly context: Translation | null;
  readonly query: string;
  /** The texts an answer that edits (a rename, code actions) is about. */
  readonly seen: ReadonlyMap<string, ServerText> | null;
  readonly cancel: () => void;
  readonly response: Effect.Effect<ServerAnswer>;
}

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
    inlayHint: {},
    documentHighlight: {},
    linkedEditingRange: {},
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
    inlayHint: { refreshSupport: true },
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

/** Where `changes` left their text in `text`, the document after them. */
const editPlaces = (path: string, changes: ChangeSet, text: Text) => {
  const places: Array<LanguageServerEditPlace> = [];
  changes.iterChangedRanges((_fromA, _toA, from, to) => {
    if (places.length >= EDIT_PLACES_LISTED) return;
    const start = text.lineAt(from);
    const end = text.lineAt(to);
    places.push({
      path,
      line: start.number,
      column: from - start.from,
      endLine: end.number,
      endColumn: to - end.from,
    });
  });
  return places;
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
  const sessions = new Map<string, Session>();
  const statuses = yield* SubscriptionRef.make<ReadonlyArray<LanguageServerStatus>>([]);
  const applied = new Map<string, AppliedEdit>();
  /** Keys of logs whose last reader left within `traceGrace`: a hidden tab comes back to them. */
  const lingering = new Map<string, number>();
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
      for (const doc of instance.docs.values()) {
        for (const session of doc.sessions) advertise(session);
      }
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

  /** A document's latest diagnostics carried to `version`; as they are if it isn't there yet. */
  const diagnosticsAt = (doc: GatewayDoc, version: number): ReadonlyArray<Json> => {
    const latest = doc.latest;
    if (latest === null) return [];
    const text = doc.texts.get(latest.version);
    const target = doc.texts.get(version);
    if (latest.version === version || text === undefined || target === undefined) {
      return latest.diagnostics;
    }
    return mapDiagnostics(
      structuredClone(latest.diagnostics),
      forwardMapper(
        text,
        target,
        doc.updates
          .slice(latest.version - doc.oldest, version - doc.oldest)
          .reduce((all, update) => all.compose(update.changes), ChangeSet.empty(text.length)),
      ),
    );
  };

  const toFileDiagnostic = (item: Json): FileDiagnostic => ({
    severity: severityName(item.severity),
    line: (item.range?.start?.line ?? 0) + 1,
    column: (item.range?.start?.character ?? 0) + 1,
    endLine: (item.range?.end?.line ?? 0) + 1,
    endColumn: (item.range?.end?.character ?? 0) + 1,
    message: String(typeof item.message === "string" ? item.message : (item.message?.value ?? "")),
    ...(item.code === undefined || item.code === null ? {} : { code: String(item.code) }),
    ...(typeof item.source === "string" ? { source: item.source } : {}),
  });

  /**
   * One file's diagnostics from these documents (of one file, on several servers), carried to the
   * latest version, as tools list them. The first document's load decides: a reload reaches each
   * copy in turn.
   */
  const listedDiagnostics = (docs: ReadonlyArray<GatewayDoc>): FileDiagnostics => {
    const first = docs[0]!;
    const current = docs.filter((doc) => doc.loadId === first.loadId);
    const version = Math.max(...current.map((doc) => doc.version));
    const items = current.flatMap((doc) => diagnosticsAt(doc, version));
    const listed = items.slice(0, DIAGNOSTICS_LISTED).map(toFileDiagnostic);
    return {
      path: first.relativePath,
      version,
      diagnostics: listed,
      truncated: items.length > listed.length,
    };
  };

  // Astrolabe: each checkout's latest problems by file and server, kept after a file closes until
  // its server stops, for the problems view.
  const problems = new Map<
    string,
    { readonly cwd: string; readonly byServer: Map<string, FileDiagnostics> }
  >();
  const problemEvents = yield* PubSub.unbounded<{
    readonly cwd: string;
    readonly file: FileDiagnostics;
  }>();
  const problemKey = (cwd: string, relativePath: string) => `${path.resolve(cwd)}\0${relativePath}`;

  /** A file's problems across its servers; `path` and `version` come from `fallback` for none. */
  const mergedProblems = (
    files: ReadonlyArray<FileDiagnostics>,
    fallback: FileDiagnostics,
  ): FileDiagnostics => {
    const diagnostics = files.flatMap((file) => file.diagnostics);
    return {
      path: fallback.path,
      version: Math.max(fallback.version, ...files.map((file) => file.version)),
      diagnostics: diagnostics.slice(0, DIAGNOSTICS_LISTED),
      truncated:
        diagnostics.length > DIAGNOSTICS_LISTED || files.some((file) => file.truncated === true),
    };
  };

  /** Records one server's problems for a file, or their end, and tells the problems view. */
  const setProblems = (instance: Instance, file: FileDiagnostics) => {
    const cwd = path.resolve(instance.cwd);
    const key = problemKey(instance.cwd, file.path);
    const known = problems.get(key);
    if (file.diagnostics.length === 0 && !known?.byServer.has(instance.key)) return;
    const entry = known ?? { cwd, byServer: new Map() };
    if (file.diagnostics.length === 0) entry.byServer.delete(instance.key);
    else entry.byServer.set(instance.key, file);
    if (entry.byServer.size === 0) problems.delete(key);
    else problems.set(key, entry);
    PubSub.publishUnsafe(problemEvents, {
      cwd,
      file: mergedProblems([...entry.byServer.values()], file),
    });
  };

  const noteProblems = (instance: Instance, doc: GatewayDoc) => {
    // Closing a file nobody holds clears it for its editors; its problems stay listed.
    if (doc.holders === 0) return;
    setProblems(instance, listedDiagnostics([doc]));
  };

  /** Forgets a stopped server's problems for files it no longer has open. */
  const forgetProblems = (instance: Instance) => {
    for (const { byServer } of problems.values()) {
      const file = byServer.get(instance.key);
      if (file === undefined || instance.docs.has(file.path)) continue;
      setProblems(instance, { ...file, diagnostics: [], truncated: false });
    }
  };

  /** What a session's client should show for a file: every server's, at the latest version. */
  const publishDiagnostics = (session: Session, relativePath: string) => {
    const file = session.open.get(relativePath);
    const first = file?.held[0]?.doc;
    if (file === undefined || first === undefined) return;
    const docs = file.held
      .map((held) => held.doc)
      .filter((doc) => doc.latest !== null && doc.loadId === first.loadId);
    const version = Math.max(-1, ...docs.map((doc) => doc.latest!.version));
    const at = version < 0 ? first.version : version;
    sendTo(
      session,
      {
        method: "textDocument/publishDiagnostics",
        params: {
          uri: file.uri,
          version: at,
          diagnostics: docs.flatMap((doc) => diagnosticsAt(doc, at)),
        },
      },
      at,
    );
  };

  const fanOutDiagnostics = (instance: Instance, doc: GatewayDoc) => {
    noteProblems(instance, doc);
    for (const session of doc.sessions) publishDiagnostics(session, doc.relativePath);
  };

  const setDiagnostics = (instance: Instance, doc: GatewayDoc, published: PublishedDiagnostics) => {
    doc.published += 1;
    if (doc.latest !== null && doc.latest.version > published.version) return;
    doc.latest = {
      version: published.version,
      // Merged with other servers', a diagnostic has to say whose it is.
      diagnostics: published.diagnostics.map((diagnostic) =>
        typeof diagnostic?.source === "string"
          ? diagnostic
          : { ...diagnostic, source: instance.spec.name },
      ),
    };
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
            contentChanges: running.fullSync
              ? [{ text: next.toString() }]
              : contentChanges.reverse(),
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
        sessions: new Set(),
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

  /** A server's refresh is a request of it; each editor showing its answers asks again. */
  const refreshSessions = (instance: Instance, kind: string) => {
    const reached = new Set(instance.sessions.values());
    for (const doc of instance.docs.values()) {
      for (const session of doc.sessions) reached.add(session);
    }
    for (const session of reached) sendTo(session, { method: "astrolabe/refresh", params: kind });
    return null;
  };

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
      case "workspace/inlayHint/refresh":
        return refreshSessions(instance, "inlayHints");
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
    // typescript-language-server only ever hears settings this way; the rest ask again.
    if (Object.keys(instance.settings).length > 0) {
      connection.value.notify("workspace/didChangeConfiguration", { settings: instance.settings });
    }
    const answer = init.value.value as Json;
    const capabilities = answer?.capabilities ?? {};
    const version = answer?.serverInfo?.version;
    const running: Running = {
      generation,
      connection: connection.value,
      capabilities,
      pull: capabilities?.diagnosticProvider != null,
      fullSync: (capabilities?.textDocumentSync?.change ?? capabilities?.textDocumentSync) === 1,
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
    if (instance.log.subscribers.size === 0 && !lingering.has(instance.key)) {
      logs.delete(instance.key);
    }
    instance.log.stateChanged();
    yield* publishList();
  });

  /**
   * Over the budget, servers stop until the rest fit: companions, which only add to a file, then
   * the least recently used; never the last of those, the newest primary if there is one.
   */
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
    const primaryRank = (instance: Instance) =>
      isCompanionLanguageServer(instance.spec.id) ? 0 : 1;
    const byPreference = running.toSorted(
      (a, b) => primaryRank(a) - primaryRank(b) || a.lastUsed - b.lastUsed,
    );
    for (const instance of byPreference.slice(0, -1)) {
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
      activation: new Map(),
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
      // Someone restarting may just have added the config that makes a companion apply.
      for (const primary of instances.values()) {
        if (primary.cwd !== target.cwd) continue;
        primary.activation.clear();
        for (const session of primary.sessions.values()) {
          for (const [relativePath, file] of session.open) {
            yield* fork(syncCompanions(session, relativePath, file), session.scope);
          }
        }
      }
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
        const base = {
          server: spec.id,
          languages: spec.languages,
          companion: isCompanionLanguageServer(spec.id)
            ? yield* installer.activationOf(cwd, spec)
            : null,
        };
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
        // With the subscribe, nothing between: a line lands in one or the other, never both.
        const snapshot: LanguageServerLogItem = {
          type: "snapshot",
          state: { info: infoOf(key), tracing: log.tracing },
          lines: log.lines(),
          trace: log.entries(),
        };
        const endIfUnread = Effect.sync(() => {
          lingering.set(key, Math.max(0, (lingering.get(key) ?? 1) - 1));
          if ((lingering.get(key) ?? 0) === 0) lingering.delete(key);
          if (log.subscribers.size > 0 || lingering.has(key)) return;
          log.onLastSubscriberGone();
          if (!instances.has(key) && logs.get(key) === log) logs.delete(key);
        });
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            log.subscribers.delete(subscriber);
            if (log.subscribers.size > 0) return Effect.void;
            lingering.set(key, (lingering.get(key) ?? 0) + 1);
            return Duration.isZero(Duration.fromInputUnsafe(options.traceGrace))
              ? endIfUnread
              : fork(Effect.sleep(options.traceGrace).pipe(Effect.andThen(endIfUnread)));
          }),
        );
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
    for (const [relativePath, { uri }] of session.open) {
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
          places: editPlaces(relativePath, accepted, text),
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
      places: files.flatMap((file) => file.places).slice(0, EDIT_PLACES_LISTED),
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
      places: edits.flatMap((edit) => edit.places).slice(0, EDIT_PLACES_LISTED),
    };
  };

  /**
   * Applies one of the code actions last offered to the session on the server that offered it:
   * its edit through the environment, as a rename's, then its command, whose own edits the server
   * sends back here.
   */
  const applyCodeAction = Effect.fn("LanguageServers.applyCodeAction")(function* (
    session: Session,
    index: unknown,
  ) {
    const offered = typeof index === "number" ? session.codeActions?.[index] : undefined;
    const running = offered?.instance.running;
    if (offered === undefined || running === null || running === undefined) {
      return { error: contentModified("The code actions changed; ask for them again.") };
    }
    const { instance, seen } = offered;
    session.codeActions = null;
    let action: Json = offered.action;
    const isCommand = typeof action.command === "string";
    if (
      !isCommand &&
      action.edit === undefined &&
      running.capabilities?.codeActionProvider?.resolveProvider
    ) {
      action = yield* running.connection
        .request("codeAction/resolve", action)
        .response.pipe(Effect.orElseSucceed(() => offered.action));
    }
    const done: Array<LanguageServerAppliedEdit> = [];
    if (action.edit) {
      const edit = yield* applyWorkspaceEdit(instance, action.edit, seen).pipe(Effect.option);
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

  /** The servers on a file, those a request can reach now: running, with the file open. */
  const openOn = (primary: Instance, relativePath: string) =>
    [
      primary,
      ...languageServersForPath(relativePath)
        .filter(({ server }) => server !== primary.spec.id)
        .flatMap(({ server }) => instances.get(`${primary.cwd}\0${server}`) ?? []),
    ].filter((instance) => {
      const openGeneration = instance.docs.get(relativePath)?.openOn;
      return instance.running !== null && openGeneration === instance.running.generation;
    });

  const formatterOrder = (primary: Instance, serving: ReadonlyArray<Instance>) => {
    const order = primary.spec.formatters ?? [];
    const rank = (instance: Instance) => {
      const at = order.indexOf(instance.spec.id);
      return at < 0 ? order.length : at;
    };
    return serving.toSorted((a, b) => rank(a) - rank(b));
  };

  /** The companions a checkout uses for this file, as read at its primary's last Restart. */
  const activeCompanions = Effect.fn("LanguageServers.activeCompanions")(function* (
    primary: Instance,
    relativePath: string,
  ) {
    const [first, ...companions] = languageServersForPath(relativePath);
    const active: Array<LanguageServerForPath> = [];
    if (first?.server !== primary.spec.id) return active;
    for (const companion of companions) {
      const spec = options.specs[companion.server];
      if (spec === undefined) continue;
      let known = primary.activation.get(spec.id);
      if (known === undefined) {
        known = (yield* installer.activationOf(primary.cwd, spec)).active;
        primary.activation.set(spec.id, known);
      }
      if (known) active.push(companion);
    }
    return active;
  });

  /** Started and held at once: a companion with no file would have nothing to stop it. */
  const holdCompanion = (
    primary: Instance,
    relativePath: string,
    { server, languageId }: LanguageServerForPath,
  ) =>
    use({ cwd: primary.cwd, server }).pipe(
      Effect.flatMap((instance) =>
        holdDoc(instance, relativePath, languageId).pipe(
          Effect.map((doc): Held => ({ instance, doc })),
        ),
      ),
      Effect.uninterruptible,
    );

  /** What the servers behind a session can do for its client, now. */
  const sessionCapabilities = (session: Session) => {
    const serving = new Set([
      session.primary,
      ...[...session.open.values()].flatMap((file) => file.held.map((held) => held.instance)),
    ]);
    const { diagnosticProvider: _pulledHere, ...merged } = mergeCapabilities(
      [...serving].flatMap((instance) => instance.running?.capabilities ?? []),
    );
    // Editors send no document changes: the servers have the environment's copy.
    return { ...merged, textDocumentSync: { openClose: true, change: 0 } };
  };

  /** Companions start after `initialize`, so a client hears what they add when they come. */
  const advertise = (session: Session) => {
    if (session.advertised === null) return;
    const capabilities = sessionCapabilities(session);
    const text = stringifyJson(capabilities);
    if (text === session.advertised) return;
    session.advertised = text;
    sendTo(session, { method: "astrolabe/capabilities", params: capabilities });
  };

  const release = (session: Session, { instance, doc }: Held) => {
    doc.sessions.delete(session);
    return releaseDoc(instance, doc);
  };

  /** Holds a file on each active companion, lazily starting it, and lets go of the others. */
  const syncCompanions = Effect.fn("LanguageServers.syncCompanions")(function* (
    session: Session,
    relativePath: string,
    file: OpenFile,
  ) {
    const { primary } = session;
    const wanted = yield* activeCompanions(primary, relativePath);
    const isHeld = (server: LanguageServerId) =>
      file.held.some((held) => held.instance.spec.id === server);
    for (const held of file.held.slice(1)) {
      if (wanted.some(({ server }) => server === held.instance.spec.id)) continue;
      // Another Restart's sync may have dropped it during an earlier release.
      const index = file.held.indexOf(held);
      if (index === -1) continue;
      file.held.splice(index, 1);
      yield* release(session, held);
      publishDiagnostics(session, relativePath);
    }
    for (const companion of wanted) {
      if (isHeld(companion.server)) continue;
      yield* holdCompanion(primary, relativePath, companion).pipe(
        Effect.flatMap(({ instance, doc }) => {
          // Closed, or held by a Restart's sync, while this one waited.
          if (session.open.get(relativePath) !== file || isHeld(companion.server)) {
            return releaseDoc(instance, doc);
          }
          doc.sessions.add(session);
          file.held.push({ instance, doc });
          file.held.sort(
            (a, b) => serverRank(relativePath, a.instance) - serverRank(relativePath, b.instance),
          );
          if (doc.latest !== null) publishDiagnostics(session, relativePath);
          return Effect.void;
        }),
        // Whole or not at all: nothing else would let go of a hold it didn't record.
        Effect.uninterruptible,
      );
    }
    advertise(session);
  });

  const serverRank = (relativePath: string, instance: Instance) =>
    languageServersForPath(relativePath).findIndex(({ server }) => server === instance.spec.id);

  const onSessionNotification = Effect.fn("LanguageServers.sessionNotification")(function* (
    session: Session,
    message: Json,
  ) {
    const { primary } = session;
    const uri = message.params?.textDocument?.uri;
    switch (message.method) {
      case "textDocument/didOpen": {
        const relativePath = relativePathOf(primary, uri);
        if (relativePath === null || session.open.has(relativePath)) return;
        const languageId =
          languageServerForPath(relativePath)?.languageId ?? message.params.textDocument.languageId;
        const file: OpenFile = { uri, held: [] };
        session.open.set(relativePath, file);
        const doc = yield* holdDoc(primary, relativePath, String(languageId));
        doc.sessions.add(session);
        file.held.push({ instance: primary, doc });
        if (doc.latest !== null) publishDiagnostics(session, relativePath);
        // Apart from the open: a companion costs the primary nothing, however it fares.
        yield* fork(syncCompanions(session, relativePath, file), session.scope);
        return;
      }
      case "textDocument/didClose": {
        const relativePath = relativePathOf(primary, uri);
        const file = relativePath === null ? undefined : session.open.get(relativePath);
        if (relativePath === null || file === undefined) return;
        session.open.delete(relativePath);
        yield* Effect.forEach(file.held, (held) => release(session, held), { discard: true });
        advertise(session);
        return;
      }
      case "$/cancelRequest": {
        const id = message.params?.id;
        const pending = session.pending.get(id);
        if (pending === undefined) return;
        pending.cancelled = true;
        if (pending.inFlight.size > 0) {
          for (const cancel of pending.inFlight) cancel();
          return;
        }
        session.pending.delete(id);
        if (pending.fiber !== null) yield* Fiber.interrupt(pending.fiber);
        sendTo(session, { id, error: { code: RequestCancelled, message: "Cancelled" } });
        return;
      }
      // didChange is never needed: the servers have the environment's documents. The rest are
      // the client's lifecycle, which the gateway already ran with each server.
      default:
        return;
    }
  });

  /**
   * Waits for answers to `asked`, in its order. Past `fanOutTimeout` a slow server gives way: what
   * has come in is the answer, or the first answer with something in it when nothing has.
   */
  const gather = Effect.fnUntraced(function* (asked: ReadonlyArray<Asked>) {
    const done = Deferred.makeUnsafe<void>();
    const answers = new Map<Asked, ServerAnswer>();
    let expired = false;
    let useful = false;
    const settle = () => {
      if (answers.size === asked.length || (expired && useful)) {
        Deferred.doneUnsafe(done, Exit.void);
      }
    };
    yield* Effect.forEach(
      asked,
      (request) =>
        request.response.pipe(
          Effect.map((answer) => {
            answers.set(request, answer);
            if (answer.ok && hasContent(answer.result)) useful = true;
            settle();
          }),
          Effect.forkChild({ startImmediately: true }),
        ),
      { discard: true },
    );
    yield* Effect.sleep(options.fanOutTimeout).pipe(
      Effect.andThen(
        Effect.sync(() => {
          expired = true;
          settle();
        }),
      ),
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Deferred.await(done);
    return asked.flatMap((request) => {
      const answer = answers.get(request);
      if (answer !== undefined) return [{ request, answer }];
      request.cancel();
      return [];
    });
  });

  const forward = Effect.fn("LanguageServers.forward")(function* (
    primary: Instance,
    session: Session,
    message: Json,
    state: LanguageServerSendInput["document"],
    pending: PendingForward,
  ) {
    yield* Deferred.await(primary.ready);
    const method: string = message.method;
    const clientUri = message.params?.textDocument?.uri;
    const resolving = method === "completionItem/resolve" ? originOf(message.params) : null;
    const params = resolving?.item ?? message.params;
    const relativePath = resolving?.origin.path ?? relativePathOf(primary, clientUri);
    const doc = relativePath === null ? undefined : primary.docs.get(relativePath);
    if (doc !== undefined && relativePath !== null && state !== undefined) {
      // A file just opened: its text may still be on its way from Documents.
      yield* until(doc, () => doc.loadId !== null || primary.docs.get(doc.relativePath) !== doc);
      if (state.loadId !== doc.loadId)
        return { error: contentModified("The document was reloaded.") };
      if (state.unconfirmed.length > 0) {
        // Landing the editor's unsent edits first means the document and LSP streams need no
        // ordering: collab drops the ones it already took. Once, however many servers follow.
        const pushed = yield* documents
          .push({
            cwd: primary.cwd,
            relativePath: doc.relativePath,
            loadId: state.loadId,
            version: state.version,
            updates: state.unconfirmed.map((changes) => ({ clientId: state.clientId, changes })),
          })
          .pipe(Effect.option);
        if (Option.isNone(pushed)) return { error: contentModified("The edits did not fit.") };
        yield* until(doc, () => doc.version >= pushed.value.version || doc.loadId !== state.loadId);
      }
      // Each copy hears of an update in its own time; the primary's has what the editor sent.
      for (const { docs } of openOn(primary, relativePath)) {
        const other = docs.get(relativePath);
        if (other === undefined || other === doc) continue;
        yield* until(other, () => other.version >= doc.version || other.loadId !== doc.loadId);
      }
    }

    /**
     * Sends the request to one server, positions read from that server's copy. Synchronous on
     * purpose, from reading the copy to the write: the server must get the request at the version
     * the positions were mapped to.
     */
    const ask = (instance: Instance): Asked | { readonly error: Json } => {
      const askedDoc = relativePath === null ? undefined : instance.docs.get(relativePath);
      const translated = translateRequest(askedDoc, state, params);
      if ("error" in translated) return translated;
      const running = instance.running;
      if (running === null) return { error: contentModified("The server restarted.") };
      const position = translated.params?.position;
      const query =
        method === "textDocument/completion" && askedDoc !== undefined && position
          ? wordBefore(askedDoc.texts.get(askedDoc.version)!, position)
          : "";
      // A file changed moments ago is one it would otherwise rename by what it last read.
      if (method === "textDocument/rename") flushChanges(instance);
      // A rename is applied here, at the texts the server answers about.
      const seen =
        method === "textDocument/rename" || method === "textDocument/codeAction"
          ? serverTexts(instance)
          : null;
      const request = running.connection.request(method, translated.params);
      const cancel = () => running.connection.cancel(request.id);
      pending.inFlight.add(cancel);
      return {
        instance,
        doc: askedDoc,
        context: translated.context,
        query,
        seen,
        cancel,
        response: request.response.pipe(
          Effect.map((result) => ({ ok: true as const, result: result as Json })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
          Effect.ensuring(Effect.sync(() => pending.inFlight.delete(cancel))),
        ),
      };
    };

    const mapped = (asked: Asked, result: Json) =>
      mapAnswer(method, result, asked.doc, asked.context, asked.query);

    const finish = Effect.fnUntraced(function* (asked: Asked, result: Json) {
      if (asked.seen !== null) {
        if (result == null) return { result: null };
        return yield* applyWorkspaceEdit(asked.instance, result, asked.seen).pipe(
          Effect.map((edit) => ({ result: { applied: edit } })),
          Effect.catch((error) =>
            Effect.succeed({ error: { code: -32603, message: error.message } }),
          ),
        );
      }
      const answer = mapped(asked, result);
      if ("error" in answer) return answer;
      if (resolving !== null) {
        const [item] = tagCompletions({ items: [answer.result] }, resolving.origin).items;
        return { result: item };
      }
      const uris = toSessionUris(asked.instance, session, answer.result);
      if (!LOCATION_METHODS.has(method)) return { result: uris };
      return { result: yield* withPreviews(asked.instance, uris, clientUri) };
    });

    if (resolving !== null) {
      const origin = instances.get(`${primary.cwd}\0${resolving.origin.server}`);
      if (!origin?.running?.capabilities?.completionProvider?.resolveProvider) {
        return { result: message.params };
      }
      const asked = ask(origin);
      if ("error" in asked) return asked;
      const answer = yield* asked.response;
      return answer.ok
        ? yield* finish(asked, answer.result)
        : { error: errorMessage(answer.error) };
    }

    const route = ROUTES.get(method);
    const reachable = relativePath === null ? [] : openOn(primary, relativePath);
    const ordered = FORMATTING_METHODS.has(method) ? formatterOrder(primary, reachable) : reachable;
    const capable =
      route === undefined
        ? []
        : ordered.filter(
            ({ running }) =>
              running?.capabilities?.[route.capability] &&
              (method !== "textDocument/completion" ||
                hearsCompletion(running.capabilities, params)),
          );
    // Nobody claims it: the primary answers, as it would with no companions.
    const targets = capable.length === 0 ? [primary] : capable;

    if (route?.fan === "all") {
      const asked = targets.map(ask);
      const live = asked.flatMap((request) => ("error" in request ? [] : [request]));
      if (live.length === 0) return asked[0] as { readonly error: Json };
      const answers = yield* gather(live);
      const failure = answers.flatMap(({ answer }) =>
        answer.ok ? [] : [{ error: errorMessage(answer.error) }],
      )[0];
      if (method === "textDocument/codeAction") {
        // The editor gets titles; the actions stay here, in each server's coordinates, to apply.
        const offered = answers.flatMap(({ request, answer }) =>
          answer.ok && Array.isArray(answer.result)
            ? answer.result.map((action: Json) => ({
                action,
                instance: request.instance,
                seen: request.seen!,
              }))
            : [],
        );
        if (offered.length === 0 && failure !== undefined) return failure;
        session.codeActions = offered;
        return {
          result: offered.map(({ action }, index) => ({
            index,
            title: String(action?.title ?? ""),
            ...(typeof action?.kind === "string" ? { kind: action.kind } : {}),
            ...(action?.isPreferred === true ? { isPreferred: true } : {}),
            ...(action?.disabled?.reason ? { disabled: String(action.disabled.reason) } : {}),
          })),
        };
      }
      const lists: Array<Json> = [];
      let refused: { readonly error: Json } | undefined;
      for (const { request, answer } of answers) {
        if (!answer.ok) continue;
        const list = mapped(request, answer.result);
        if ("error" in list) refused ??= list;
        else if (list.result != null) {
          lists.push(
            tagCompletions(list.result, {
              server: request.instance.spec.id,
              path: relativePath ?? "",
            }),
          );
        }
      }
      if (lists.length === 0) return failure ?? refused ?? { result: null };
      return { result: mergeCompletions(lists) };
    }

    const asking = route?.fan === "hover" ? targets : targets.slice(0, 1);
    let failed: { readonly error: Json } | null = null;
    for (const instance of asking) {
      if (pending.cancelled) break;
      const asked = ask(instance);
      if ("error" in asked) {
        failed ??= asked;
        continue;
      }
      const answer = yield* asked.response;
      if (!answer.ok) {
        failed ??= { error: errorMessage(answer.error) };
      } else if (answer.result != null || asking.length === 1) {
        return yield* finish(asked, answer.result);
      }
    }
    return failed ?? { result: null };
  });

  /** The client's own lifecycle requests are the gateway's to answer; the rest go to the servers. */
  const answer = Effect.fn("LanguageServers.answer")(function* (
    session: Session,
    message: Json,
    state: LanguageServerSendInput["document"],
    pending: PendingForward,
  ) {
    const { primary } = session;
    if (message.method === "shutdown") return { result: null };
    if (message.method === "astrolabe/applyCodeAction") {
      return yield* applyCodeAction(session, message.params?.index);
    }
    if (message.method !== "initialize") {
      return yield* forward(primary, session, message, state, pending);
    }
    yield* Deferred.await(primary.ready);
    const capabilities = sessionCapabilities(session);
    session.advertised = stringifyJson(capabilities);
    return { result: { capabilities, serverInfo: { name: primary.status.name } } };
  });

  const onSessionRequest = Effect.fn("LanguageServers.sessionRequest")(function* (
    session: Session,
    message: Json,
    state: LanguageServerSendInput["document"],
  ) {
    const id = message.id;
    const pending: PendingForward = { inFlight: new Set(), cancelled: false, fiber: null };
    session.pending.set(id, pending);
    const fiber = yield* answer(session, message, state, pending).pipe(
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
          primary: instance,
          queue,
          open: new Map(),
          pending: new Map(),
          scope: yield* Scope.fork(instance.scope),
          codeActions: null,
          advertised: null,
        };
        instance.sessions.set(opened.id, opened);
        sessions.set(opened.id, opened);
        Queue.offerUnsafe(queue, { type: "status", status: instance.status });
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            sessions.delete(opened.id);
            instance.sessions.delete(opened.id);
            yield* Scope.close(opened.scope, Exit.void);
            const files = [...opened.open.values()];
            opened.open.clear();
            for (const file of files) {
              yield* Effect.forEach(file.held, (held) => release(opened, held), { discard: true });
            }
            yield* scheduleIdle(instance);
          }),
        );
        return Stream.fromQueue(queue);
      }),
    );

  const send: LanguageServers["Service"]["send"] = Effect.fn("LanguageServers.send")(
    function* (input) {
      const session = sessions.get(input.sessionId);
      if (session === undefined) return yield* failure("no-session", "That session is not open.");
      const message: Json = parseJson(input.message);
      if (typeof message !== "object" || message === null || typeof message.method !== "string") {
        return;
      }
      session.primary.lastUsed = ++clock;
      if (message.id === undefined || message.id === null) {
        return yield* onSessionNotification(session, message);
      }
      yield* onSessionRequest(session, message, input.document);
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

  /** The file on each active companion until the scope ends; one that can't be had is skipped. */
  const holdCompanions = Effect.fn("LanguageServers.holdCompanions")(function* (
    primary: Instance,
    relativePath: string,
  ) {
    const wanted = yield* activeCompanions(primary, relativePath);
    const held = yield* Effect.forEach(wanted, (companion) =>
      Effect.acquireRelease(holdCompanion(primary, relativePath, companion), ({ instance, doc }) =>
        releaseDoc(instance, doc),
      ).pipe(Effect.option),
    );
    return held.flatMap((one) => (Option.isSome(one) ? [one.value] : []));
  });

  /** Until a document's diagnostics at `synced` have come in and publishes have stopped. */
  const settled = Effect.fnUntraced(function* (
    { instance, doc }: Held,
    synced: { readonly loadId: string; readonly version: number },
  ) {
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
  });

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
        // Beside the primary's own start, not after it: the wait for them is short.
        const companions = yield* holdCompanions(instance, input.relativePath);
        yield* until(doc, () => doc.loadId !== null || !instance.docs.has(input.relativePath));
        if (doc.loadId === null) {
          return yield* failure("document", `'${input.relativePath}' could not be opened.`);
        }
        const synced = yield* documents
          .sync({ cwd: instance.cwd, relativePath: input.relativePath })
          .pipe(Effect.mapError((cause) => failure("document", cause.message, cause)));
        yield* readyForAgent(instance);
        yield* settled({ instance, doc }, synced);
        yield* Effect.forEach(
          companions,
          (held) =>
            readyForAgent(held.instance).pipe(Effect.andThen(settled(held, synced)), Effect.ignore),
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.timeoutOption(options.companionWait));
        return listedDiagnostics([
          doc,
          ...companions.flatMap((held) => (held.instance.running === null ? [] : [held.doc])),
        ]);
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
    const primary = match && instances.get(`${input.cwd}\0${match.server}`);
    if (!primary) return;
    // Only a file an editor holds open here has a running server and the text it formats.
    const formatter = formatterOrder(primary, openOn(primary, input.relativePath)).find(
      (instance) => instance.running?.capabilities?.documentFormattingProvider,
    );
    const doc = formatter?.docs.get(input.relativePath);
    const running = formatter?.running;
    if (!doc || !running || doc.loadId !== input.loadId) return;
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
          .map(({ byServer }) => {
            const known = [...byServer.values()];
            return mergedProblems(known, known[0]!);
          });
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
  fanOutTimeout: Duration.seconds(1),
  companionWait: Duration.seconds(2),
  traceGrace: Duration.minutes(5),
  registry: DEFAULT_REGISTRY,
};

export const layerWith = (options: LanguageServersOptions) =>
  Layer.effect(LanguageServers, make(options));

export const layer = layerWith(defaultOptions);
