import { rebaseUpdates } from "@codemirror/collab";
import { ChangeSet, Text } from "@codemirror/state";
import {
  DOCUMENT_DISK_CLIENT_ID,
  DOCUMENT_MAX_LENGTH,
  type DocumentDiscardInput,
  DocumentError,
  type DocumentPushInput,
  type DocumentPushResult,
  type DocumentRecoverInput,
  type DocumentRecoverResult,
  type DocumentReplaceAllInput,
  type DocumentReplaceAllResult,
  type DocumentSaveInput,
  type DocumentSaveResult,
  type DocumentStreamItem,
  type DocumentSubscribeInput,
  type DocumentTarget,
  type DocumentUndoReplaceAllInput,
  type DocumentUndoReplaceAllResult,
} from "@t3tools/contracts";
import {
  madeReplacements,
  type MadeReplacement,
  replacementsIn,
  textMatcher,
  undoReplacements,
} from "@t3tools/shared/textReplace";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import diff from "fast-diff";

import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export const SAVE_DELAY = Duration.millis(500);
export const IDLE_TIMEOUT = Duration.minutes(5);
/** How long a replace-all can be undone; its files stay open until then. */
export const REPLACE_ALL_UNDO_TIMEOUT = Duration.minutes(30);
// Writers that truncate then write, or write in chunks, report each step; read once they stop.
export const DISK_QUIET = Duration.millis(75);
export const settled = <A, E, R>(reports: Stream.Stream<A, E, R>) =>
  reports.pipe(Stream.debounce(DISK_QUIET));

/**
 * The environment's copy of each open repository file, kept with `@codemirror/collab`'s
 * authority loop: one version history per file, updates against an older version are rebased
 * over the ones accepted since, and every subscriber receives every accepted update.
 */
export class Documents extends Context.Service<
  Documents,
  {
    /** The current text, then accepted updates. The document stays open while any stream runs. */
    readonly subscribe: (
      input: DocumentSubscribeInput,
    ) => Stream.Stream<DocumentStreamItem, DocumentError>;
    readonly push: (input: DocumentPushInput) => Effect.Effect<DocumentPushResult, DocumentError>;
    /** Writes now; also recreates a file that was removed from disk. */
    readonly save: (input: DocumentSaveInput) => Effect.Effect<DocumentSaveResult, DocumentError>;
    readonly recover: (
      input: DocumentRecoverInput,
    ) => Effect.Effect<DocumentRecoverResult, DocumentError>;
    /** Drops the edits that are not on disk; a document whose file is gone closes. */
    readonly discard: (input: DocumentDiscardInput) => Effect.Effect<void, DocumentError>;
    /**
     * Reads an open document's file now rather than after the watcher's quiet period, so a write
     * made just before lands first. The version after it, for callers holding a subscription.
     */
    readonly sync: (
      input: DocumentTarget,
    ) => Effect.Effect<{ readonly loadId: string; readonly version: number }, DocumentError>;
    /** Each file a document writes to disk, as it writes it; `created` when it wasn't there. */
    readonly writes: Stream.Stream<DocumentWrite>;
    /**
     * Replaces a search's matches in each file's live text, as one update per file under the
     * caller's client id; a file nobody has open is saved at once. Keeps the inverses for one
     * `undoReplaceAll`, the caller's latest only, until it expires.
     */
    readonly replaceAll: (
      input: DocumentReplaceAllInput,
    ) => Effect.Effect<DocumentReplaceAllResult, DocumentError>;
    /** Takes a replace-all back, carried over every edit made since. */
    readonly undoReplaceAll: (
      input: DocumentUndoReplaceAllInput,
    ) => Effect.Effect<DocumentUndoReplaceAllResult, DocumentError>;
    /** The open documents of a checkout whose text differs from disk, for searching. */
    readonly unsavedTexts: (
      cwd: string,
    ) => Effect.Effect<ReadonlyArray<{ readonly relativePath: string; readonly text: string }>>;
  }
>()("t3/documents/Documents") {}

export interface DocumentWrite extends DocumentTarget {
  readonly created: boolean;
}

