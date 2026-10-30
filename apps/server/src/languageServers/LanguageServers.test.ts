// @effect-diagnostics nodeBuiltinImport:off - the fixture tarball needs gzip and SHA-512.
import {
  collab,
  getClientID,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type {
  DocumentError,
  DocumentStreamItem,
  LanguageServerDocumentState,
  LanguageServerError,
  LanguageServerProblemsItem,
  LanguageServerSessionItem,
  LanguageServerStatus,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import * as NodeZlib from "node:zlib";

import * as ServerConfig from "../config.ts";
import * as Documents from "../documents/Documents.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { ContentModified, RequestCancelled } from "./connection.ts";
import * as LanguageServers from "./LanguageServers.ts";
import type { LanguageServerSpec } from "./registry.ts";

const FAKE_SERVER = NodeURL.fileURLToPath(
  new URL("./testing/fakeLanguageServer.mjs", import.meta.url),
);
const FILE = "src/main.ts";

const fakeLaunch = {
  name: "Fake",
  projectBinary: { path: "fake-server.mjs", runWith: "node" as const },
  args: [],
  restrictedSafe: true,
};
const fakeSpecs: Record<"typescript", LanguageServerSpec> = {
  typescript: { id: "typescript", launches: [fakeLaunch] },
};

const layerKnownWorkspaces = Layer.mock(KnownWorkspaces.KnownWorkspaces)({
  assertContains: () => Effect.void,
});
const layerWorkspaceEntries = WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer));
const layerDocuments = Documents.layer.pipe(
  Layer.provide(
    WorkspaceFileSystem.layer.pipe(
      Layer.provide(layerWorkspaceEntries),
      Layer.provide(layerKnownWorkspaces),
    ),
  ),
  Layer.provide(layerKnownWorkspaces),
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
);

const noHttp = HttpClient.make((request) =>
  Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({ request, description: "offline in tests" }),
    }),
  ),
);

/** The service on a throwaway T3 home, with nothing watching disk and quick restarts. */
const layerFor = (
  options: Partial<LanguageServers.LanguageServersOptions> = {},
  http: HttpClient.HttpClient = noHttp,
) =>
  LanguageServers.layerWith({
    ...LanguageServers.defaultOptions,
    specs: fakeSpecs,
    idleTimeout: "1 hour",
    restartDelays: [0, 0, 0],
    memorySampleInterval: "1 hour",
    readMemory: () => Effect.succeed(new Map()),
    initializeTimeout: "30 seconds",
    diagnosticsTimeout: "30 seconds",
    ...options,
  }).pipe(
    Layer.provideMerge(layerDocuments),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(layerKnownWorkspaces),
    Layer.provide(ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-lsp-" })),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(
      Layer.succeed(
        FileSystem.WatchBackend,
        FileSystem.WatchBackend.of({ register: () => Option.some(Stream.never) }),
      ),
    ),
  );

/** A checkout with the fake server in it and one source file. */
const makeCheckout = Effect.fn("makeCheckout")(function* (
  text: string,
  config: Record<string, unknown> = {},
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-checkout-" });
  yield* fileSystem.makeDirectory(path.join(cwd, "src"));
  yield* fileSystem.writeFileString(path.join(cwd, FILE), text);
  yield* fileSystem.copyFile(FAKE_SERVER, path.join(cwd, "fake-server.mjs"));
  yield* fileSystem.writeFileString(path.join(cwd, "fake-server.json"), JSON.stringify(config));
  return {
    cwd,
    uri: NodeURL.pathToFileURL(path.join(cwd, FILE)).href,
    starts: fileSystem.readFileString(path.join(cwd, "starts.log")).pipe(
      Effect.map((log) => log.trim().split("\n").length),
      Effect.orElseSucceed(() => 0),
    ),
    write: (name: string, contents: string) =>
      fileSystem.writeFileString(path.join(cwd, name), contents),
  };
});

type Checkout = Effect.Success<ReturnType<typeof makeCheckout>>;
type Item = LanguageServerSessionItem;

let sessionCount = 0;

