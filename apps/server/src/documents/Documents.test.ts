import { getSyncedVersion, receiveUpdates, sendableUpdates, collab } from "@codemirror/collab";
import { ChangeSet, EditorState, type ChangeSpec } from "@codemirror/state";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { DocumentError, DocumentStreamItem, DocumentTarget } from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as Documents from "./Documents.ts";

const layerWorkspaceEntries = WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer));
const layerKnownWorkspaces = Layer.mock(KnownWorkspaces.KnownWorkspaces)({
  assertContains: () => Effect.void,
});

const layerTest = Documents.layer.pipe(
  Layer.provide(
    WorkspaceFileSystem.layer.pipe(
      Layer.provide(layerWorkspaceEntries),
      Layer.provide(layerKnownWorkspaces),
    ),
  ),
  Layer.provide(layerKnownWorkspaces),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-documents-" })),
  Layer.provideMerge(NodeServices.layer),
);

const RELATIVE_PATH = "src/notes.txt";

type Workspace = Effect.Success<ReturnType<typeof makeWorkspace>>;

/** A workspace with one file, and watch events the test sends by hand. */
const makeWorkspace = Effect.fn("makeWorkspace")(function* (contents: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-documents-" });
  const absolutePath = path.join(cwd, RELATIVE_PATH);
  yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
  yield* fileSystem.writeFileString(absolutePath, contents);
  const watchEvents = yield* Queue.unbounded<FileSystem.WatchEvent>();
  const target: DocumentTarget = { cwd, relativePath: RELATIVE_PATH };
  return {
    target,
    readDisk: fileSystem.readFileString(absolutePath),
    /** What an agent or another program does: write the file behind the service's back. */
    writeDisk: (text: string) => fileSystem.writeFileString(absolutePath, text),
    removeDisk: fileSystem.remove(absolutePath),
    /** What the OS watcher reports after such a write. */
    notify: Queue.offer(watchEvents, { _tag: "Update", path: path.basename(absolutePath) }),
    watchBackend: FileSystem.WatchBackend.of({
      register: () => Option.some(Stream.fromQueue(watchEvents)),
    }),
  };
});

const withWorkspace = <A, E, R>(
  contents: string,
  body: (workspace: Workspace) => Effect.Effect<A, E, R>,
) =>
  Effect.flatMap(makeWorkspace(contents), (workspace) =>
    body(workspace).pipe(Effect.provideService(FileSystem.WatchBackend, workspace.watchBackend)),
  );

type Resume = { readonly loadId: string; readonly version: number };

const fromWire = (updates: ReadonlyArray<{ clientId: string; changes: unknown }>) =>
  updates.map((update) => ({
    clientID: update.clientId,
    changes: ChangeSet.fromJSON(update.changes),
  }));

/** Subscribes and returns the first item; the rest wait in `items`. */
const open = Effect.fn("open")(function* (target: DocumentTarget, resume?: Resume) {
  const documents = yield* Documents.Documents;
  const items = yield* Queue.unbounded<DocumentStreamItem, Cause.Done | DocumentError>();
  const fiber = yield* documents
    .subscribe({ ...target, ...(resume ? { resume } : {}) })
    .pipe(Stream.runIntoQueue(items), Effect.forkChild);
  const first = yield* Queue.take(items);
  return { documents, items, fiber, first };
});

type Connection = Effect.Success<ReturnType<typeof open>>;

/** An in-process editor speaking `@codemirror/collab` to the service. */
class CollabClient {
  readonly disk: Array<{ savedVersion: number; missing: boolean }> = [];
  private readonly target: DocumentTarget;
  private connection: Connection;
  loadId: string;
  state: EditorState;

  constructor(target: DocumentTarget, connection: Connection, loadId: string, state: EditorState) {
    this.target = target;
    this.connection = connection;
    this.loadId = loadId;
    this.state = state;
  }

  text(): string {
    return this.state.doc.toString();
  }

  edit(changes: ChangeSpec): void {
    this.state = this.state.update({ changes }).state;
  }

  sendable() {
    return sendableUpdates(this.state).map((update) => ({
      clientId: update.clientID,
      changes: update.changes.toJSON(),
    }));
  }

  push() {
    return this.connection.documents.push({
      ...this.target,
      loadId: this.loadId,
      version: getSyncedVersion(this.state),
      updates: this.sendable(),
    });
  }