interface AcceptedUpdate {
  readonly clientID: string;
  readonly changes: ChangeSet;
}

interface ReplacedFile {
  readonly document: LoadedDocument;
  /** The version right after the replacement. */
  readonly version: number;
  readonly made: readonly MadeReplacement[];
}

interface ReplaceAllRecord {
  readonly id: string;
  readonly clientId: string;
  readonly files: ReadonlyArray<ReplacedFile>;
}

interface ResolvedTarget extends DocumentTarget {
  readonly key: string;
  readonly absolutePath: string;
}

interface LoadedDocument {
  readonly target: ResolvedTarget;
  readonly loadId: string;
  readonly scope: Scope.Closeable;
  readonly events: PubSub.PubSub<DocumentStreamItem>;
  /** Every update accepted since load; the version is its length. */
  readonly updates: Array<AcceptedUpdate>;
  doc: Text;
  /** The file on disk as last read or written, line breaks normalized to `\n`. */
  diskText: string;
  /** Turns `diskText` into `doc`. */
  unsaved: ChangeSet;
  lineSeparator: string;
  savedVersion: number;
  missing: boolean;
  subscribers: number;
  saveGeneration: number;
  idleGeneration: number;
}

const lineBreak = /\r\n?|\n/;

const normalizeLineBreaks = (text: string) => text.split(lineBreak).join("\n");

/** The edits that turn `from` into `to`, as a change set over `from`. */
const textChanges = (from: string, to: string): ChangeSet => {
  const specs: Array<{ from: number; to: number; insert: string }> = [];
  let index = 0;
  let pending: { from: number; to: number; insert: string } | null = null;
  for (const [op, chunk] of diff(from, to, undefined, true)) {
    if (op === diff.EQUAL) {
      if (pending) specs.push(pending);
      pending = null;
      index += chunk.length;
      continue;
    }
    pending ??= { from: index, to: index, insert: "" };
    if (op === diff.DELETE) {
      index += chunk.length;
      pending.to = index;
    } else {
      pending.insert += chunk;
    }
  }
  if (pending) specs.push(pending);
  return ChangeSet.of(specs, from.length);
};

const toWire = (update: AcceptedUpdate) => ({
  clientId: update.clientID,
  changes: update.changes.toJSON(),
});

const diskState = (document: LoadedDocument) => ({
  savedVersion: document.savedVersion,
  missing: document.missing,
});