/** A client's LSP session: what it sends, and the items it waits for. */
const openSession = Effect.fn("openSession")(function* (checkout: Checkout) {
  const service = yield* LanguageServers.LanguageServers;
  const sessionId = `session-${++sessionCount}`;
  const items = yield* Queue.unbounded<Item, Cause.Done | LanguageServerError>();
  const fiber = yield* service
    .session({ cwd: checkout.cwd, server: "typescript", sessionId })
    .pipe(Stream.runIntoQueue(items), Effect.forkScoped);
  // The session always opens with its status; once it has, sends reach it.
  const buffered: Array<Item> = [yield* Queue.take(items)];
  const next = <A>(match: (item: Item) => A | undefined) =>
    Effect.gen(function* () {
      for (;;) {
        const found = match(buffered.shift() ?? (yield* Queue.take(items)));
        if (found !== undefined) return found;
      }
    });
  const parsed = (item: Item) =>
    item.type === "message"
      ? { ...(JSON.parse(item.message) as any), version: item.version }
      : undefined;
  const send = (message: object, document?: LanguageServerDocumentState) =>
    service.send({
      sessionId,
      message: JSON.stringify({ jsonrpc: "2.0", ...message }),
      ...(document === undefined ? {} : { document }),
    });
  return {
    sessionId,
    send,
    /** Sends a request and waits for its answer. */
    request: (
      id: number,
      method: string,
      params: unknown,
      document?: LanguageServerDocumentState,
    ) =>
      send({ id, method, params }, document).pipe(
        Effect.andThen(
          next((item) => {
            const message = parsed(item);
            return message?.id === id ? message : undefined;
          }),
        ),
      ),
    answer: (id: number) =>
      next((item) => {
        const message = parsed(item);
        return message?.id === id ? message : undefined;
      }),
    state: (state: LanguageServerStatus["state"]) =>
      next((item) =>
        item.type === "status" && item.status.state === state ? item.status : undefined,
      ),
    diagnostics: (accept: (message: any) => boolean = () => true) =>
      next((item) => {
        const message = parsed(item);
        return message?.method === "textDocument/publishDiagnostics" && accept(message)
          ? (message as { params: { version: number; diagnostics: Array<any> }; version: number })
          : undefined;
      }),
    open: (uri: string) =>
      send({
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: "typescript", version: 0, text: "" } },
      }),
    close: Fiber.interrupt(fiber),
  };
});

const statuses = (accept: (list: ReadonlyArray<LanguageServerStatus>) => boolean) =>
  Effect.flatMap(LanguageServers.LanguageServers, (service) =>
    service.subscribe.pipe(Stream.filter(accept), Stream.runHead, Effect.map(Option.getOrThrow)),
  );

/** An editor on the document: collab, receiving the environment's updates only when told. */
const openEditor = Effect.fn("openEditor")(function* (checkout: Checkout, clientID: string) {
  const documents = yield* Documents.Documents;
  const items = yield* Queue.unbounded<DocumentStreamItem, Cause.Done | DocumentError>();
  yield* documents
    .subscribe({ cwd: checkout.cwd, relativePath: FILE })
    .pipe(Stream.runIntoQueue(items), Effect.forkScoped);
  const first = yield* Queue.take(items);
  if (first.type !== "snapshot") throw new Error("expected a snapshot");
  let state = EditorState.create({
    doc: first.text,
    extensions: [collab({ startVersion: first.version, clientID })],
  });
  const loadId = first.loadId;
  return {
    get text() {
      return state.doc.toString();
    },
    /** Types without sending: the edit stays unconfirmed. */
    type: (from: number, insert: string, to = from) => {
      state = state.update({ changes: { from, to, insert } }).state;
    },
    /** Takes every update the environment has sent so far. */
    catchUp: Effect.gen(function* () {
      for (const item of yield* Queue.clear(items)) {
        if (item.type !== "updates") continue;
        const fresh = item.updates.slice(getSyncedVersion(state) - item.version).map((update) => ({
          clientID: update.clientId,
          changes: ChangeSet.fromJSON(update.changes),
        }));
        if (fresh.length > 0) state = receiveUpdates(state, fresh).state;
      }
    }),
    envelope: (): LanguageServerDocumentState => ({
      loadId,
      version: getSyncedVersion(state),
      clientId: getClientID(state),
      unconfirmed: sendableUpdates(state).map((update) => update.changes.toJSON()),
    }),
    position: (needle: string, delta = 0) => {
      const offset = state.doc.toString().indexOf(needle) + delta;
      const line = state.doc.lineAt(offset);
      return { line: line.number - 1, character: offset - line.from };
    },
    slice: (range: { start: any; end: any }) => {
      const at = (p: { line: number; character: number }) =>
        state.doc.line(p.line + 1).from + p.character;
      return state.doc.sliceString(at(range.start), at(range.end));
    },
    loadId,
  };
});