  receive(item: DocumentStreamItem): void {
    switch (item.type) {
      case "updates":
      case "resumed":
        expect(item.version).toBe(getSyncedVersion(this.state));
        this.state = receiveUpdates(this.state, fromWire(item.updates)).state;
        if (item.type === "resumed") this.loadId = item.loadId;
        return;
      case "disk":
        this.disk.push({ savedVersion: item.savedVersion, missing: item.missing });
        return;
      case "snapshot":
        // A new load: the client keeps its text and recovers it with `recover`.
        this.loadId = item.loadId;
        return;
    }
  }

  get next(): Effect.Effect<DocumentStreamItem, Cause.Done | DocumentError> {
    return Queue.take(this.connection.items).pipe(
      Effect.tap((item) => Effect.sync(() => this.receive(item))),
    );
  }

  /** Applies stream items until the client has seen `version`. */
  syncTo(version: number): Effect.Effect<void, Cause.Done | DocumentError> {
    return Effect.whileLoop({
      while: () => getSyncedVersion(this.state) < version,
      body: () => this.next,
      step: () => {},
    });
  }

  /** Applies stream items until a disk item arrives, and returns it. */
  get nextDisk(): Effect.Effect<
    { savedVersion: number; missing: boolean },
    Cause.Done | DocumentError
  > {
    const seen = this.disk.length;
    return Effect.whileLoop({
      while: () => this.disk.length === seen,
      body: () => this.next,
      step: () => {},
    }).pipe(Effect.map(() => this.disk[this.disk.length - 1]!));
  }

  get leave(): Effect.Effect<void> {
    return Fiber.interrupt(this.connection.fiber);
  }

  /** Subscribes again, asking to resume where it left off. */
  get reconnect() {
    return open(this.target, {
      loadId: this.loadId,
      version: getSyncedVersion(this.state),
    }).pipe(
      Effect.map((connection) => {
        this.connection = connection;
        this.receive(connection.first);
        return connection.first;
      }),
    );
  }
}

const connect = Effect.fn("connect")(function* (target: DocumentTarget, clientID: string) {
  const connection = yield* open(target);
  if (connection.first.type !== "snapshot") throw new Error("Expected a snapshot");
  return new CollabClient(
    target,
    connection,
    connection.first.loadId,
    EditorState.create({
      doc: connection.first.text,
      extensions: collab({ startVersion: connection.first.version, clientID }),
    }),
  );
});