/** Edits that exist only here: a deleted file's document keeps them until saved or discarded. */
const strandedEdits = (document: LoadedDocument) =>
  document.missing && document.savedVersion < document.updates.length;

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;

  const serviceScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  // Every operation on a document holds its key, so the fields of a loaded document change
  // only under this lock. Not reentrant: the `...Locked` helpers assume the caller holds it.
  const lock = yield* KeyedLock.make<string>();
  const documents = new Map<string, LoadedDocument>();
  const writes = yield* Effect.acquireRelease(PubSub.unbounded<DocumentWrite>(), PubSub.shutdown);
  const isCurrent = (document: LoadedDocument) => documents.get(document.target.key) === document;

  const fail = (reason: DocumentError["reason"], relativePath: string, cause?: unknown) =>
    new DocumentError({ reason, relativePath, ...(cause === undefined ? {} : { cause }) });

  const fileError =
    (relativePath: string) =>
    (
      cause:
        | WorkspaceFileSystem.WorkspaceFileSystemError
        | WorkspacePaths.WorkspacePathOutsideRootError
        | KnownWorkspaces.UnknownWorkspaceError,
    ) => {
      switch (cause._tag) {
        case "WorkspaceBinaryFileError":
          return fail("not-text", relativePath, cause);
        case "WorkspacePathNotFileError":
          return fail("not-found", relativePath, cause);
        case "WorkspaceFileSystemOperationError":
          return fail("io", relativePath, cause);
        default:
          return fail("outside-workspace", relativePath, cause);
      }
    };

  const resolveTarget = Effect.fn("Documents.resolveTarget")(function* (input: DocumentTarget) {
    const resolved = yield* workspacePaths
      .resolveRelativePathWithinRoot({ workspaceRoot: input.cwd, relativePath: input.relativePath })
      .pipe(Effect.mapError(fileError(input.relativePath)));
    return {
      cwd: input.cwd,
      relativePath: resolved.relativePath,
      key: resolved.absolutePath,
      absolutePath: resolved.absolutePath,
    } satisfies ResolvedTarget;
  });

  /** `null` when the file is gone. */
  const readDisk = Effect.fn("Documents.readDisk")(function* (target: ResolvedTarget) {
    const result = yield* workspaceFileSystem
      .readFile({ cwd: target.cwd, relativePath: target.relativePath, allowMissing: true })
      .pipe(Effect.mapError(fileError(target.relativePath)));
    if (result.exists === false) return null;
    if (result.truncated) return yield* fail("too-large", target.relativePath);
    return result.contents;
  });

  const publish = (document: LoadedDocument, item: DocumentStreamItem) =>
    PubSub.publish(document.events, item).pipe(Effect.asVoid);

  const publishDisk = (document: LoadedDocument) =>
    publish(document, { type: "disk", ...diskState(document) });

  const acceptLocked = (document: LoadedDocument, accepted: ReadonlyArray<AcceptedUpdate>) => {
    const version = document.updates.length;
    for (const update of accepted) {
      document.doc = update.changes.apply(document.doc);
      document.unsaved = document.unsaved.compose(update.changes);
      document.updates.push(update);
    }
    return Effect.andThen(
      publish(document, { type: "updates", version, updates: accepted.map(toWire) }),
      scheduleSave(document),
    );
  };

  /** Lands what changed on disk since the last read or write as one `disk` update. */
  const syncLocked = Effect.fn("Documents.sync")(function* (document: LoadedDocument) {
    const raw = yield* readDisk(document.target);
    if (raw === null) {
      if (document.missing) return;
      document.missing = true;
      return yield* publishDisk(document);
    }
    const wasMissing = document.missing;
    document.missing = false;
    document.lineSeparator = raw.includes("\r\n") ? "\r\n" : "\n";
    const text = normalizeLineBreaks(raw);
    if (text === document.diskText) {
      if (wasMissing) yield* publishDisk(document);
      return;
    }
    if (text === document.doc.toString()) {
      document.diskText = text;
      document.unsaved = ChangeSet.empty(document.doc.length);
      document.savedVersion = document.updates.length;
      return yield* publishDisk(document);
    }
    const external = textChanges(document.diskText, text);
    const changes = external.map(document.unsaved, true);
    document.unsaved = document.unsaved.map(external);
    document.diskText = text;
    const version = document.updates.length;
    const update = { clientID: DOCUMENT_DISK_CLIENT_ID, changes };
    document.doc = changes.apply(document.doc);
    document.updates.push(update);
    yield* publish(document, { type: "updates", version, updates: [toWire(update)] });
    if (document.unsaved.empty) {
      document.savedVersion = document.updates.length;
      yield* publishDisk(document);
    } else {
      yield* scheduleSave(document);
    }
  });

  /**
   * Reads disk first, so a newer file is merged in rather than overwritten. A write landing
   * between that read and ours is the one race left. A removed file stays removed unless
   * the save was asked for.
   */
  const flushLocked = Effect.fn("Documents.flush")(function* (
    document: LoadedDocument,
    explicit: boolean,
  ) {
    yield* syncLocked(document);
    if (document.missing && !explicit) return;
    const text = document.doc.toString();
    if (!document.missing && text === document.diskText) {
      if (document.savedVersion === document.updates.length) return;
      document.savedVersion = document.updates.length;
      return yield* publishDisk(document);
    }
    yield* workspaceFileSystem
      .writeFile({
        cwd: document.target.cwd,
        relativePath: document.target.relativePath,
        contents: document.doc.sliceString(0, document.doc.length, document.lineSeparator),
      })
      .pipe(Effect.mapError(fileError(document.target.relativePath)));
    yield* PubSub.publish(writes, {
      cwd: document.target.cwd,
      relativePath: document.target.relativePath,
      created: document.missing,
    });
    document.diskText = text;
    document.unsaved = ChangeSet.empty(document.doc.length);
    document.savedVersion = document.updates.length;
    document.missing = false;
    yield* publishDisk(document);
  });

  /** Runs `effect` under the document's lock if it is still the loaded one. */
  const whileCurrent = <E>(document: LoadedDocument, effect: Effect.Effect<void, E>) =>
    lock.withLock(
      document.target.key,
      Effect.suspend(() => (isCurrent(document) ? effect : Effect.void)),
    );

  /** Runs `effect` under the document's lock; fails with `not-loaded` once it was closed. */
  const whileCurrentResult = <A, E>(
    document: LoadedDocument,
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | DocumentError> =>
    lock.withLock(
      document.target.key,
      Effect.suspend((): Effect.Effect<A, E | DocumentError> =>
        isCurrent(document)
          ? effect
          : Effect.fail(fail("not-loaded", document.target.relativePath)),
      ),
    );

  // Annotated: saving and syncing schedule each other.
  const scheduleSave = (document: LoadedDocument): Effect.Effect<void> => {
    const generation = ++document.saveGeneration;
    return Effect.sleep(SAVE_DELAY).pipe(
      Effect.andThen(
        whileCurrent(
          document,
          Effect.suspend(() =>
            generation === document.saveGeneration ? flushLocked(document, false) : Effect.void,
          ),
        ),
      ),
      Effect.ignore({ log: "Warn", message: "Saving an open document failed." }),
      Effect.forkIn(document.scope, { startImmediately: true }),
      Effect.asVoid,
    );
  };

  const scheduleEviction = (document: LoadedDocument): Effect.Effect<void> => {
    const generation = ++document.idleGeneration;
    return Effect.sleep(IDLE_TIMEOUT).pipe(
      Effect.andThen(
        whileCurrent(
          document,
          Effect.suspend(() =>
            document.subscribers === 0 && generation === document.idleGeneration
              ? evictLocked(document)
              : Effect.void,
          ),
        ),
      ),
      Effect.forkIn(serviceScope, { startImmediately: true }),
      Effect.asVoid,
    );
  };

  const evictLocked = Effect.fn("Documents.evict")(function* (document: LoadedDocument) {
    const saved = yield* flushLocked(document, false).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        Effect.logWarning("Saving a document before closing it failed; keeping it open.", {
          reason: error.reason,
        }).pipe(Effect.as(false)),
      ),
    );
    if (!saved || strandedEdits(document)) return yield* scheduleEviction(document);
    yield* closeLocked(document);
  });

  const closeLocked = Effect.fn("Documents.close")(function* (document: LoadedDocument) {
    documents.delete(document.target.key);
    yield* PubSub.shutdown(document.events);
    yield* Scope.close(document.scope, Exit.void);
  });

  const watch = (document: LoadedDocument) => {
    const name = path.basename(document.target.absolutePath);
    return fileSystem.watch(path.dirname(document.target.absolutePath)).pipe(
      Stream.filter((event) => path.basename(event.path) === name),
      settled,
      Stream.runForEach(() =>
        whileCurrent(document, syncLocked(document)).pipe(
          Effect.ignore({ log: "Warn", message: "Reading a changed document failed." }),
        ),
      ),
      Effect.ignore({ log: "Warn", message: "Watching an open document failed." }),
      Effect.forkIn(document.scope, { startImmediately: true }),
    );
  };

  const load = Effect.fn("Documents.load")(function* (target: ResolvedTarget) {
    yield* knownWorkspaces
      .assertContains(target.cwd)
      .pipe(Effect.mapError(fileError(target.relativePath)));
    const raw = yield* readDisk(target);
    if (raw === null) return yield* fail("not-found", target.relativePath);
    const text = normalizeLineBreaks(raw);
    const doc = Text.of(text.split("\n"));
    const document: LoadedDocument = {
      target,
      loadId: yield* crypto.randomUUIDv4().pipe(Effect.orDie),
      scope: yield* Scope.fork(serviceScope),
      events: yield* PubSub.unbounded<DocumentStreamItem>(),
      updates: [],
      doc,
      diskText: text,
      unsaved: ChangeSet.empty(doc.length),
      lineSeparator: raw.includes("\r\n") ? "\r\n" : "\n",
      savedVersion: 0,
      missing: false,
      subscribers: 0,
      saveGeneration: 0,
      idleGeneration: 0,
    };
    yield* watch(document);
    return document;
  });

  const loaded = (target: ResolvedTarget, loadId: string) => {
    const document = documents.get(target.key);
    return document !== undefined && document.loadId === loadId
      ? Effect.succeed(document)
      : Effect.fail(fail("not-loaded", target.relativePath));
  };

  const release = (document: LoadedDocument) =>
    whileCurrent(
      document,
      Effect.suspend(() => {
        document.subscribers -= 1;
        return document.subscribers === 0 ? scheduleEviction(document) : Effect.void;
      }),
    );

  const subscribe: Documents["Service"]["subscribe"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const target = yield* resolveTarget(input);
        const [first, subscription] = yield* lock.withLock(
          target.key,
          Effect.gen(function* () {
            let document = documents.get(target.key);
            if (document === undefined) {
              document = yield* load(target);
              documents.set(target.key, document);
            }
            const held = document;
            held.subscribers += 1;
            held.idleGeneration += 1;
            yield* Effect.addFinalizer(() => release(held));
            const subscription = yield* PubSub.subscribe(held.events);
            const version = held.updates.length;
            const resume = input.resume;
            const first: DocumentStreamItem =
              resume !== undefined && resume.loadId === held.loadId && resume.version <= version
                ? {
                    type: "resumed",
                    loadId: held.loadId,
                    version: resume.version,
                    updates: held.updates.slice(resume.version).map(toWire),
                    ...diskState(held),
                  }
                : {
                    type: "snapshot",
                    loadId: held.loadId,
                    version,
                    text: held.doc.toString(),
                    ...diskState(held),
                  };
            return [first, subscription] as const;
          }),
        );
        return Stream.concat(Stream.make(first), Stream.fromSubscription(subscription));
      }),
    );

  const reservedClientId = (clientId: string) => clientId === DOCUMENT_DISK_CLIENT_ID;

  const push: Documents["Service"]["push"] = Effect.fn("Documents.push")(function* (input) {
    const target = yield* resolveTarget(input);
    return yield* lock.withLock(
      target.key,
      Effect.gen(function* () {
        const document = yield* loaded(target, input.loadId);
        const accepted = yield* Effect.try({
          try: () => {
            if (input.version > document.updates.length) throw new RangeError("Future version");
            const incoming = input.updates.map((update) => {
              if (reservedClientId(update.clientId)) throw new RangeError("Reserved client id");
              return { clientID: update.clientId, changes: ChangeSet.fromJSON(update.changes) };
            });
            const rebased = rebaseUpdates(incoming, document.updates.slice(input.version));
            let length = document.doc.length;
            for (const update of rebased) {
              if (update.changes.length !== length) throw new RangeError("Length mismatch");
              length = update.changes.newLength;
            }
            return { updates: rebased, length };
          },
          catch: (cause) => fail("invalid-update", target.relativePath, cause),
        });
        if (accepted.length > DOCUMENT_MAX_LENGTH) {
          return yield* fail("too-large", target.relativePath);
        }
        if (accepted.updates.length > 0) yield* acceptLocked(document, accepted.updates);
        return { version: document.updates.length };
      }),
    );
  });

  const save: Documents["Service"]["save"] = Effect.fn("Documents.save")(function* (input) {
    const target = yield* resolveTarget(input);
    return yield* lock.withLock(
      target.key,
      Effect.gen(function* () {
        const document = yield* loaded(target, input.loadId);
        yield* flushLocked(document, true);
        return { savedVersion: document.savedVersion };
      }),
    );
  });

  /**
   * Reconnect after eviction. The client has subscribed to the new load and sends the text
   * it started from (`baseText`) and its text now. If disk still holds `baseText`, its edits
   * land as one update under its id; otherwise nothing changes and it gets a conflict.
   */
  const recover: Documents["Service"]["recover"] = Effect.fn("Documents.recover")(
    function* (input) {
      const target = yield* resolveTarget(input);
      if (reservedClientId(input.clientId)) {
        return yield* fail("invalid-update", target.relativePath);
      }
      return yield* lock.withLock(
        target.key,
        Effect.gen(function* () {
          const document = yield* loaded(target, input.loadId);
          yield* syncLocked(document);
          const base = normalizeLineBreaks(input.baseText);
          if (document.missing || base !== document.diskText) {
            return { type: "conflict" as const };
          }
          const changes = textChanges(base, normalizeLineBreaks(input.text)).map(document.unsaved);
          if (changes.newLength > DOCUMENT_MAX_LENGTH) {
            return yield* fail("too-large", target.relativePath);
          }
          if (!changes.empty) {
            yield* acceptLocked(document, [{ clientID: input.clientId, changes }]);
          }
          return { type: "accepted" as const, version: document.updates.length };
        }),
      );
    },
  );

  const discard: Documents["Service"]["discard"] = Effect.fn("Documents.discard")(
    function* (input) {
      const target = yield* resolveTarget(input);
      return yield* lock.withLock(
        target.key,
        Effect.gen(function* () {
          const document = yield* loaded(target, input.loadId);
          yield* syncLocked(document);
          if (document.missing) return yield* closeLocked(document);
          const text = document.doc.toString();
          if (text === document.diskText) return;
          const version = document.updates.length;
          const update = {
            clientID: DOCUMENT_DISK_CLIENT_ID,
            changes: textChanges(text, document.diskText),
          };
          document.doc = update.changes.apply(document.doc);
          document.updates.push(update);
          document.unsaved = ChangeSet.empty(document.doc.length);
          document.savedVersion = document.updates.length;
          yield* publish(document, { type: "updates", version, updates: [toWire(update)] });
          yield* publishDisk(document);
        }),
      );
    },
  );

  const sync: Documents["Service"]["sync"] = Effect.fn("Documents.syncNow")(function* (input) {
    const target = yield* resolveTarget(input);
    return yield* lock.withLock(
      target.key,
      Effect.gen(function* () {
        const document = documents.get(target.key);
        if (document === undefined) return yield* fail("not-loaded", target.relativePath);
        yield* syncLocked(document);
        return { loadId: document.loadId, version: document.updates.length };
      }),
    );
  });

  // The latest replace-all of each client, by id; each holds its files open.
  const replaceAlls = new Map<string, ReplaceAllRecord>();

  const dropReplaceAll = (record: ReplaceAllRecord) =>
    Effect.suspend(() => {
      if (replaceAlls.get(record.id) !== record) return Effect.void;
      replaceAlls.delete(record.id);
      return Effect.forEach(record.files, (file) => release(file.document), { discard: true });
    });

  /** Applies one client edit made on the server; a document nobody else has open saves now. */
  const editLocked = Effect.fn("Documents.edit")(function* (
    document: LoadedDocument,
    clientId: string,
    changes: ChangeSet,
    holders: number,
  ) {
    if (changes.newLength > DOCUMENT_MAX_LENGTH) {
      return yield* fail("too-large", document.target.relativePath);
    }
    yield* acceptLocked(document, [{ clientID: clientId, changes }]);
    if (document.subscribers <= holders) yield* flushLocked(document, false);
  });

  const replaceAll: Documents["Service"]["replaceAll"] = Effect.fn("Documents.replaceAll")(
    function* (input) {
      if (reservedClientId(input.clientId)) return yield* fail("invalid-update", "");
      const matcher = textMatcher(input);
      if (matcher.error !== null) return yield* fail("invalid-query", "");
      for (const previous of replaceAlls.values()) {
        if (previous.clientId === input.clientId) yield* dropReplaceAll(previous);
      }
      const files: ReplacedFile[] = [];
      const failed: Array<{ relativePath: string; message: string }> = [];
      let replacements = 0;
      for (const relativePath of new Set(input.paths)) {
        const result = yield* Effect.gen(function* () {
          const target = yield* resolveTarget({ cwd: input.cwd, relativePath });
          return yield* lock.withLock(
            target.key,
            Effect.gen(function* () {
              let document = documents.get(target.key);
              if (document === undefined) {
                document = yield* load(target);
                documents.set(target.key, document);
              }
              const text = document.doc.toString();
              const found = replacementsIn(text, matcher, input.replacement);
              if (found.length === 0) {
                if (document.subscribers === 0) yield* scheduleEviction(document);
                return null;
              }
              const changes = ChangeSet.of(found, document.doc.length);
              const made = madeReplacements(text, found);
              // The record's hold keeps the document, and the history its undo maps through.
              document.subscribers += 1;
              document.idleGeneration += 1;
              yield* editLocked(document, input.clientId, changes, 1);
              return { document, version: document.updates.length, made, count: found.length };
            }),
          );
        }).pipe(
          Effect.catch((error: DocumentError) =>
            Effect.sync(() => {
              failed.push({ relativePath, message: error.message });
              return null;
            }),
          ),
        );
        if (result === null) continue;
        files.push({ document: result.document, version: result.version, made: result.made });
        replacements += result.count;
      }
      if (files.length === 0) return { files: 0, replacements, failed };
      const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
      const record: ReplaceAllRecord = { id, clientId: input.clientId, files };
      replaceAlls.set(id, record);
      yield* Effect.sleep(REPLACE_ALL_UNDO_TIMEOUT).pipe(
        Effect.andThen(dropReplaceAll(record)),
        Effect.forkIn(serviceScope, { startImmediately: true }),
      );
      return { id, files: files.length, replacements, failed };
    },
  );

  const undoReplaceAll: Documents["Service"]["undoReplaceAll"] = Effect.fn(
    "Documents.undoReplaceAll",
  )(function* (input) {
    const record = replaceAlls.get(input.id);
    if (record === undefined || record.files[0]?.document.target.cwd !== input.cwd) {
      return yield* fail("undo-gone", "");
    }
    const skipped: string[] = [];
    let undone = 0;
    for (const file of record.files) {
      const { document } = file;
      const done = yield* whileCurrentResult(
        document,
        Effect.gen(function* () {
          const later = document.updates
            .slice(file.version)
            .map((update) => update.changes)
            .reduce<ChangeSet | null>((all, changes) => all?.compose(changes) ?? changes, null);
          // A replacement edited or taken back since stays as it is: mapping it would insert twice.
          const undo = undoReplacements(file.made, document.doc, (pos, assoc) =>
            later === null ? pos : later.mapPos(pos, assoc),
          );
          if (undo.changes.length === 0) return false;
          const changes = ChangeSet.of(undo.changes, document.doc.length);
          yield* editLocked(document, record.clientId, changes, 1);
          return true;
        }),
      ).pipe(Effect.orElseSucceed(() => false));
      if (done) undone += 1;
      else skipped.push(document.target.relativePath);
    }
    yield* dropReplaceAll(record);
    return { files: undone, skipped };
  });

  const unsavedTexts: Documents["Service"]["unsavedTexts"] = (cwd) =>
    Effect.sync(() => {
      const root = path.resolve(cwd);
      return [...documents.values()].flatMap((document) =>
        path.resolve(document.target.cwd) === root && !document.unsaved.empty
          ? [{ relativePath: document.target.relativePath, text: document.doc.toString() }]
          : [],
      );
    });

  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      [...documents.values()],
      (document) =>
        whileCurrent(document, flushLocked(document, false)).pipe(
          Effect.ignore({ log: "Warn", message: "Saving an open document at shutdown failed." }),
        ),
      { discard: true },
    ),
  );

  return Documents.of({
    subscribe,
    push,
    save,
    recover,
    discard,
    sync,
    writes: Stream.fromPubSub(writes),
    replaceAll,
    undoReplaceAll,
    unsavedTexts,
  });
});

export const layer = Layer.effect(Documents, make);
