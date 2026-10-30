// @effect-diagnostics nodeBuiltinImport:off - file URLs are converted synchronously, between writes.
import { ChangeSet, Text } from "@codemirror/state";
import {
  type FileDiagnostic,
  type FileDiagnostics,
  languageServerForPath,
  LanguageServerError,
  type LanguageServerId,
  type LanguageServerSendInput,
  type LanguageServerSessionInput,
  type LanguageServerSessionItem,
  type LanguageServerStatus,
  type LanguageServerTarget,
} from "@t3tools/contracts";
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
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeUrl from "node:url";

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
import { DEFAULT_REGISTRY, makeInstaller } from "./install.ts";
import { parseJson, stringifyJson } from "./json.ts";
import { makeMemoryReader, type MemoryReader } from "./memory.ts";
import {
  browserToAuthority,
  forwardMapper,
  inverseMapper,
  mapDiagnostics,
  mapParams,
  mapResult,
  toPosition,
  trimCompletion,
  Unrepresentable,
} from "./positions.ts";
import { LANGUAGE_SERVERS, type LanguageServerSpec } from "./registry.ts";

/**
 * Language servers in the environment, one per language per checkout, started when a code file
 * opens and stopped when nothing uses them. The environment is each server's only LSP client: it
 * feeds the server its `Documents`, one `didChange` per accepted update so collab versions are LSP
 * versions, and pulls diagnostics. Browsers reach a server through the gateway here, which maps
 * their positions into its copy and the answers back into theirs.
 */
export class LanguageServers extends Context.Service<
  LanguageServers,
  {
    /** Every server now, then the whole list on each change. */
    readonly subscribe: Stream.Stream<ReadonlyArray<LanguageServerStatus>>;
    readonly restart: (input: LanguageServerTarget) => Effect.Effect<void, LanguageServerError>;
    readonly stop: (input: LanguageServerTarget) => Effect.Effect<void, LanguageServerError>;
    readonly confirmDownload: Effect.Effect<void, LanguageServerError>;
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
  }
>()("t3/languageServers/LanguageServers") {}

export interface LanguageServersOptions {
  readonly specs: Readonly<Record<LanguageServerId, LanguageServerSpec>>;
  /** No documents and no sessions for this long stops a server. */
  readonly idleTimeout: Duration.Input;
  /** Resident memory every server may use together; past it the least recently used stop. */
  readonly memoryBudgetBytes: number;
  readonly memorySampleInterval: Duration.Input;
  /** Waits before each restart after a crash; one more crash than there are delays gives up. */
  readonly restartDelays: ReadonlyArray<Duration.Input>;
  readonly initializeTimeout: Duration.Input;
  readonly diagnosticsTimeout: Duration.Input;
  readonly registry: string;
  /** Defaults to `caches/language-servers` under T3 home, shared by every checkout. */
  readonly cacheDir?: string;
  readonly readMemory?: MemoryReader;
  /**
   * Astrolabe has no repository trust yet, and agents already run code in every repository, so
   * each is trusted. A restricted one gets our own server with nothing that runs its code.
   */
  readonly trusted: (cwd: string) => Effect.Effect<boolean>;
}

/** Versions of each document kept to map an editor's positions from; older ones get ContentModified. */
const VERSIONS_KEPT = 200;
const PULL_RETRIES = 3;
const DIAGNOSTICS_LISTED = 200;
const SHUTDOWN_TIMEOUT = Duration.seconds(2);

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
  pulling: boolean;
  dirty: boolean;
  readonly waiters: Set<() => void>;
  readonly scope: Scope.Closeable;
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
}

interface Running {
  readonly generation: number;
  readonly connection: LspConnection;
  readonly capabilities: Json;
  readonly pull: boolean;
}