/** An agent's edit, landed straight on the environment's copy. */
const agentEdit = Effect.fn("agentEdit")(function* (
  checkout: Checkout,
  edit: (text: string) => { from: number; to?: number; insert: string },
) {
  const documents = yield* Documents.Documents;
  const items = yield* Queue.unbounded<DocumentStreamItem, Cause.Done | DocumentError>();
  const fiber = yield* documents
    .subscribe({ cwd: checkout.cwd, relativePath: FILE })
    .pipe(Stream.runIntoQueue(items), Effect.forkChild);
  const first = yield* Queue.take(items);
  if (first.type !== "snapshot") throw new Error("expected a snapshot");
  const spec = edit(first.text);
  const result = yield* documents.push({
    cwd: checkout.cwd,
    relativePath: FILE,
    loadId: first.loadId,
    version: first.version,
    updates: [
      {
        clientId: "agent",
        changes: ChangeSet.of([spec], Text.of(first.text.split("\n")).length).toJSON(),
      },
    ],
  });
  yield* Fiber.interrupt(fiber);
  return result.version;
});

const SOURCE = "const point = makePoint(1, 2);\nexport const label = point;\n";

describe("LanguageServers", () => {
  it.live("starts a server only when a file opens, and stops it when nothing uses it", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      expect(yield* checkout.starts).toBe(0);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      expect(yield* checkout.starts).toBe(1);
      yield* session.open(checkout.uri);
      yield* session.diagnostics();
      yield* session.close;
      yield* statuses((list) => list.length === 0);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ idleTimeout: 0 }))),
  );

  it.live("keeps a stopped server stopped until it is restarted", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const first = yield* openSession(checkout);
      yield* first.state("ready");
      yield* service.stop({ cwd: checkout.cwd, server: "typescript" });
      yield* first.state("stopped");
      const second = yield* openSession(checkout);
      yield* second.state("stopped");
      expect(yield* checkout.starts).toBe(1);
      yield* service.restart({ cwd: checkout.cwd, server: "typescript" });
      yield* second.state("ready");
      expect(yield* checkout.starts).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("restarts a crashed server and re-opens its documents", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout("let bad = 1;\n", { crashTimes: 2 });
      const session = yield* openSession(checkout);
      yield* session.open(checkout.uri);
      const published = yield* session.diagnostics(
        (message) => message.params.diagnostics.length > 0,
      );
      expect(published.params.diagnostics[0].range).toEqual({
        start: { line: 0, character: 4 },
        end: { line: 0, character: 7 },
      });
      expect(yield* checkout.starts).toBe(3);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("gives up after three restarts and says why", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE, { crashTimes: 99 });
      const session = yield* openSession(checkout);
      const failed = yield* session.state("failed");
      expect(failed.message).toContain("boom");
      expect(yield* checkout.starts).toBe(4);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("stops the least recently used server past the memory budget", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const a = yield* makeCheckout(SOURCE);
      const b = yield* makeCheckout(SOURCE);
      const first = yield* openSession(a);
      yield* first.state("ready");
      const second = yield* openSession(b);
      yield* second.state("ready");
      const capped = yield* first.state("capped");
      expect(capped.cwd).toBe(a.cwd);
      const list = yield* statuses((all) => all.some((status) => status.state === "capped"));
      expect(list.find((status) => status.cwd === b.cwd)?.state).toBe("ready");
      // Opening a file of the capped checkout brings it back, and the other one gives way.
      yield* openSession(a);
      yield* first.state("ready");
      yield* second.state("capped");
      void service;
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          memoryBudgetBytes: 1.5 * 1024 ** 3,
          readMemory: (pids) => Effect.succeed(new Map(pids.map((pid) => [pid, 1024 ** 3]))),
        }),
      ),
    ),
  );

  it.live("maps a request into the environment's copy and the answer back into the editor's", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      // The agent adds two lines and renames a word before the editor's cursor; it hasn't seen them.
      yield* agentEdit(checkout, () => ({ from: 0, insert: "// one\n// two\n" }));
      yield* agentEdit(checkout, (text) => ({
        from: text.indexOf("point"),
        to: text.indexOf("point") + 5,
        insert: "origin",
      }));
      const hover = yield* session.request(
        1,
        "textDocument/hover",
        { textDocument: { uri: checkout.uri }, position: editor.position("makePoint", 2) },
        editor.envelope(),
      );
      expect(hover.result.contents).toBe("makePoint");
      expect(editor.slice(hover.result.range)).toBe("makePoint");
      // Once the editor has the updates, a request needs no mapping and still lands right.
      yield* editor.catchUp;
      const again = yield* session.request(
        2,
        "textDocument/hover",
        { textDocument: { uri: checkout.uri }, position: editor.position("label") },
        editor.envelope(),
      );
      expect(editor.slice(again.result.range)).toBe("label");
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("lands the editor's unconfirmed edits before answering", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      editor.type(0, "const total = 3;\n");
      const hover = yield* session.request(
        1,
        "textDocument/hover",
        { textDocument: { uri: checkout.uri }, position: editor.position("total", 1) },
        editor.envelope(),
      );
      expect(hover.result.contents).toBe("total");
      expect(editor.slice(hover.result.range)).toBe("total");
      // The edit reached the environment's document, which everyone else now gets.
      const other = yield* openEditor(checkout, "editor-b");
      expect(other.text.startsWith("const total = 3;\n")).toBe(true);
      // Sending them again with the next request lands nothing twice.
      const repeat = yield* session.request(
        2,
        "textDocument/hover",
        { textDocument: { uri: checkout.uri }, position: editor.position("point") },
        editor.envelope(),
      );
      expect(repeat.result.contents).toBe("point");
      const state = yield* session.request(3, "test/state", {});
      expect(state.result.docs[checkout.uri].text).toBe(`const total = 3;\n${SOURCE}`);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("refuses an answer that edits text the editor has not received", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      yield* agentEdit(checkout, (text) => ({ from: text.length, insert: "use(1,2);\n" }));
      const format = () =>
        session.request(
          1,
          "textDocument/formatting",
          { textDocument: { uri: checkout.uri }, options: { tabSize: 2, insertSpaces: true } },
          editor.envelope(),
        );
      expect((yield* format()).error.code).toBe(ContentModified);
      yield* editor.catchUp;
      expect((yield* format()).result).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("applies a rename to every file it names, and undoes it as one", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const fileSystem = yield* FileSystem.FileSystem;
      const checkout = yield* makeCheckout(SOURCE, { renameAlso: "src/point.ts" });
      const POINT = "export function makePoint() {}\nmakePoint();\n";
      yield* checkout.write("src/point.ts", POINT);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      // An agent adds a use the editor hasn't received: the environment renames it too.
      yield* agentEdit(checkout, (text) => ({ from: text.length, insert: "makePoint(3, 4);\n" }));
      const rename = yield* session.request(
        1,
        "textDocument/rename",
        {
          textDocument: { uri: checkout.uri },
          position: editor.position("makePoint", 1),
          newName: "pointAt",
        },
        editor.envelope(),
      );
      expect(rename.result.applied).toMatchObject({
        files: [FILE, "src/point.ts"],
        edits: 4,
      });
      const read = (name: string) => fileSystem.readFileString(`${checkout.cwd}/${name}`);
      expect(yield* read(FILE)).toBe(
        "const point = pointAt(1, 2);\nexport const label = point;\npointAt(3, 4);\n",
      );
      expect(yield* read("src/point.ts")).toBe("export function pointAt() {}\npointAt();\n");
      // Someone types after the rename; undo puts the names back and keeps their line.
      yield* agentEdit(checkout, () => ({ from: 0, insert: "// later\n" }));
      const undone = yield* service.undoEdit({ id: rename.result.applied.id });
      expect(undone).toEqual({ files: [FILE, "src/point.ts"], skipped: [] });
      expect(yield* read(FILE)).toBe(`// later\n${SOURCE}makePoint(3, 4);\n`);
      expect(yield* read("src/point.ts")).toBe(POINT);
      const again = yield* service.undoEdit({ id: rename.result.applied.id }).pipe(Effect.flip);
      expect(again.reason).toBe("document");
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("formats an open file before saving it when asked, and saves without waiting long", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const fileSystem = yield* FileSystem.FileSystem;
      const run = Effect.fn("run")(function* (formatDelay: number) {
        const checkout = yield* makeCheckout("f(1,2);\n", { formatDelay });
        const session = yield* openSession(checkout);
        yield* session.state("ready");
        yield* session.open(checkout.uri);
        const editor = yield* openEditor(checkout, "editor-a");
        // The server has the file open once its diagnostics are in.
        yield* session.diagnostics();
        const save = (format: boolean) =>
          service.save({
            cwd: checkout.cwd,
            relativePath: FILE,
            loadId: editor.loadId,
            ...(format ? { format: { tabSize: 2, insertSpaces: true } } : {}),
          });
        const read = fileSystem.readFileString(`${checkout.cwd}/${FILE}`);
        yield* agentEdit(checkout, () => ({ from: 0, insert: "g(3,4);\n" }));
        yield* save(false);
        const unformatted = yield* read;
        yield* save(true);
        return { unformatted, saved: yield* read };
      });
      const quick = yield* run(0);
      expect(quick).toEqual({ unformatted: "g(3,4);\nf(1,2);\n", saved: "g(3, 4);\nf(1, 2);\n" });
      // A formatter slower than the save's patience is skipped.
      const slow = yield* run(10_000);
      expect(slow.saved).toBe("g(3,4);\nf(1,2);\n");
    }).pipe(Effect.scoped, Effect.provide(layerFor({ formatTimeout: "300 millis" }))),
  );

  it.live("offers code actions by title and applies the one picked through the environment", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const fileSystem = yield* FileSystem.FileSystem;
      const checkout = yield* makeCheckout("let bad = 1;\nlet fine = 2;\n");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      const published = yield* session.diagnostics(
        (message) => message.params.diagnostics.length > 0,
      );
      const ask = (id: number) =>
        session.request(
          id,
          "textDocument/codeAction",
          {
            textDocument: { uri: checkout.uri },
            range: published.params.diagnostics[0].range,
            context: { diagnostics: published.params.diagnostics },
          },
          editor.envelope(),
        );
      const offered = yield* ask(1);
      expect(offered.result).toEqual([
        { index: 0, title: "Replace bad with good", kind: "quickfix", isPreferred: true },
        { index: 1, title: "Remove the line" },
      ]);
      const read = fileSystem.readFileString(`${checkout.cwd}/${FILE}`);
      // A fix the server resolves first.
      const fixed = yield* session.request(2, "astrolabe/applyCodeAction", { index: 0 });
      expect(fixed.result.applied).toMatchObject({ files: [FILE], edits: 1 });
      expect(yield* read).toBe("let good = 1;\nlet fine = 2;\n");
      yield* service.undoEdit({ id: fixed.result.applied.id });
      // A command whose edit the server sends back while it runs.
      yield* editor.catchUp;
      yield* ask(3);
      const removed = yield* session.request(4, "astrolabe/applyCodeAction", { index: 1 });
      expect(removed.result.applied).toMatchObject({ files: [FILE] });
      expect(yield* read).toBe("let fine = 2;\n");
      // Offered actions are used once.
      const stale = yield* session.request(5, "astrolabe/applyCodeAction", { index: 1 });
      expect(stale.error.code).toBe(ContentModified);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("pushes diagnostics to every session with the version they were pulled at", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const first = yield* openSession(checkout);
      const second = yield* openSession(checkout);
      yield* first.state("ready");
      yield* first.open(checkout.uri);
      yield* second.open(checkout.uri);
      const version = yield* agentEdit(checkout, () => ({ from: 0, insert: "let bad = 1;\n" }));
      const accept = (message: any) => message.params.diagnostics.length > 0;
      const [a, b] = [yield* first.diagnostics(accept), yield* second.diagnostics(accept)];
      for (const published of [a, b]) {
        expect(published.version).toBe(version);
        expect(published.params.diagnostics).toMatchObject([
          { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } } },
        ]);
      }
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("cancels a request it hasn't forwarded itself, and forwards the rest", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE, { waitFor: "release" });
      const session = yield* openSession(checkout);
      yield* session.send({ id: 1, method: "test/slow", params: {} });
      yield* session.send({ method: "$/cancelRequest", params: { id: 1 } });
      expect((yield* session.answer(1)).error.code).toBe(RequestCancelled);
      yield* checkout.write("release", "");
      yield* session.state("ready");
      yield* session.send({ id: 2, method: "test/slow", params: {} });
      yield* session.send({ method: "$/cancelRequest", params: { id: 2 } });
      const forwarded = yield* session.answer(2);
      expect(forwarded.error).toEqual({
        code: RequestCancelled,
        message: "Cancelled by the server",
      });
      const state = yield* session.request(3, "test/state", {});
      expect(state.result.received.filter((method: string) => method === "test/slow")).toHaveLength(
        1,
      );
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("answers initialize from the server's capabilities, with no document sync", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      const init = yield* session.request(1, "initialize", { capabilities: {} });
      expect(init.result.capabilities.textDocumentSync).toEqual({ openClose: true, change: 0 });
      expect(init.result.capabilities.hoverProvider).toBe(true);
      expect(init.result.capabilities.diagnosticProvider).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("trims long completion lists", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      const completion = yield* session.request(
        1,
        "textDocument/completion",
        { textDocument: { uri: checkout.uri }, position: editor.position("point") },
        editor.envelope(),
      );
      expect(completion.result.isIncomplete).toBe(true);
      expect(completion.result.items).toHaveLength(200);
      expect(completion.result.items[0]).toEqual({ label: "item0", sortText: "0000" });
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("keeps the items the word being typed can still match", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout("const x = item12;\n");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      const completion = yield* session.request(
        1,
        "textDocument/completion",
        { textDocument: { uri: checkout.uri }, position: editor.position("item12", 6) },
        editor.envelope(),
      );
      // item12, item120..item129 and item412 hold "item12" in order; nothing else is sent.
      expect(completion.result.isIncomplete).toBe(false);
      expect(completion.result.items.map((item: any) => item.label)).toContain("item412");
      expect(completion.result.items).toHaveLength(
        Array.from({ length: 500 }, (_, index) => `item${index}`).filter((label) =>
          /i.*t.*e.*m.*1.*2/.test(label),
        ).length,
      );
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("resolves a completion item against the file its list came from", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      const completion = yield* session.request(
        1,
        "textDocument/completion",
        { textDocument: { uri: checkout.uri }, position: editor.position("label") },
        editor.envelope(),
      );
      // The editor types a line at the top before it accepts; the import still lands above it.
      editor.type(0, "// mine\n");
      const resolved = yield* session.request(
        2,
        "completionItem/resolve",
        completion.result.items[0],
        editor.envelope(),
      );
      expect(resolved.result.documentation).toBe("About item0");
      expect(resolved.result.additionalTextEdits).toEqual([
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: 'import { item0 } from "./lib";\n',
        },
      ]);
      // The editor's line reached the environment first, as for any request.
      const state = yield* session.request(3, "test/state", {});
      expect(state.result.docs[checkout.uri].text).toBe(`// mine\n${SOURCE}`);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("cuts a hover too big to send, closing its code block", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout("const huge = 1;\n");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      const hover = yield* session.request(
        1,
        "textDocument/hover",
        { textDocument: { uri: checkout.uri }, position: editor.position("huge") },
        editor.envelope(),
      );
      expect(hover.result.contents.length).toBeLessThan(100_010);
      expect(hover.result.contents.endsWith("\n```\n…")).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("adds each other file's line to a location answer", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE, {
        elsewhere: { makePoint: { path: "src/point.ts", line: 1, character: 16 } },
      });
      yield* checkout.write("src/point.ts", "// points\nexport function makePoint() {}\n");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      const references = yield* session.request(
        1,
        "textDocument/references",
        {
          textDocument: { uri: checkout.uri },
          position: editor.position("makePoint"),
          context: { includeDeclaration: true },
        },
        editor.envelope(),
      );
      expect(references.result).toEqual([
        {
          uri: checkout.uri,
          range: { start: { line: 0, character: 14 }, end: { line: 0, character: 23 } },
        },
        {
          uri: expect.stringMatching(/\/src\/point\.ts$/),
          range: { start: { line: 1, character: 16 }, end: { line: 1, character: 25 } },
          "astrolabe/preview": "export function makePoint() {}",
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("tells an agent where a symbol is defined and used, as the file is now", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE, {
        elsewhere: { makePoint: { path: "src/point.ts", line: 1, character: 16 } },
      });
      yield* checkout.write("src/point.ts", "// points\nexport function makePoint() {}\n");
      const definition = yield* service.locate({
        cwd: checkout.cwd,
        relativePath: FILE,
        line: 1,
        column: 16,
        kind: "definition",
      });
      expect(definition).toEqual({
        locations: [
          {
            path: "src/point.ts",
            line: 2,
            column: 17,
            endLine: 2,
            endColumn: 26,
            preview: "export function makePoint() {}",
          },
        ],
        truncated: false,
      });
      // A write just before the call is what the answer reads.
      yield* openEditor(checkout, "editor-a");
      yield* checkout.write(FILE, `const label = 1;\n${SOURCE}`);
      const references = yield* service.locate({
        cwd: checkout.cwd,
        relativePath: FILE,
        line: 1,
        column: 7,
        kind: "references",
      });
      expect(references.locations.map((location) => [location.line, location.preview])).toEqual([
        [1, "const label = 1;"],
        [3, "export const label = point;"],
      ]);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("gives an agent the diagnostics for the file as its last write left it", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const clean = yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      expect(clean.diagnostics).toEqual([]);
      // Hold the document open, as an editor would, so the next write has to be read in.
      yield* openEditor(checkout, "editor-a");
      yield* checkout.write(FILE, `${SOURCE}const bad = label;\n`);
      const dirty = yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      expect(dirty.diagnostics).toEqual([
        {
          severity: "error",
          line: 3,
          column: 7,
          endLine: 3,
          endColumn: 10,
          message: "bad is not allowed",
          code: "7",
          source: "fake",
        },
      ]);
      const unsupported = yield* service
        .diagnostics({ cwd: checkout.cwd, relativePath: "README.md" })
        .pipe(Effect.flip);
      expect(unsupported.reason).toBe("unsupported");
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("tells a server of the files it watches that change outside its open documents", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const fileSystem = yield* FileSystem.FileSystem;
      const checkout = yield* makeCheckout(SOURCE, {
        watch: [
          { globPattern: "**/*.ts" },
          // Created files only, under the checkout's `docs` folder.
          { globPattern: { baseUri: ".", pattern: "docs/*.md" }, kind: 1 },
        ],
      });
      const uriOf = (name: string) => NodeURL.pathToFileURL(`${checkout.cwd}/${name}`).href;
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      // The server has the file open once its diagnostics are in, and its watchers by then.
      yield* session.diagnostics();
      const changed = (changes: LanguageServers.FilesChangedInput["changes"]) =>
        service.filesChanged({ cwd: checkout.cwd, changes });

      yield* checkout.write("src/vectors.ts", "export const scaleVector = 1;\n");
      yield* changed([
        { relativePath: "src/vectors.ts", type: "created" },
        // The server has this one open: its edits reach it as the document's.
        { relativePath: FILE, type: "changed" },
        { relativePath: "README.md", type: "changed" },
        { relativePath: "docs/notes.md", type: "changed" },
      ]);
      // The same burst: still a new file to the server.
      yield* changed([{ relativePath: "src/vectors.ts", type: "changed" }]);
      const first = yield* session.request(1, "test/watched", { count: 1 });
      expect(first.result).toEqual([[{ uri: uriOf("src/vectors.ts"), type: 1 }]]);

      yield* fileSystem.remove(`${checkout.cwd}/src/vectors.ts`);
      yield* changed([
        { relativePath: "src/vectors.ts", type: "deleted" },
        { relativePath: "docs/plan.md", type: "created" },
      ]);
      const second = yield* session.request(2, "test/watched", { count: 2 });
      expect(second.result).toEqual([
        [{ uri: uriOf("src/vectors.ts"), type: 1 }],
        [
          { uri: uriOf("src/vectors.ts"), type: 3 },
          { uri: uriOf("docs/plan.md"), type: 1 },
        ],
      ]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ fileChangeQuiet: "50 millis" }))),
  );

  it.live("tells a server of a file saved here that it doesn't have open", () =>
    Effect.gen(function* () {
      const documents = yield* Documents.Documents;
      const checkout = yield* makeCheckout(SOURCE, { watch: [{ globPattern: "**/*.ts" }] });
      yield* checkout.write("src/point.ts", "export const point = 1;\n");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      yield* session.diagnostics();
      // An editor holds the other file without a language server, and saves an edit to it.
      const items = yield* Queue.unbounded<DocumentStreamItem, Cause.Done | DocumentError>();
      yield* documents
        .subscribe({ cwd: checkout.cwd, relativePath: "src/point.ts" })
        .pipe(Stream.runIntoQueue(items), Effect.forkScoped);
      const first = yield* Queue.take(items);
      if (first.type !== "snapshot") throw new Error("expected a snapshot");
      yield* documents.push({
        cwd: checkout.cwd,
        relativePath: "src/point.ts",
        loadId: first.loadId,
        version: first.version,
        updates: [
          {
            clientId: "editor",
            changes: ChangeSet.of([{ from: 0, insert: "// x\n" }], first.text.length).toJSON(),
          },
        ],
      });
      yield* documents.save({
        cwd: checkout.cwd,
        relativePath: "src/point.ts",
        loadId: first.loadId,
      });
      const watched = yield* session.request(1, "test/watched", { count: 1 });
      expect(watched.result).toEqual([
        [{ uri: NodeURL.pathToFileURL(`${checkout.cwd}/src/point.ts`).href, type: 2 }],
      ]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ fileChangeQuiet: "50 millis" }))),
  );

  it.live("lists a checkout's problems, keeps a closed file's until its server stops", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(`${SOURCE}const bad = label;\n`);
      const items = yield* Queue.unbounded<LanguageServerProblemsItem, Cause.Done>();
      yield* service.problems(checkout.cwd).pipe(Stream.runIntoQueue(items), Effect.forkScoped);
      expect(yield* Queue.take(items)).toEqual({ type: "snapshot", files: [] });

      // An agent's check opens the file, and closes it when done.
      yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      const checked = yield* Queue.take(items);
      expect(checked).toMatchObject({
        type: "file",
        file: { path: FILE, diagnostics: [{ line: 3, message: "bad is not allowed" }] },
      });
      const later = yield* Queue.unbounded<LanguageServerProblemsItem, Cause.Done>();
      yield* service.problems(checkout.cwd).pipe(Stream.runIntoQueue(later), Effect.forkScoped);
      expect(yield* Queue.take(later)).toMatchObject({
        type: "snapshot",
        files: [{ path: FILE, diagnostics: [{ line: 3 }] }],
      });

      yield* service.stop({ cwd: checkout.cwd, server: "typescript" });
      expect(yield* Queue.take(items)).toMatchObject({
        type: "file",
        file: { path: FILE, diagnostics: [] },
      });
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );
});

/** A gzipped npm tarball holding `files` under `package/`. */
const tarball = (files: Record<string, string>) => {
  const blocks: Array<Uint8Array> = [];
  for (const [name, contents] of Object.entries(files)) {
    const data = new TextEncoder().encode(contents);
    const header = new Uint8Array(512);
    const put = (offset: number, value: string) =>
      header.set(new TextEncoder().encode(value), offset);
    put(0, `package/${name}`);
    put(100, "0000755\0");
    put(124, `${data.length.toString(8).padStart(11, "0")}\0`);
    put(156, "0");
    put(257, "ustar\0");
    header.fill(32, 148, 156);
    const sum = header.reduce((total, byte) => total + byte, 0);
    put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return NodeZlib.gzipSync(Buffer.concat(blocks));
};

const registryServing = (licence: string, bytes: Uint8Array) => {
  const integrity = `sha512-${NodeCrypto.createHash("sha512").update(bytes).digest("base64")}`;
  return HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        request.url.endsWith(".tgz")
          ? new Response(bytes)
          : Response.json({
              license: licence,
              dist: { tarball: "https://registry.test/fake/-/fake-1.0.0.tgz", integrity },
            }),
      ),
    ),
  );
};

const downloadSpecs = (licence: string): Record<"typescript", LanguageServerSpec> => ({
  typescript: {
    id: "typescript",
    launches: [
      {
        name: "Fake",
        npm: {
          name: "fake-server",
          version: "1.0.0",
          licence,
          entry: "server.mjs",
          runWith: "node",
        },
        args: [],
        restrictedSafe: true,
      },
    ],
  },
});

describe("LanguageServers downloads", () => {
  const archive = tarball({
    "server.mjs": `await import(${JSON.stringify(NodeURL.pathToFileURL(FAKE_SERVER).href)});\n`,
    "package.json": '{"name":"fake-server","version":"1.0.0","license":"MIT"}',
  });

  it.live("asks before the environment's first download, then installs into the shared cache", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      const waiting = yield* session.state("download-needed");
      expect(waiting.message).toContain("fake-server 1.0.0 (MIT)");
      yield* service.confirmDownload;
      yield* session.state("downloading");
      const ready = yield* session.state("ready");
      expect(ready.source).toBe("cache");
      // A second checkout finds it cached and asks nothing.
      const other = yield* makeCheckout(SOURCE);
      const next = yield* openSession(other);
      expect((yield* next.state("ready")).source).toBe("cache");
    }).pipe(
      Effect.scoped,
      Effect.provide(layerFor({ specs: downloadSpecs("MIT") }, registryServing("MIT", archive))),
    ),
  );

  it.live("refuses a package the registry publishes under a licence outside the allowlist", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("download-needed");
      yield* service.confirmDownload;
      const failed = yield* session.state("failed");
      expect(failed.message).toContain("licence");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({ specs: downloadSpecs("MIT") }, registryServing("MPL-2.0", archive)),
      ),
    ),
  );
});