it.layer(layerTest)("Documents", (it) => {
  describe("editing", () => {
    it.effect("rebases a stale push over the updates it missed, so both editors agree", () =>
      withWorkspace("one\ntwo\nthree\n", (workspace) =>
        Effect.gen(function* () {
          const a = yield* connect(workspace.target, "a");
          const b = yield* connect(workspace.target, "b");

          a.edit({ from: 0, insert: "A" });
          b.edit({ from: 14, insert: "B" });
          b.edit({ from: 4, to: 7, insert: "TWO" });
          expect(yield* a.push()).toEqual({ version: 1 });
          // B never saw A's update; its two updates are rebased over it.
          expect(yield* b.push()).toEqual({ version: 3 });

          yield* a.syncTo(3);
          yield* b.syncTo(3);
          expect(a.text()).toBe("Aone\nTWO\nthree\nB");
          expect(b.text()).toBe(a.text());
          expect(sendableUpdates(a.state)).toHaveLength(0);
          expect(sendableUpdates(b.state)).toHaveLength(0);
        }),
      ),
    );

    it.effect("drops a retransmitted push and refuses pushes that do not fit", () =>
      withWorkspace("abc", (workspace) =>
        Effect.gen(function* () {
          const documents = yield* Documents.Documents;
          const a = yield* connect(workspace.target, "a");
          const b = yield* connect(workspace.target, "b");

          for (const letter of ["1", "2", "3"]) {
            a.edit({ from: a.state.doc.length, insert: letter });
            yield* a.push();
            yield* a.syncTo(getSyncedVersion(a.state) + 1);
          }
          b.edit({ from: 0, insert: "x" });
          const stale = {
            ...workspace.target,
            loadId: b.loadId,
            version: 0,
            updates: b.sendable(),
          };
          expect(yield* documents.push(stale)).toEqual({ version: 4 });
          // The reply was lost; B sends the same update again.
          expect(yield* documents.push(stale)).toEqual({ version: 4 });

          yield* a.syncTo(4);
          yield* b.syncTo(4);
          expect(a.text()).toBe("xabc123");
          expect(b.text()).toBe(a.text());

          const future = yield* documents.push({ ...stale, version: 9 }).pipe(Effect.flip);
          expect(future.reason).toBe("invalid-update");
          const tooLong = yield* documents
            .push({
              ...stale,
              version: 4,
              updates: [{ clientId: "b", changes: ChangeSet.of([], 99).toJSON() }],
            })
            .pipe(Effect.flip);
          expect(tooLong.reason).toBe("invalid-update");
          const spoofed = yield* documents
            .push({ ...stale, version: 4, updates: [{ ...stale.updates[0]!, clientId: "disk" }] })
            .pipe(Effect.flip);
          expect(spoofed.reason).toBe("invalid-update");
          const otherLoad = yield* documents
            .push({ ...stale, loadId: "not-this-load" })
            .pipe(Effect.flip);
          expect(otherLoad.reason).toBe("not-loaded");
        }),
      ),
    );

    it.effect("a client that reconnects while the document is open catches up and rebases", () =>
      withWorkspace("abc", (workspace) =>
        Effect.gen(function* () {
          const a = yield* connect(workspace.target, "a");
          const b = yield* connect(workspace.target, "b");

          a.edit({ from: 0, insert: "1" });
          yield* a.push();
          // A drops before it hears back, and keeps typing offline.
          yield* a.leave;
          a.edit({ from: 4, insert: "2" });
          b.edit({ from: 2, insert: "b" });
          yield* b.push();

          const resumed = yield* a.reconnect;
          expect(resumed.type).toBe("resumed");
          // Its first update came back as its own; only the offline one is left to send.
          expect(sendableUpdates(a.state)).toHaveLength(1);
          expect(yield* a.push()).toEqual({ version: 3 });

          yield* a.syncTo(3);
          yield* b.syncTo(3);
          expect(a.text()).toBe("1abbc2");
          expect(b.text()).toBe(a.text());
        }),
      ),
    );
  });

  describe("disk", () => {
    it.effect("lands an outside write as one disk update merged with unsaved edits", () =>
      withWorkspace("one\ntwo\nthree\n", (workspace) =>
        Effect.gen(function* () {
          const a = yield* connect(workspace.target, "a");
          a.edit({ from: 0, to: 3, insert: "ONE" });
          yield* a.push();
          yield* a.syncTo(1);

          yield* workspace.writeDisk("one\ntwo\nthree\nfour\n");
          yield* workspace.notify;
          const update = yield* a.next;
          expect(update).toMatchObject({
            type: "updates",
            version: 1,
            updates: [{ clientId: "disk" }],
          });
          expect(a.text()).toBe("ONE\ntwo\nthree\nfour\n");

          yield* TestClock.adjust(Documents.SAVE_DELAY);
          expect(yield* a.nextDisk).toEqual({ savedVersion: 2, missing: false });
          expect(yield* workspace.readDisk).toBe("ONE\ntwo\nthree\nfour\n");
        }),
      ),
    );

    it.effect("never saves over a newer file, even when no watch event arrived", () =>
      withWorkspace("one\ntwo\nthree\n", (workspace) =>
        Effect.gen(function* () {
          const a = yield* connect(workspace.target, "a");
          a.edit({ from: 4, to: 7, insert: "TWO" });
          yield* a.push();
          yield* workspace.writeDisk("zero\none\ntwo\nthree\n");

          yield* TestClock.adjust(Documents.SAVE_DELAY);
          expect(yield* a.nextDisk).toEqual({ savedVersion: 2, missing: false });
          expect(a.text()).toBe("zero\none\nTWO\nthree\n");
          expect(yield* workspace.readDisk).toBe(a.text());
        }),
      ),
    );

    it.effect("does not recreate a removed file until a save is asked for", () =>
      withWorkspace("abc", (workspace) =>
        Effect.gen(function* () {
          const documents = yield* Documents.Documents;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const absolutePath = path.join(workspace.target.cwd, workspace.target.relativePath);
          const a = yield* connect(workspace.target, "a");

          yield* workspace.removeDisk;
          yield* workspace.notify;
          expect(yield* a.nextDisk).toEqual({ savedVersion: 0, missing: true });
          a.edit({ from: 3, insert: "d" });
          yield* a.push();
          yield* TestClock.adjust(Documents.SAVE_DELAY);
          expect(yield* fileSystem.exists(absolutePath)).toBe(false);

          expect(yield* documents.save({ ...workspace.target, loadId: a.loadId })).toEqual({
            savedVersion: 1,
          });
          expect(yield* workspace.readDisk).toBe("abcd");
        }),
      ),
    );

    it.effect("keeps a file's CRLF line breaks", () =>
      withWorkspace("one\r\ntwo\r\n", (workspace) =>
        Effect.gen(function* () {
          const documents = yield* Documents.Documents;
          const a = yield* connect(workspace.target, "a");
          expect(a.text()).toBe("one\ntwo\n");
          a.edit({ from: 3, insert: "\nmore" });
          yield* a.push();
          yield* documents.save({ ...workspace.target, loadId: a.loadId });
          expect(yield* workspace.readDisk).toBe("one\r\nmore\r\ntwo\r\n");
        }),
      ),
    );
  });

  describe("eviction", () => {
    it.effect("saves and closes a document nobody has open after the idle period", () =>
      withWorkspace("abc", (workspace) =>
        Effect.gen(function* () {
          const documents = yield* Documents.Documents;
          const a = yield* connect(workspace.target, "a");
          a.edit({ from: 3, insert: "d" });
          yield* a.push();
          yield* a.leave;

          yield* TestClock.adjust(Documents.IDLE_TIMEOUT);
          const b = yield* connect(workspace.target, "b");
          expect(b.loadId).not.toBe(a.loadId);
          expect(b.text()).toBe("abcd");
          expect(yield* workspace.readDisk).toBe("abcd");
          const stale = yield* documents
            .push({ ...workspace.target, loadId: a.loadId, version: 1, updates: [] })
            .pipe(Effect.flip);
          expect(stale.reason).toBe("not-loaded");
        }),
      ),
    );

    it.effect("keeps a document open while a client is subscribed", () =>
      withWorkspace("abc", (workspace) =>
        Effect.gen(function* () {
          const a = yield* connect(workspace.target, "a");
          const b = yield* connect(workspace.target, "b");
          yield* b.leave;
          yield* TestClock.adjust(Documents.IDLE_TIMEOUT);
          const c = yield* connect(workspace.target, "c");
          expect(c.loadId).toBe(a.loadId);
        }),
      ),
    );

    it.effect("recovers an evicted client's edits while disk still holds its base text", () =>
      withWorkspace("abc", (workspace) =>
        Effect.gen(function* () {
          const documents = yield* Documents.Documents;
          const a = yield* connect(workspace.target, "a");
          const base = a.text();
          yield* a.leave;
          a.edit({ from: 0, insert: "offline " });
          yield* TestClock.adjust(Documents.IDLE_TIMEOUT);

          const item = yield* a.reconnect;
          expect(item.type).toBe("snapshot");
          const result = yield* documents.recover({
            ...workspace.target,
            loadId: a.loadId,
            clientId: "a",
            baseText: base,
            text: a.text(),
          });
          expect(result).toEqual({ type: "accepted", version: 1 });

          const fresh = yield* connect(workspace.target, "b");
          expect(fresh.text()).toBe("offline abc");
          yield* TestClock.adjust(Documents.SAVE_DELAY);
          expect(yield* fresh.nextDisk).toEqual({ savedVersion: 1, missing: false });
          expect(yield* workspace.readDisk).toBe("offline abc");
        }),
      ),
    );

    it.effect("reports a conflict and changes nothing when disk moved on after eviction", () =>
      withWorkspace("abc", (workspace) =>
        Effect.gen(function* () {
          const documents = yield* Documents.Documents;
          const a = yield* connect(workspace.target, "a");
          const base = a.text();
          yield* a.leave;
          a.edit({ from: 0, insert: "offline " });
          yield* TestClock.adjust(Documents.IDLE_TIMEOUT);
          yield* workspace.writeDisk("an agent rewrote this");

          const item = yield* a.reconnect;
          const result = yield* documents.recover({
            ...workspace.target,
            loadId: a.loadId,
            clientId: "a",
            baseText: base,
            text: a.text(),
          });
          expect(result).toEqual({ type: "conflict" });

          const fresh = yield* connect(workspace.target, "b");
          expect(fresh.text()).toBe("an agent rewrote this");
          expect(getSyncedVersion(fresh.state)).toBe(0);
          expect(yield* workspace.readDisk).toBe("an agent rewrote this");
        }),
      ),
    );
  });
});