interface Instance {
  readonly key: string;
  readonly cwd: string;
  readonly spec: LanguageServerSpec;
  readonly lock: Semaphore.Semaphore;
  readonly scope: Scope.Closeable;
  status: LanguageServerStatus;
  readonly sessions: Map<string, Session>;
  readonly docs: Map<string, GatewayDoc>;
  /** Documents waiting for a diagnostics pull. */
  readonly pulls: Queue.Queue<GatewayDoc>;
  running: Running | null;
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
    diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
    publishDiagnostics: { versionSupport: true, relatedInformation: true },
  },
  workspace: { configuration: true, workspaceFolders: true },
  window: { workDoneProgress: false, showMessage: {} },
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
): { readonly result: Json } | { readonly error: Json } => {
  const result = method === "textDocument/completion" ? trimCompletion(raw) : raw;
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
  const config = yield* ServerConfig.ServerConfig;
  const installer = yield* makeInstaller({
    cacheDir: options.cacheDir ?? path.join(config.providerStatusCacheDir, "language-servers"),
    registry: options.registry,
  });
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

  // Diagnostics ---------------------------------------------------------------------------------

  const fanOutDiagnostics = (instance: Instance, doc: GatewayDoc) => {
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
    if (doc.latest !== null && doc.latest.version > published.version) return;
    doc.latest = published;
    fanOutDiagnostics(instance, doc);
    for (const wake of doc.waiters) wake();
  };

  const clearDiagnostics = (instance: Instance) => {
    for (const doc of instance.docs.values()) {
      if (doc.latest === null) continue;
      doc.latest = { version: doc.version, diagnostics: [] };
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
          setDiagnostics(instance, doc, { version, diagnostics: result.report.items });
        }
      } while (doc.dirty);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          doc.pulling = false;
        }),
      ),
    );
  });

  // Feeding the server ------------------------------------------------------------------------

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
        uri: NodeUrl.pathToFileURL(path.join(instance.cwd, relativePath)).href,
        languageId,
        holders: 0,
        loadId: null,
        version: 0,
        oldest: 0,
        texts: new Map(),
        updates: [],
        openOn: null,
        latest: null,
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

  // Lifecycle ---------------------------------------------------------------------------------

  const onRequestFromServer = (instance: Instance) => (method: string, params: Json) => {
    switch (method) {
      case "workspace/configuration":
        return Array.isArray(params?.items) ? params.items.map(() => null) : [];
      case "workspace/workspaceFolders":
        return [
          { uri: NodeUrl.pathToFileURL(instance.cwd).href, name: path.basename(instance.cwd) },
        ];
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/workDoneProgress/create":
      case "window/showMessageRequest":
        return null;
      case "workspace/applyEdit":
        return { applied: false };
      default:
        return undefined;
    }
  };

  const onNotificationFromServer = (instance: Instance) => (method: string, params: Json) => {
    if (method !== "textDocument/publishDiagnostics" || typeof params?.uri !== "string") return;
    const doc = [...instance.docs.values()].find((candidate) => candidate.uri === params.uri);
    if (doc === undefined || !Array.isArray(params.diagnostics)) return;
    const version = typeof params.version === "number" ? params.version : doc.version;
    setDiagnostics(instance, doc, { version, diagnostics: params.diagnostics });
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
    yield* setStatus(instance, { state: "starting", message: null });
    const trusted = yield* options.trusted(instance.cwd);
    let resolution = yield* installer
      .resolve(instance.cwd, instance.spec, trusted)
      .pipe(
        Effect.catch((error) =>
          Effect.succeed({ type: "unavailable" as const, message: error.message }),
        ),
      );
    if (resolution.type === "download") {
      const npm = resolution.npm;
      if (!(yield* installer.consented)) {
        return yield* setStatus(instance, {
          state: "download-needed",
          name: resolution.name,
          message: `${npm.name} ${npm.version} (${npm.licence}) needs downloading from npm.`,
          restricted: !trusted,
        });
      }
      yield* setStatus(instance, { state: "downloading", name: resolution.name, message: null });
      const downloaded = yield* installer.download(npm).pipe(
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
    if (resolution.type !== "ready") {
      return yield* failWith(
        instance,
        resolution.type === "unavailable" ? resolution.message : "The download did not install.",
      );
    }
    const server = resolution.server;
    yield* setStatus(instance, {
      state: "starting",
      name: server.name,
      source: server.source,
      restricted: !trusted,
    });
    const processScope = yield* Scope.fork(instance.scope);
    instance.processScope = processScope;
    const started = yield* Effect.gen(function* () {
      const connection = yield* connect(
        { executable: server.executable, args: server.args, cwd: instance.cwd, env: server.env },
        {
          onNotification: onNotificationFromServer(instance),
          onRequest: onRequestFromServer(instance),
        },
      );
      yield* connection.exited.pipe(
        Effect.flatMap(() => onExit(instance, generation, connection)),
        Effect.forkIn(serviceScope, { startImmediately: true }),
      );
      const rootUri = NodeUrl.pathToFileURL(instance.cwd).href;
      const init = yield* connection
        .request("initialize", {
          processId: process.pid,
          clientInfo: { name: "Astrolabe" },
          rootUri,
          rootPath: instance.cwd,
          workspaceFolders: [{ uri: rootUri, name: path.basename(instance.cwd) }],
          capabilities: CLIENT_CAPABILITIES,
          initializationOptions: server.initializationOptions,
        })
        .response.pipe(
          Effect.timeoutOrElse({
            duration: options.initializeTimeout,
            orElse: () => Effect.fail(null),
          }),
        );
      connection.notify("initialized", {});
      return { connection, capabilities: (init as Json)?.capabilities ?? {} };
    }).pipe(
      Scope.provide(processScope),
      Effect.map((value) => ({ ok: true as const, ...value })),
      Effect.orElseSucceed(() => ({ ok: false as const })),
      Effect.catchDefect(() => Effect.succeed({ ok: false as const })),
    );
    if (instance.generation !== generation) return;
    if (!started.ok) {
      // The exit watcher counts it as a crash when the process died; else it never came up.
      if (instance.running === null && instance.processScope === processScope) {
        instance.processScope = null;
        yield* Scope.close(processScope, Exit.void);
        yield* onCrash(instance, generation, "The language server did not start.");
      }
      return;
    }
    const running: Running = {
      generation,
      connection: started.connection,
      capabilities: started.capabilities,
      pull: started.capabilities?.diagnosticProvider != null,
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

  const instanceOf = Effect.fn("LanguageServers.instance")(function* (
    target: LanguageServerTarget,
  ) {
    const key = `${target.cwd}\0${target.server}`;
    const existing = instances.get(key);
    if (existing !== undefined) return existing;
    yield* knownWorkspaces
      .assertContains(target.cwd)
      .pipe(
        Effect.mapError((cause) =>
          failure("unsupported", "That folder is not a project here.", cause),
        ),
      );
    const again = instances.get(key);
    if (again !== undefined) return again;
    const instance: Instance = {
      key,
      cwd: target.cwd,
      spec: options.specs[target.server],
      lock: yield* Semaphore.make(1),
      scope: yield* Scope.fork(serviceScope),
      status: {
        cwd: target.cwd,
        server: target.server,
        name: "TypeScript",
        state: "starting",
        source: null,
        restricted: false,
        message: null,
        memoryBytes: null,
      },
      sessions: new Map(),
      docs: new Map(),
      pulls: yield* Queue.unbounded<GatewayDoc>(),
      running: null,
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

  const confirmDownload: LanguageServers["Service"]["confirmDownload"] = Effect.gen(function* () {
    yield* installer.consent.pipe(
      Effect.mapError((error) => failure("failed", error.message, error)),
    );
    for (const instance of instances.values()) {
      if (instance.status.state !== "download-needed") continue;
      yield* fork(instance.lock.withPermit(startProcess(instance)), instance.scope);
    }
  }).pipe(Effect.withSpan("LanguageServers.confirmDownload"));

  // The gateway -------------------------------------------------------------------------------

  const relativePathOf = (instance: Instance, uri: unknown): string | null => {
    if (typeof uri !== "string" || !uri.startsWith("file:")) return null;
    let absolute: string;
    try {
      absolute = NodeUrl.fileURLToPath(uri);
    } catch {
      return null;
    }
    const relative = path.relative(instance.cwd, absolute);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join("/");
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
    const relativePath = relativePathOf(instance, clientUri);
    const doc = relativePath === null ? undefined : instance.docs.get(relativePath);
    if (doc !== undefined && state !== undefined) {
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
    const request = running.connection.request(method, translated.params);
    pending.serverId = request.id;
    const answer = yield* request.response.pipe(
      Effect.map((result) => ({ ok: true as const, result: result as Json })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
    );
    if (!answer.ok) return { error: errorMessage(answer.error) };
    const mapped = mapAnswer(method, answer.result, doc, translated.context);
    if ("error" in mapped) return mapped;
    return {
      result:
        method === "textDocument/completion"
          ? mapped.result
          : toSessionUris(instance, session, mapped.result),
    };
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

  const diagnostics: LanguageServers["Service"]["diagnostics"] = Effect.fn(
    "LanguageServers.diagnostics",
  )(function* (input) {
    const match = languageServerForPath(input.relativePath);
    if (match === null) {
      return yield* failure("unsupported", "No language server reads this kind of file.");
    }
    const instance = yield* use({ cwd: input.cwd, server: match.server });
    const state = instance.status.state;
    if (state === "stopped") {
      return yield* failure(
        "not-running",
        "The language server was stopped; restart it in Astrolabe.",
      );
    }
    if (state === "download-needed") {
      return yield* failure(
        "download-needed",
        "The language server needs a download the user has to allow in Astrolabe first.",
      );
    }
    if (state === "failed")
      return yield* failure("failed", instance.status.message ?? "The language server failed.");
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
        yield* Deferred.await(instance.ready);
        yield* until(
          doc,
          () =>
            doc.loadId !== synced.loadId ||
            (doc.version >= synced.version &&
              doc.latest !== null &&
              doc.latest.version >= synced.version),
        );
        const latest = doc.latest ?? { version: doc.version, diagnostics: [] };
        const text = doc.texts.get(latest.version) ?? doc.texts.get(doc.version)!;
        // Pulled before the latest edits: carry them to the version reported.
        const items =
          latest.version === doc.version
            ? latest.diagnostics
            : mapDiagnostics(
                structuredClone(latest.diagnostics),
                forwardMapper(
                  text,
                  doc.texts.get(doc.version)!,
                  doc.updates
                    .slice(latest.version - doc.oldest)
                    .reduce(
                      (all, update) => all.compose(update.changes),
                      ChangeSet.empty(text.length),
                    ),
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
          path: input.relativePath,
          version: doc.version,
          diagnostics: listed,
          truncated: items.length > listed.length,
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
  });

  return LanguageServers.of({
    subscribe: SubscriptionRef.changes(statuses),
    restart,
    stop,
    confirmDownload,
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
  registry: DEFAULT_REGISTRY,
  trusted: () => Effect.succeed(true),
};

export const layerWith = (options: LanguageServersOptions) =>
  Layer.effect(LanguageServers, make(options));

export const layer = layerWith(defaultOptions);
