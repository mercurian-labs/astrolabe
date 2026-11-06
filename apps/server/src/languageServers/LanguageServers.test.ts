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
  LanguageServerId,
  LanguageServerLogItem,
  LanguageServerProblemsItem,
  LanguageServerRoutes,
  LanguageServerSessionItem,
  LanguageServerSettingsChange,
  LanguageServerStatus,
  WikiSummary,
} from "@t3tools/contracts";
import { primaryLanguageServerRoute } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as NodeZlib from "node:zlib";

import * as ServerConfig from "../config.ts";
import * as Documents from "../documents/Documents.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WikiService from "../wiki/WikiService.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { ContentModified, RequestCancelled } from "./connection.ts";
import * as LanguageServers from "./LanguageServers.ts";
import type { LanguageServerSpec, ReleaseAsset, ReleaseSource } from "./registry.ts";

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
const fakeSpec = (launch: LanguageServerSpec["launches"][number]): LanguageServerSpec => ({
  id: "typescript",
  name: "Fake",
  languages: "TypeScript",
  missing: "No fake server here.",
  launches: [launch],
});
const fakeSpecs = { typescript: fakeSpec(fakeLaunch) };

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
  wikiRoots: ReadonlyArray<string> = [],
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
    trusted: () => Effect.succeed(true),
    traceGrace: 0,
    ...options,
  }).pipe(
    Layer.provideMerge(layerDocuments),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(
      Layer.mock(WikiService.WikiService)({
        list: Effect.sync(() => ({
          wikis: wikiRoots.map((root) => ({ root }) as WikiSummary),
        })),
      }),
    ),
    Layer.provide(layerKnownWorkspaces),
    Layer.provideMerge(ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-lsp-" })),
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
      fileSystem
        .makeDirectory(path.dirname(path.join(cwd, name)), { recursive: true })
        .pipe(Effect.andThen(fileSystem.writeFileString(path.join(cwd, name), contents))),
  };
});

type Checkout = Effect.Success<ReturnType<typeof makeCheckout>>;
type Item = LanguageServerSessionItem;

let sessionCount = 0;

/** A client's LSP session: what it sends, and the items it waits for. */
const openSession = Effect.fn("openSession")(function* (
  checkout: Checkout,
  server: LanguageServerId = "typescript",
) {
  const service = yield* LanguageServers.LanguageServers;
  const sessionId = `session-${++sessionCount}`;
  const items = yield* Queue.unbounded<Item, Cause.Done | LanguageServerError>();
  const fiber = yield* service
    .session({ cwd: checkout.cwd, server, sessionId })
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
    notification: (method: string) =>
      next((item) => {
        const message = parsed(item);
        return message?.method === method ? message : undefined;
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
const quiet = { pushes: { after: 0 }, quietUnchanged: true };

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
      const highlights = yield* session.request(
        3,
        "textDocument/documentHighlight",
        { textDocument: { uri: checkout.uri }, position: editor.position("= point", 3) },
        editor.envelope(),
      );
      expect(highlights.result).toHaveLength(1);
      expect(editor.slice(highlights.result[0].range)).toBe("point");
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

  it.live("answers inlay hints where the editor has the text, and asks it again on a refresh", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      const hints = () =>
        session.request(
          ++requests,
          "textDocument/inlayHint",
          {
            textDocument: { uri: checkout.uri },
            range: {
              start: { line: 0, character: 0 },
              end: { line: 5, character: 0 },
            },
          },
          editor.envelope(),
        );
      let requests = 0;
      const atOpen = yield* hints();
      expect(atOpen.result.map((hint: any) => hint.position)).toEqual([
        editor.position("point", 5),
        editor.position("= point", 7),
      ]);

      // An agent's line the editor hasn't received pushes one down and adds one it can't place.
      yield* agentEdit(checkout, () => ({ from: 0, insert: "const point2 = point;\n" }));
      const behind = yield* hints();
      expect(behind.result.map((hint: any) => hint.position)).toEqual([
        editor.position("point", 5),
        editor.position("= point", 7),
      ]);
      expect(behind.result[0].textEdits[0].range.start).toEqual(editor.position("point", 5));

      yield* session.request(++requests, "test/refresh", {
        method: "workspace/inlayHint/refresh",
      });
      expect(yield* session.notification("astrolabe/refresh")).toMatchObject({
        params: "inlayHints",
      });
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("answers a server's runnables in the editor's coordinates", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      yield* agentEdit(checkout, () => ({ from: 0, insert: "// one\n// two\n" }));
      const runnables = yield* session.request(
        1,
        "experimental/runnables",
        { textDocument: { uri: checkout.uri } },
        editor.envelope(),
      );
      expect(runnables.result).toHaveLength(2);
      for (const { location } of runnables.result) {
        expect(editor.slice(location.targetRange)).toBe("point");
        expect(editor.slice(location.targetSelectionRange)).toBe("point");
      }
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("refuses linked ranges in text the editor has not received", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      const ranges = (id: number) =>
        session.request(
          id,
          "textDocument/linkedEditingRange",
          { textDocument: { uri: checkout.uri }, position: editor.position("point", 1) },
          editor.envelope(),
        );
      const fine = yield* ranges(1);
      expect(fine.result.ranges.map((range: any) => editor.slice(range))).toEqual([
        "point",
        "point",
      ]);
      yield* agentEdit(checkout, () => ({ from: 0, insert: "const point2 = point;\n" }));
      const behind = yield* ranges(2);
      expect(behind.error.code).toBe(ContentModified);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("gives semantic tokens only to an editor with the text they are for", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
      const tokens = (id: number) =>
        session.request(
          id,
          "textDocument/semanticTokens/full",
          { textDocument: { uri: checkout.uri } },
          editor.envelope(),
        );
      expect((yield* tokens(1)).result.data).toEqual([0, 6, 5, 0, 0, 1, 21, 5, 0, 0]);
      yield* agentEdit(checkout, () => ({ from: 0, insert: "// one\n" }));
      expect((yield* tokens(2)).error.code).toBe(ContentModified);
      yield* editor.catchUp;
      expect((yield* tokens(3)).result.data).toEqual([1, 6, 5, 0, 0, 1, 21, 5, 0, 0]);
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
      // In the files as the rename left them, the agent's line included.
      expect(rename.result.applied.places).toEqual([
        { path: FILE, line: 1, column: 14, endLine: 1, endColumn: 21 },
        { path: FILE, line: 3, column: 0, endLine: 3, endColumn: 7 },
        { path: "src/point.ts", line: 1, column: 16, endLine: 1, endColumn: 23 },
        { path: "src/point.ts", line: 2, column: 0, endLine: 2, endColumn: 7 },
      ]);
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

  it.live("lists a huge rename's first places, and counts them all", () =>
    Effect.gen(function* () {
      const uses = "makePoint();\n".repeat(250);
      const checkout = yield* makeCheckout(SOURCE, { renameAlso: "src/point.ts" });
      yield* checkout.write("src/point.ts", uses);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const editor = yield* openEditor(checkout, "editor-a");
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
      expect(rename.result.applied.edits).toBe(251);
      expect(rename.result.applied.places).toHaveLength(200);
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
      expect(completion.result.items[0]).toMatchObject({ label: "item0", sortText: "0000" });
      expect(completion.result.items[0].documentation).toBeUndefined();
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

  it.live("tells a server of waiting file changes before it renames", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE, { watch: [{ globPattern: "**/*.ts" }] });
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      yield* session.diagnostics();
      const editor = yield* openEditor(checkout, "editor-a");
      yield* service.filesChanged({
        cwd: checkout.cwd,
        changes: [{ relativePath: "src/other.ts", type: "changed" }],
      });
      yield* session.request(
        1,
        "textDocument/rename",
        {
          textDocument: { uri: checkout.uri },
          position: editor.position("point"),
          newName: "origin",
        },
        editor.envelope(),
      );
      // The quiet period is far off: only the rename can have sent this.
      expect((yield* session.request(2, "test/watched", { count: 1 })).result).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ fileChangeQuiet: "1 hour" }))),
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

  it.live("checks what each server would run for a checkout, and what the checkout lacks", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      expect(yield* service.check(checkout.cwd)).toEqual({
        trusted: true,
        servers: [
          {
            server: "typescript",
            languages: "TypeScript",
            name: "Fake",
            state: "found",
            source: "project",
            executable: `${checkout.cwd}/fake-server.mjs`,
            message: "No compile_commands.json.",
            companion: null,
            off: false,
            language: "typescript",
            overrides: [],
            envNames: [],
            replacedBy: [],
          },
        ],
        projectFile: {
          path: ".astrolabe/language-servers.json",
          read: false,
          problem: null,
        },
        settingsProblem: null,
      });
      yield* checkout.write("build/compile_commands.json", "[]");
      expect((yield* service.check(checkout.cwd)).servers[0]?.message).toBeNull();
      // Checking starts nothing.
      expect(yield* checkout.starts).toBe(0);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          specs: {
            typescript: {
              ...fakeSpec(fakeLaunch),
              hint: {
                unless: ["compile_commands.json", "build/compile_commands.json"],
                message: "No compile_commands.json.",
              },
            },
          },
        }),
      ),
    ),
  );

  it.live("tells a server that checks saved files when one it has open is saved", () =>
    Effect.gen(function* () {
      const documents = yield* Documents.Documents;
      const checkout = yield* makeCheckout(SOURCE, { save: true });
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      yield* session.diagnostics();
      const editor = yield* openEditor(checkout, "editor");
      yield* agentEdit(checkout, () => ({ from: 0, insert: "// x\n" }));
      yield* documents.save({ cwd: checkout.cwd, relativePath: FILE, loadId: editor.loadId });
      const saved = yield* session.request(1, "test/saved", { count: 1 });
      expect(saved.result).toEqual([checkout.uri]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ fileChangeQuiet: "50 millis" }))),
  );

  describe("run context", () => {
    const contextOf = (cwd: string, path: string) =>
      Effect.flatMap(LanguageServers.LanguageServers, (service) =>
        service.runContext({ cwd, path }),
      );

    it.live("reads a file's nearest manifest and its tools, running nothing", () =>
      Effect.gen(function* () {
        const checkout = yield* makeCheckout(SOURCE);
        const { cwd } = checkout;
        yield* checkout.write("crates/core/Cargo.toml", "[package]\n");
        expect(yield* contextOf(cwd, "crates/core/src/lib.rs")).toMatchObject({
          trusted: true,
          root: "crates/core",
        });
        expect(yield* contextOf(cwd, "other/src/lib.rs")).toMatchObject({ root: "" });

        yield* checkout.write("svc/go.mod", "module svc\n");
        expect(yield* contextOf(cwd, "svc/pkg/a_test.go")).toMatchObject({ root: "svc" });

        yield* checkout.write("api/pyproject.toml", "");
        yield* checkout.write(".venv/bin/python", "");
        expect(yield* contextOf(cwd, "api/tests/test_a.py")).toMatchObject({
          root: "api",
          python: `${cwd}/.venv/bin/python`,
        });

        yield* checkout.write("package.json", '{"devDependencies":{"vitest":"^3"}}');
        yield* checkout.write("pnpm-lock.yaml", "");
        yield* checkout.write("packages/a/package.json", '{"name":"a"}');
        yield* checkout.write("packages/b/package.json", '{"scripts":{"test":"jest --ci"}}');
        yield* checkout.write("packages/c/package.json", '{"scripts":{"test":"node --test"}}');
        yield* checkout.write("packages/d/package.json", "not json");
        expect(yield* contextOf(cwd, "packages/a/src/a.test.ts")).toMatchObject({
          root: "",
          testRunner: "vitest",
          packageRunner: "pnpm exec",
        });
        expect(yield* contextOf(cwd, "packages/b/b.test.ts")).toMatchObject({
          root: "packages/b",
          testRunner: "jest",
        });
        expect(yield* contextOf(cwd, "packages/c/c.test.js")).toMatchObject({
          root: "packages/c",
          testRunner: "node",
        });
        expect(yield* contextOf(cwd, "packages/d/d.test.js")).toMatchObject({
          root: "",
          testRunner: "vitest",
        });

        yield* checkout.write("java/pom.xml", "<project/>");
        expect(yield* contextOf(cwd, "java/src/A.java")).toMatchObject({
          root: "java",
          buildTool: "maven",
          buildCommand: "mvn",
        });
        yield* checkout.write("java/mvnw", "");
        expect(yield* contextOf(cwd, "java/src/A.java")).toMatchObject({ buildCommand: "./mvnw" });

        yield* checkout.write("build.gradle", "");
        yield* checkout.write("gradlew", "");
        yield* checkout.write("app/core/build.gradle.kts", "");
        expect(yield* contextOf(cwd, "app/core/src/A.java")).toMatchObject({
          root: "app/core",
          buildTool: "gradle",
          buildCommand: "../../gradlew",
        });
      }).pipe(Effect.scoped, Effect.provide(layerFor())),
    );

    it.live("uses the chosen interpreter while it's there", () =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        yield* checkout.write(".venv/bin/python", "");
        yield* checkout.write("envs-a/bin/python", "");
        yield* checkout.write("envs-a/pyvenv.cfg", "version = 3.11.4\n");
        const chosen = `${checkout.cwd}/envs-a/bin/python`;
        yield* service.updateSettings({
          cwd: checkout.cwd,
          change: { type: "toolchain", kind: "python", path: chosen },
        });
        expect(yield* contextOf(checkout.cwd, "test_a.py")).toMatchObject({ python: chosen });
      }).pipe(Effect.scoped, Effect.provide(layerFor())),
    );

    it.live("says nothing of an untrusted checkout but that it is", () =>
      Effect.gen(function* () {
        const checkout = yield* makeCheckout(SOURCE);
        yield* checkout.write("Cargo.toml", "");
        yield* checkout.write(".venv/bin/python", "");
        yield* checkout.write("package.json", '{"devDependencies":{"vitest":"^3"}}');
        expect(yield* contextOf(checkout.cwd, "a.test.ts")).toMatchObject({
          trusted: false,
          root: "",
          testRunner: null,
        });
        expect((yield* contextOf(checkout.cwd, "a.py")).python).not.toContain(".venv");
      }).pipe(Effect.scoped, Effect.provide(layerFor({ trusted: () => Effect.succeed(false) }))),
    );

    it.live("refuses a path out of the checkout", () =>
      Effect.gen(function* () {
        const checkout = yield* makeCheckout(SOURCE);
        const refused = yield* contextOf(checkout.cwd, "../other/package.json").pipe(Effect.flip);
        expect(refused.reason).toBe("unsupported");
      }).pipe(Effect.scoped, Effect.provide(layerFor())),
    );
  });

  it.live("answers a server's settings by section, with the checkout's virtual environment", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      yield* checkout.write(".venv/bin/python", "");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      const answer = yield* session.request(1, "test/configuration", {
        items: [{ section: "python" }, { section: "fake.level" }, { section: "missing" }, {}],
      });
      const python = `${checkout.cwd}/.venv/bin/python`;
      expect(answer.result).toEqual([
        { pythonPath: python },
        "strict",
        null,
        { python: { pythonPath: python }, fake: { level: "strict" } },
      ]);
      // A server that never asks hears them anyway.
      const state = yield* session.request(2, "test/state", {});
      expect(state.result.received).toContain("workspace/didChangeConfiguration");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          specs: {
            typescript: fakeSpec({
              ...fakeLaunch,
              settings: {
                python: { pythonPath: "{python}" },
                fake: { level: "strict" },
              },
            }),
          },
        }),
      ),
    ),
  );

  it.live("waits out a server that publishes nothing just before a file's real problems", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(`${SOURCE}const bad = label;\n`, {
        pushes: { after: 200 },
      });
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      expect((yield* session.diagnostics()).params.diagnostics).toEqual([]);
      const file = yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      expect(file.diagnostics.map((item) => item.message)).toEqual(["bad is not allowed"]);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("pulls again when a server finishes loading, and holds an agent until then", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(`${SOURCE}const bad = label;\n`, {
        quiescentOn: "loaded",
      });
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      // What it answered while loading: without waiting, an agent would be told this.
      expect((yield* session.diagnostics()).params.diagnostics).toEqual([]);
      const asked = yield* service
        .diagnostics({ cwd: checkout.cwd, relativePath: FILE })
        .pipe(Effect.forkScoped);
      yield* checkout.write("loaded", "");
      const file = yield* Fiber.join(asked);
      expect(file.diagnostics.map((item) => item.message)).toEqual(["bad is not allowed"]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          diagnosticsQuiet: 0,
          specs: { typescript: fakeSpec({ ...fakeLaunch, reportsQuiescence: true }) },
        }),
      ),
    ),
  );

  it.live("keeps what a server pushes beside what it answers to pulls", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(`${SOURCE}const bad = label;\n`);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      yield* session.diagnostics((message) => message.params.diagnostics.length === 1);
      const pushed = {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        severity: 1,
        message: "from the build",
      };
      yield* session.send({
        id: 1,
        method: "test/push",
        params: { uri: checkout.uri, version: 0, diagnostics: [pushed] },
      });
      const both = yield* session.diagnostics((message) => message.params.diagnostics.length === 2);
      expect(both.params.diagnostics.map((item: any) => item.message)).toEqual([
        "bad is not allowed",
        "from the build",
      ]);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("takes a pull answered `unchanged` as a look at that version, for a clean file", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE, { unchanged: true });
      const answer = yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      expect(answer.diagnostics).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ diagnosticsTimeout: "2 seconds" }))),
  );

  it.live("tells an agent nothing changed when a server stays quiet about a file", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const clean = yield* makeCheckout(SOURCE, quiet);
      const first = yield* service.diagnostics({ cwd: clean.cwd, relativePath: FILE });
      expect(first.diagnostics).toEqual([]);

      const checkout = yield* makeCheckout(`const bad = 1;\n`, quiet);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      yield* session.diagnostics((message) => message.params.diagnostics.length === 1);
      yield* agentEdit(checkout, () => ({ from: 0, insert: "\n" }));
      const edited = yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      expect(edited.diagnostics.map(({ line }) => line)).toEqual([2]);

      // Closed and opened again, the server still has nothing new to say.
      const reopened = yield* makeCheckout(`const bad = 1;\n`, quiet);
      const asked = { cwd: reopened.cwd, relativePath: FILE };
      expect((yield* service.diagnostics(asked)).diagnostics).toHaveLength(1);
      expect((yield* service.diagnostics(asked)).diagnostics).toHaveLength(1);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          specs: { typescript: { ...fakeSpec(fakeLaunch), quietUnchanged: true } },
          diagnosticsTimeout: "2 seconds",
          silenceAfter: "50 millis",
        }),
      ),
    ),
  );

  it.live("keeps a wiki's checkouts away from a server that doesn't belong there", () => {
    const wikiRoots: Array<string> = [];
    const notes: LanguageServerSpec = {
      ...companionSpec("marksman", {}),
      notInWikis: true,
    };
    return Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const project = yield* makeCheckout(SOURCE);
      const wiki = yield* makeCheckout(SOURCE);
      yield* wiki.write("note.md", "[[elsewhere]]\n");
      yield* project.write("note.md", "plain\n");
      wikiRoots.push(wiki.cwd);

      const servers = (cwd: string) =>
        service.check(cwd).pipe(Effect.map((result) => result.servers.map(({ server }) => server)));
      expect(yield* servers(project.cwd)).toContain("marksman");
      expect(yield* servers(wiki.cwd)).not.toContain("marksman");

      const refused = yield* service
        .diagnostics({ cwd: wiki.cwd, relativePath: "note.md" })
        .pipe(Effect.flip);
      expect(refused.reason).toBe("unsupported");
      const located = yield* service
        .locate({
          cwd: wiki.cwd,
          relativePath: "note.md",
          line: 1,
          column: 1,
          kind: "definition",
        })
        .pipe(Effect.flip);
      expect(located.reason).toBe("unsupported");
      expect(yield* wiki.starts).toBe(0);
      yield* service.diagnostics({ cwd: project.cwd, relativePath: "note.md" });
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor(
          { specs: { ...fakeSpecs, marksman: notes }, diagnosticsTimeout: "5 seconds" },
          noHttp,
          wikiRoots,
        ),
      ),
    );
  });

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

/** A gzipped npm tarball holding `files` under `package/`, or `top`. */
const tarball = (files: Record<string, string>, top = "package/") => {
  const blocks: Array<Uint8Array> = [];
  for (const [name, contents] of Object.entries(files)) {
    const data = new TextEncoder().encode(contents);
    const header = new Uint8Array(512);
    const put = (offset: number, value: string) =>
      header.set(new TextEncoder().encode(value), offset);
    put(0, `${top}${name}`);
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

/** A registry of several packages, each file served under its package's name. */
const registryServingPackages = (
  packages: Record<string, Uint8Array>,
  licences: Record<string, string> = {},
) =>
  HttpClient.make((request) => {
    const name = /registry[^/]*\/([^/]+)/.exec(request.url)?.[1] ?? "";
    const bytes = packages[name]!;
    const integrity = `sha512-${NodeCrypto.createHash("sha512").update(bytes).digest("base64")}`;
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        request.url.endsWith(".tgz")
          ? new Response(bytes)
          : Response.json({
              license: licences[name] ?? "MIT",
              dist: { tarball: `https://registry.test/${name}/-/${name}.tgz`, integrity },
            }),
      ),
    );
  });

const dependencySpecs = {
  typescript: fakeSpec({
    name: "Fake",
    npm: {
      name: "fake-server",
      version: "1.0.0",
      licence: "MIT",
      entry: "server.mjs",
      runWith: "node",
      dependencies: { "fake-dep": "2.0.0" },
    },
    args: [],
    restrictedSafe: true,
  }),
};

const downloadSpecs = (licence: string) => ({
  typescript: fakeSpec({
    name: "Fake",
    npm: { name: "fake-server", version: "1.0.0", licence, entry: "server.mjs", runWith: "node" },
    args: [],
    restrictedSafe: true,
  }),
});

/** A zip storing `files` uncompressed, each with its Unix mode. */
const zipOf = (files: Record<string, { readonly text: string; readonly mode: number }>) => {
  const locals: Array<Uint8Array> = [];
  const centrals: Array<Uint8Array> = [];
  let offset = 0;
  for (const [name, { text, mode }] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name);
    const data = new TextEncoder().encode(text);
    const crc = NodeZlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    // Made by Unix (3), so the external attributes' high half is a Unix mode.
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
};

const RELEASE_URL = "https://releases.test/fake-server";

const releaseServing = (bytes: Uint8Array) =>
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        request.url === RELEASE_URL ? new Response(bytes) : new Response(null, { status: 404 }),
      ),
    ),
  );

/** A release whose build for this machine is `bytes`, pinned as `pinned` (its own by default). */
const releaseSpecs = (
  bytes: Uint8Array,
  format: ReleaseAsset["format"],
  pinned: Uint8Array = bytes,
  entry?: string,
) => ({
  typescript: fakeSpec({
    name: "Fake",
    release: {
      name: "fake-server",
      version: "1.0.0",
      licence: "Apache-2.0 WITH LLVM-exception",
      host: "Releases",
      // The same build for every machine the tests run on.
      assets: Object.fromEntries(
        ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map((machine) => [
          machine,
          {
            url: RELEASE_URL,
            bytes: pinned.length,
            sha256: NodeCrypto.createHash("sha256").update(pinned).digest("hex"),
            format,
            ...(entry === undefined ? {} : { entry }),
          },
        ]),
      ),
    },
    args: [],
    restrictedSafe: true,
  }),
});

/** A tarred release under another licence than `releaseSpecs` gives one. */
const licensedSpecs = (
  bytes: Uint8Array,
  licence: Pick<ReleaseSource, "licence" | "licenceRuled">,
) => {
  const launch = releaseSpecs(bytes, "tgz").typescript.launches[0]!;
  return { typescript: fakeSpec({ ...launch, release: { ...launch.release!, ...licence } }) };
};

/** A native executable that runs the fake server with the Node on PATH. */
const nativeFakeServer = `#!/usr/bin/env node\nimport(${JSON.stringify(NodeURL.pathToFileURL(FAKE_SERVER).href)});\n`;

/** A server of several on a file, the fake with `--role=<id>`. */
const companionSpec = (
  id: LanguageServerId,
  extra: Partial<LanguageServerSpec> = {},
  launch: Partial<LanguageServerSpec["launches"][number]> = {},
): LanguageServerSpec => ({
  ...fakeSpec({ ...fakeLaunch, name: id, args: [`--role=${id}`], ...launch }),
  id,
  name: id,
  ...extra,
});

const withEslint = {
  ...fakeSpecs,
  eslint: companionSpec("eslint", {
    activation: { files: ["eslint.config.js"], packages: ["eslint"], description: "ESLint config" },
  }),
};
const withBoth = { ...withEslint, tailwindcss: companionSpec("tailwindcss") };

const openedDiagnostics = (message: { params: { diagnostics: Array<any> } }) =>
  message.params.diagnostics
    .map((diagnostic) => `${diagnostic.source}:${diagnostic.range.start.line}`)
    .toSorted();

/** A checkout with both companions on, and a session with its file open once they are ready. */
const openWithCompanions = Effect.fn("openWithCompanions")(function* (
  text: string,
  config: Record<string, unknown>,
) {
  const checkout = yield* makeCheckout(text, config);
  yield* checkout.write("eslint.config.js", "");
  const session = yield* openSession(checkout);
  yield* session.state("ready");
  yield* session.request(1000, "initialize", { capabilities: {} });
  yield* session.open(checkout.uri);
  yield* statuses(
    (list) =>
      list.filter((status) => status.cwd === checkout.cwd && status.state === "ready").length === 3,
  );
  return { checkout, session };
});

describe("LanguageServers with companions on a file", () => {
  const roles = {
    eslint: { word: "worse", source: "eslint", pushes: { after: 0 } },
    tailwindcss: { word: "worst", source: null, fullSync: true },
  };

  it.live("publishes every server's diagnostics as one, carrying the older ones forward", () =>
    Effect.gen(function* () {
      const { checkout, session } = yield* openWithCompanions(
        "let bad = 1;\nlet worse = 2;\nlet worst = 3;\n",
        { roles },
      );
      const opened = yield* session.diagnostics(
        (message) => message.params.diagnostics.length === 3,
      );
      // A server that names no source is labelled with its own name.
      expect(openedDiagnostics(opened)).toEqual(["eslint:1", "fake:0", "tailwindcss:2"]);
      // The primary and Tailwind check the new text; ESLint here checked only the file it opened.
      yield* agentEdit(checkout, () => ({ from: 0, insert: "// one\n// two\n" }));
      const carried = yield* session.diagnostics(
        (message) =>
          message.params.version === 1 &&
          openedDiagnostics(message).join() === "eslint:3,fake:2,tailwindcss:4",
      );
      expect(carried.version).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("clears only the stopped server's diagnostics and problems", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const { checkout, session } = yield* openWithCompanions("let bad, worse;\n", {
        roles: { eslint: { word: "worse", source: "eslint" }, tailwindcss: { word: "unused" } },
      });
      yield* session.diagnostics((message) => message.params.diagnostics.length === 2);
      const items = yield* Queue.unbounded<LanguageServerProblemsItem, Cause.Done>();
      yield* service.problems(checkout.cwd).pipe(Stream.runIntoQueue(items), Effect.forkScoped);
      expect(yield* Queue.take(items)).toMatchObject({
        type: "snapshot",
        files: [{ path: FILE, diagnostics: [{}, {}] }],
      });
      yield* service.stop({ cwd: checkout.cwd, server: "eslint" });
      const left = yield* session.diagnostics((message) => message.params.diagnostics.length === 1);
      expect(left.params.diagnostics[0].source).toBe("fake");
      expect(yield* Queue.take(items)).toMatchObject({
        type: "file",
        file: { path: FILE, diagnostics: [{ source: "fake" }] },
      });
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("walks a call hierarchy on the server that prepared it, as places with their lines", () =>
    Effect.gen(function* () {
      const { checkout, session } = yield* openWithCompanions(SOURCE, {
        without: ["callHierarchyProvider"],
        roles: { eslint: { without: [] }, tailwindcss: { without: ["callHierarchyProvider"] } },
      });
      const editor = yield* openEditor(checkout, "editor-a");
      const prepared = yield* session.request(
        1,
        "textDocument/prepareCallHierarchy",
        { textDocument: { uri: checkout.uri }, position: editor.position("point", 1) },
        editor.envelope(),
      );
      expect(prepared.result[0].name).toBe("point");
      const incoming = yield* session.request(2, "callHierarchy/incomingCalls", {
        item: prepared.result[0],
      });
      expect(incoming.result.map((place: any) => place["astrolabe/preview"])).toEqual([
        "const point = makePoint(1, 2);",
        "export const label = point;",
      ]);
      const outgoing = yield* session.request(3, "callHierarchy/outgoingCalls", {
        item: prepared.result[0],
      });
      expect(outgoing.result).toHaveLength(1);
      expect(outgoing.result[0].range.end.character).toBe("eslint".length);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("resolves a code lens and runs its command on the server that made it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { checkout, session } = yield* openWithCompanions(SOURCE, {
        without: ["codeLensProvider"],
        roles: { eslint: { without: [] }, tailwindcss: { without: ["codeLensProvider"] } },
      });
      const editor = yield* openEditor(checkout, "editor-a");
      yield* agentEdit(checkout, () => ({ from: 0, insert: "// one\n" }));
      const listed = yield* session.request(
        1,
        "textDocument/codeLens",
        { textDocument: { uri: checkout.uri } },
        editor.envelope(),
      );
      expect(editor.slice(listed.result[1].range)).toBe("point");
      const resolved = yield* session.request(
        2,
        "codeLens/resolve",
        listed.result[1],
        editor.envelope(),
      );
      expect(resolved.result.command.title).toBe("Remove the line");
      expect(editor.slice(resolved.result.range)).toBe("point");
      const run = yield* session.request(3, "astrolabe/runLensCommand", resolved.result);
      expect(run.result.applied.files).toEqual([FILE]);
      expect(yield* fileSystem.readFileString(`${checkout.cwd}/${FILE}`)).toBe(
        "// one\nconst point = makePoint(1, 2);\n",
      );

      const refused = yield* session.request(4, "astrolabe/runLensCommand", {
        ...resolved.result,
        command: { title: "Run", command: "editor.showSomething" },
      });
      expect(refused.error.code).toBe(-32601);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("finds symbols across the servers running in a checkout, each once", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const { checkout } = yield* openWithCompanions(SOURCE, {
        symbols: ["addTotal", "other"],
        roles: { eslint: { symbols: ["addTotal", "addOne"] }, tailwindcss: { symbols: [] } },
      });
      const found = yield* service.projectSymbols({ cwd: checkout.cwd, query: "add" });
      expect(found).toEqual({
        symbols: [
          {
            name: "addTotal",
            kind: "function",
            container: "primary",
            path: "src/addTotal.ts",
            line: 3,
            column: 3,
          },
          {
            name: "addOne",
            kind: "function",
            container: "eslint",
            path: "src/addOne.ts",
            line: 3,
            column: 3,
          },
        ],
        truncated: false,
      });
      const elsewhere = yield* service.projectSymbols({ cwd: "/not/this/one", query: "add" });
      expect(elsewhere.symbols).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("merges completions and resolves each item on the server that made it", () =>
    Effect.gen(function* () {
      const { checkout, session } = yield* openWithCompanions(SOURCE, {
        completions: ["alpha"],
        roles: {
          eslint: { without: ["completionProvider"] },
          tailwindcss: {
            completions: ["beta"],
            incomplete: true,
            triggerCharacters: [" "],
          },
        },
      });
      const editor = yield* openEditor(checkout, "editor-a");
      const ask = (id: number, context?: object) =>
        session.request(
          id,
          "textDocument/completion",
          {
            textDocument: { uri: checkout.uri },
            position: editor.position("const"),
            ...(context === undefined ? {} : { context }),
          },
          editor.envelope(),
        );
      const merged = yield* ask(1);
      expect(merged.result.isIncomplete).toBe(true);
      expect(merged.result.items.map((item: any) => item.label)).toEqual(["alpha", "beta"]);
      const beta = yield* session.request(
        2,
        "completionItem/resolve",
        merged.result.items[1],
        editor.envelope(),
      );
      expect(beta.result.documentation).toBe("About beta from tailwindcss");
      const alpha = yield* session.request(
        3,
        "completionItem/resolve",
        merged.result.items[0],
        editor.envelope(),
      );
      expect(alpha.result.documentation).toBe("About alpha");
      // Another server's trigger character means nothing to this one.
      const triggered = yield* ask(4, { triggerKind: 2, triggerCharacter: " " });
      expect(triggered.result.items.map((item: any) => item.label)).toEqual(["beta"]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("merges code actions and applies each on the server that offered it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { checkout, session } = yield* openWithCompanions("let bad, worse;\n", {
        roles: {
          eslint: { word: "worse", source: "eslint", replacement: "better" },
          tailwindcss: { word: "unused" },
        },
      });
      const editor = yield* openEditor(checkout, "editor-a");
      const published = yield* session.diagnostics(
        (message) => message.params.diagnostics.length === 2,
      );
      const offered = yield* session.request(
        1,
        "textDocument/codeAction",
        {
          textDocument: { uri: checkout.uri },
          range: published.params.diagnostics[0].range,
          context: { diagnostics: published.params.diagnostics },
        },
        editor.envelope(),
      );
      const titles = offered.result.map((action: any) => action.title);
      expect(titles).toContain("Replace bad with good");
      expect(titles).toContain("Replace worse with better");
      const applied = yield* session.request(2, "astrolabe/applyCodeAction", {
        index: titles.indexOf("Replace worse with better"),
      });
      expect(applied.result.applied).toMatchObject({ files: [FILE] });
      expect(yield* fileSystem.readFileString(`${checkout.cwd}/${FILE}`)).toBe(
        "let bad, better;\n",
      );
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("returns what is in when a server is slow, and cancels it", () =>
    Effect.gen(function* () {
      const { checkout, session } = yield* openWithCompanions("let bad;\n", {
        roles: { eslint: { slow: ["textDocument/codeAction"] } },
      });
      const editor = yield* openEditor(checkout, "editor-a");
      const published = yield* session.diagnostics(
        (message) => message.params.diagnostics.length > 0,
      );
      const offered = yield* session.request(
        1,
        "textDocument/codeAction",
        {
          textDocument: { uri: checkout.uri },
          range: published.params.diagnostics[0].range,
          context: { diagnostics: published.params.diagnostics },
        },
        editor.envelope(),
      );
      expect(offered.result.map((action: any) => action.title)).toContain("Replace bad with good");
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth, fanOutTimeout: 50 }))),
  );

  it.live("cancels every server a request went to", () =>
    Effect.gen(function* () {
      const { checkout, session } = yield* openWithCompanions("let bad;\n", {
        slow: ["textDocument/codeAction"],
      });
      yield* session.send({
        id: 1,
        method: "textDocument/codeAction",
        params: {
          textDocument: { uri: checkout.uri },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          context: { diagnostics: [] },
        },
      });
      yield* session.send({ method: "$/cancelRequest", params: { id: 1 } });
      // Only once all three have given up: nothing else ends the wait here.
      expect((yield* session.answer(1)).error.code).toBe(RequestCancelled);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth, fanOutTimeout: "1 hour" }))),
  );

  it.live("tries the next server when the first has nothing to show on hover", () =>
    Effect.gen(function* () {
      const { checkout, session } = yield* openWithCompanions(SOURCE, {
        hoverNull: true,
        roles: {
          eslint: { without: ["hoverProvider"] },
          tailwindcss: { hoverNull: false },
        },
      });
      const editor = yield* openEditor(checkout, "editor-a");
      const hover = yield* session.request(
        1,
        "textDocument/hover",
        { textDocument: { uri: checkout.uri }, position: editor.position("makePoint", 2) },
        editor.envelope(),
      );
      expect(hover.result.contents).toBe("tailwindcss: makePoint");
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("keeps the primary whole when a companion fails or is missing", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout("let bad;\n", {
        roles: { eslint: { crashTimes: 99 } },
      });
      yield* checkout.write("eslint.config.js", "");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const published = yield* session.diagnostics(
        (message) => message.params.diagnostics.length > 0,
      );
      expect(openedDiagnostics(published)).toEqual(["fake:0"]);
      const list = yield* statuses((all) => all.some((status) => status.state === "failed"));
      expect(list.find((status) => status.server === "typescript")?.state).toBe("ready");
      expect(list.find((status) => status.server === "eslint")?.state).toBe("failed");
      yield* statuses((all) => all.some((status) => status.state === "missing"));
      const checked = yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      expect(checked.diagnostics.map((diagnostic) => diagnostic.source)).toEqual(["fake"]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          specs: {
            ...withEslint,
            tailwindcss: {
              ...companionSpec("tailwindcss"),
              launches: [{ name: "Nothing", args: [], restrictedSafe: true }],
            },
          },
        }),
      ),
    ),
  );

  it.live("holds an untrusted project's companion back while its primary runs restricted", () =>
    withMachineServer((specs) =>
      Effect.gen(function* () {
        const checkout = yield* makeCheckout("let bad;\n");
        yield* checkout.write("eslint.config.js", "");
        const session = yield* openSession(checkout);
        expect((yield* session.state("ready")).restricted).toBe(true);
        yield* session.open(checkout.uri);
        yield* session.diagnostics((message) => message.params.diagnostics.length > 0);
        yield* statuses((list) => list.some((status) => status.state === "trust-needed"));
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerFor({
            specs: {
              ...specs,
              eslint: companionSpec("eslint", {}, { restrictedSafe: false }),
            },
            trusted: () => Effect.succeed(false),
          }),
        ),
      ),
    ),
  );

  it.live("joins only the files a companion serves", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      yield* checkout.write("eslint.config.js", "");
      yield* checkout.write("src/other.mts", SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri.replace("main.ts", "other.mts"));
      const list = yield* statuses((all) => all.length === 2);
      expect(list.map((status) => status.server)).toEqual(["typescript", "eslint"]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("lets go of companions on close and session end, so they stop with their files", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const { checkout, session } = yield* openWithCompanions("let bad;\n", {});
      yield* session.send({
        method: "textDocument/didClose",
        params: { textDocument: { uri: checkout.uri } },
      });
      // The primary stays while its session does; a companion has only its files.
      expect((yield* statuses((list) => list.length === 1))[0]?.server).toBe("typescript");
      yield* session.open(checkout.uri);
      yield* statuses((list) => list.length === 3);
      yield* session.close;
      yield* statuses((list) => list.length === 0);
      // An agent's check holds them only while it runs.
      yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      yield* statuses((list) => list.length === 0);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth, idleTimeout: 0 }))),
  );

  it.live("activates a companion on the checkout's evidence, read again on Restart", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout("let bad;\n");
      const companionOf = (server: LanguageServerId) =>
        service
          .check(checkout.cwd)
          .pipe(
            Effect.map(
              ({ servers }) => servers.find((check) => check.server === server)?.companion,
            ),
          );
      expect(yield* companionOf("typescript")).toBeNull();
      expect(yield* companionOf("tailwindcss")).toMatchObject({ active: true });
      expect(yield* companionOf("eslint")).toEqual({
        active: false,
        reason: "Not active: no ESLint config or eslint in package.json.",
      });

      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      yield* statuses((list) => list.length === 2);
      expect((yield* statuses(() => true)).map((status) => status.server)).not.toContain("eslint");

      // Evidence added while the file is open counts from the next Restart, without reopening.
      yield* checkout.write(
        "package.json",
        JSON.stringify({ devDependencies: { eslint: "^9.0.0" } }),
      );
      expect(yield* companionOf("eslint")).toEqual({
        active: true,
        reason: "Found eslint in package.json.",
      });
      yield* service.restart({ cwd: checkout.cwd, server: "typescript" });
      yield* statuses((list) => list.some((status) => status.server === "eslint"));

      // And its going lets the companion go.
      yield* checkout.write("package.json", "{}");
      yield* service.restart({ cwd: checkout.cwd, server: "typescript" });
      yield* statuses((list) => !list.some((status) => status.server === "eslint"));
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth, idleTimeout: 0 }))),
  );

  it.live("tells the client what a companion adds once it runs", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE, {
        without: ["hoverProvider"],
        roles: { tailwindcss: { without: [], triggerCharacters: [" "] } },
      });
      yield* checkout.write("eslint.config.js", "");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      const init = yield* session.request(1, "initialize", { capabilities: {} });
      expect(init.result.capabilities.hoverProvider).toBeUndefined();
      expect(init.result.capabilities.completionProvider.triggerCharacters).toEqual(["."]);
      yield* session.open(checkout.uri);
      for (;;) {
        const told = yield* session.notification("astrolabe/capabilities");
        if (told.params.completionProvider.triggerCharacters.length < 2) continue;
        expect(told.params.hoverProvider).toBe(true);
        expect(told.params.textDocumentSync).toEqual({ openClose: true, change: 0 });
        expect(told.params.diagnosticProvider).toBeUndefined();
        expect(told.params.completionProvider.triggerCharacters).toEqual([".", " "]);
        break;
      }
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("gives an agent a ready companion's diagnostics, and doesn't wait for a slow one", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout("let bad, worse, worst;\n", {
        roles: {
          eslint: { word: "worse", source: "eslint" },
          // Never answers `initialize`.
          tailwindcss: { word: "worst", waitFor: "never" },
        },
      });
      yield* checkout.write("eslint.config.js", "");
      const checked = yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      expect(checked.diagnostics.map((diagnostic) => diagnostic.source)).toEqual([
        "fake",
        "eslint",
      ]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth, companionWait: 500 }))),
  );

  it.live("uses one formatter, the first its language names that can", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const fileSystem = yield* FileSystem.FileSystem;
      const checkout = yield* makeCheckout("", { roles: { ruff: { formatInsert: "_" } } });
      yield* checkout.write("src/main.py", "a,b\n");
      const uri = checkout.uri.replace("main.ts", "main.py");
      const session = yield* openSession(checkout, "basedpyright");
      yield* session.state("ready");
      yield* session.open(uri);
      yield* statuses((list) => list.filter((status) => status.state === "ready").length === 2);
      const formatted = yield* session.request(1, "textDocument/formatting", {
        textDocument: { uri },
        options: { tabSize: 2, insertSpaces: true },
      });
      expect(formatted.result.map((edit: any) => edit.newText)).toEqual(["_"]);

      const documents = yield* Documents.Documents;
      const items = yield* Queue.unbounded<DocumentStreamItem, Cause.Done | DocumentError>();
      yield* documents
        .subscribe({ cwd: checkout.cwd, relativePath: "src/main.py" })
        .pipe(Stream.runIntoQueue(items), Effect.forkScoped);
      const first = yield* Queue.take(items);
      if (first.type !== "snapshot") throw new Error("expected a snapshot");
      yield* service.save({
        cwd: checkout.cwd,
        relativePath: "src/main.py",
        loadId: first.loadId,
        format: { tabSize: 2, insertSpaces: true },
      });
      expect(yield* fileSystem.readFileString(`${checkout.cwd}/src/main.py`)).toBe("a,_b\n");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          specs: {
            basedpyright: { ...fakeSpec(fakeLaunch), id: "basedpyright", formatters: ["ruff"] },
            ruff: companionSpec("ruff"),
          },
        }),
      ),
    ),
  );

  it.live("stops companions before primaries past the memory budget", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout("let bad;\n");
      yield* checkout.write("eslint.config.js", "");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      const list = yield* statuses(
        (all) => all.filter((status) => status.state === "capped").length === 2,
      );
      expect(list.find((status) => status.server === "typescript")?.state).toBe("ready");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          specs: withBoth,
          memoryBudgetBytes: 1.5 * 1024 ** 3,
          readMemory: (pids) => Effect.succeed(new Map(pids.map((pid) => [pid, 1024 ** 3]))),
        }),
      ),
    ),
  );
});

describe("LanguageServers for servers with quirks", () => {
  it.live("tells a server that forgets closed files that the file still exists", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      yield* session.diagnostics();
      yield* session.send({
        method: "textDocument/didClose",
        params: { textDocument: { uri: checkout.uri } },
      });
      const watched = yield* session.request(1, "test/watched", { count: 1 });
      expect(watched.result).toEqual([[{ uri: checkout.uri, type: 1 }]]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({ specs: { typescript: { ...fakeSpec(fakeLaunch), forgetsClosedFiles: true } } }),
      ),
    ),
  );

  it.live("keeps the folders a server writes out of the checkout's git status", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const checkout = yield* makeCheckout(SOURCE);
      NodeChildProcess.execFileSync("git", ["init", "-q"], { cwd: checkout.cwd });
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      const exclude = yield* fileSystem.readFileString(`${checkout.cwd}/.git/info/exclude`);
      expect(exclude.split("\n")).toContain(".cache/clangd/");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          specs: { typescript: { ...fakeSpec(fakeLaunch), writes: [".cache/clangd/"] } },
        }),
      ),
    ),
  );
});

describe("LanguageServers with nothing to run", () => {
  it.live("says what to install, to editors and agents, and finds it on the next try", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.rename(`${checkout.cwd}/fake-server.mjs`, `${checkout.cwd}/later.mjs`);
      const session = yield* openSession(checkout);
      expect((yield* session.state("missing")).message).toBe("No fake server here.");
      const asked = yield* service
        .diagnostics({ cwd: checkout.cwd, relativePath: FILE })
        .pipe(Effect.flip);
      expect(asked.message).toBe("No fake server here.");
      yield* fileSystem.rename(`${checkout.cwd}/later.mjs`, `${checkout.cwd}/fake-server.mjs`);
      yield* service.restart({ cwd: checkout.cwd, server: "typescript" });
      yield* session.state("ready");
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );
});

describe("LanguageServers downloads", () => {
  // The tar helper's top folder is `package/`, which is what a release's dropped folder stands for.
  const tarred = tarball({ "fake-server": nativeFakeServer });
  const untopped = tarball({ "bin/fake-server": nativeFakeServer, "main.lua": "" }, "");

  const archive = tarball({
    "server.mjs": `await import(${JSON.stringify(NodeURL.pathToFileURL(FAKE_SERVER).href)});\n`,
    "package.json": '{"name":"fake-server","version":"1.0.0","license":"MIT"}',
  });

  it.live("downloads for a trusted project without asking, into the shared cache", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("downloading");
      const ready = yield* session.state("ready");
      expect(ready.source).toBe("cache");
      // A second checkout finds it cached.
      const other = yield* makeCheckout(SOURCE);
      const next = yield* openSession(other);
      expect((yield* next.state("ready")).source).toBe("cache");
    }).pipe(
      Effect.scoped,
      Effect.provide(layerFor({ specs: downloadSpecs("MIT") }, registryServing("MIT", archive))),
    ),
  );

  it.live("unpacks the dependencies a package pins beside it, each checked as it was", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      expect((yield* session.state("ready")).source).toBe("cache");
      yield* session.open(checkout.uri);
      const service = yield* LanguageServers.LanguageServers;
      const {
        servers: [check],
      } = yield* service.check(checkout.cwd);
      const fileSystem = yield* FileSystem.FileSystem;
      // A folder of these pins: another server of the package may need others.
      expect(check?.executable).toMatch(/fake-server@1\.0\.0-[0-9a-f]{8}\/server\.mjs$/);
      expect(
        yield* fileSystem.readFileString(
          check!.executable!.replace("server.mjs", "node_modules/fake-dep/index.js"),
        ),
      ).toBe("dependency");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor(
          { specs: dependencySpecs },
          registryServingPackages({
            "fake-server": archive,
            "fake-dep": tarball({ "index.js": "dependency" }),
          }),
        ),
      ),
    ),
  );

  it.live("refuses a pinned dependency under a licence outside the allowlist", () =>
    Effect.gen(function* () {
      const session = yield* openSession(yield* makeCheckout(SOURCE));
      expect((yield* session.state("failed")).message).toContain("fake-dep");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor(
          { specs: dependencySpecs },
          registryServingPackages(
            { "fake-server": archive, "fake-dep": tarball({ "index.js": "dependency" }) },
            { "fake-dep": "MPL-2.0" },
          ),
        ),
      ),
    ),
  );

  it.live("refuses a package the registry publishes under a licence outside the allowlist", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      const failed = yield* session.state("failed");
      expect(failed.message).toContain("licence");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({ specs: downloadSpecs("MIT") }, registryServing("MPL-2.0", archive)),
      ),
    ),
  );

  it.live("installs a gzipped release build after checking its pinned checksum", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      const waiting = yield* session.state("trust-needed");
      expect(waiting.message).toBe(
        "fake-server 1.0.0 (Apache-2.0 WITH LLVM-exception) needs downloading from Releases.",
      );
      yield* service.trustProject(checkout.cwd);
      expect((yield* session.state("ready")).source).toBe("cache");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor(
          { specs: releaseSpecs(NodeZlib.gzipSync(nativeFakeServer), "gz"), trusted: undefined },
          releaseServing(NodeZlib.gzipSync(nativeFakeServer)),
        ),
      ),
    ),
  );

  it.live("takes a release that is the executable itself", () =>
    Effect.gen(function* () {
      const session = yield* openSession(yield* makeCheckout(SOURCE));
      expect((yield* session.state("ready")).source).toBe("cache");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor(
          { specs: releaseSpecs(new TextEncoder().encode(nativeFakeServer), "binary") },
          releaseServing(new TextEncoder().encode(nativeFakeServer)),
        ),
      ),
    ),
  );

  it.live("unpacks a tarred release build, dropping its top folder", () =>
    Effect.gen(function* () {
      const session = yield* openSession(yield* makeCheckout(SOURCE));
      expect((yield* session.state("ready")).source).toBe("cache");
    }).pipe(
      Effect.scoped,
      Effect.provide(layerFor({ specs: releaseSpecs(tarred, "tgz") }, releaseServing(tarred))),
    ),
  );

  it.live("keeps a tarred release's folders when it has no one top folder", () =>
    Effect.gen(function* () {
      const session = yield* openSession(yield* makeCheckout(SOURCE));
      expect((yield* session.state("ready")).source).toBe("cache");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor(
          { specs: releaseSpecs(untopped, "tgz", untopped, "bin/fake-server") },
          releaseServing(untopped),
        ),
      ),
    ),
  );

  it.live("refuses a release under a licence outside the allowlist", () =>
    Effect.gen(function* () {
      const session = yield* openSession(yield* makeCheckout(SOURCE));
      expect((yield* session.state("failed")).message).toContain("licence");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({ specs: licensedSpecs(tarred, { licence: "EPL-2.0" }) }, releaseServing(tarred)),
      ),
    ),
  );

  it.live("takes a licence outside the allowlist where the server's own row rules it", () =>
    Effect.gen(function* () {
      const session = yield* openSession(yield* makeCheckout(SOURCE));
      expect((yield* session.state("ready")).source).toBe("cache");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor(
          { specs: licensedSpecs(tarred, { licence: "EPL-2.0", licenceRuled: true }) },
          releaseServing(tarred),
        ),
      ),
    ),
  );

  const zipped = zipOf({
    "fake_1.0.0/bin/fake-server": { text: nativeFakeServer, mode: 0o755 },
    "fake_1.0.0/lib/README": { text: "notes", mode: 0o644 },
  });

  it.live("unpacks a zipped release build whole, keeping its executable bit", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      expect((yield* session.state("ready")).source).toBe("cache");
      const {
        servers: [check],
      } = yield* service.check(checkout.cwd);
      const fileSystem = yield* FileSystem.FileSystem;
      expect(check?.executable).toMatch(/fake-server@1\.0\.0\/fake_1\.0\.0\/bin\/fake-server$/);
      expect(
        yield* fileSystem.readFileString(
          check!.executable!.replace("bin/fake-server", "lib/README"),
        ),
      ).toBe("notes");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor(
          { specs: releaseSpecs(zipped, "zip", zipped, "fake_1.0.0/bin/fake-server") },
          releaseServing(zipped),
        ),
      ),
    ),
  );

  it.live("refuses a release build that doesn't match its pinned checksum", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      expect((yield* session.state("failed")).message).toBe(
        "fake-server failed its integrity check.",
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor(
          {
            specs: releaseSpecs(
              zipped,
              "zip",
              zipped.map((byte, index) => (index === 0 ? byte ^ 1 : byte)),
            ),
          },
          releaseServing(zipped),
        ),
      ),
    ),
  );
});

/** Runs `run` with a server on the machine: a project launch only trust allows, then that one. */
const withMachineServer = <A, E, R>(
  run: (specs: LanguageServers.LanguageServersOptions["specs"]) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-machine-" });
    const file = `${folder}/fake-server`;
    yield* fileSystem.writeFileString(file, nativeFakeServer);
    yield* fileSystem.chmod(file, 0o755);
    return yield* run({
      typescript: {
        ...fakeSpec(fakeLaunch),
        launches: [
          { ...fakeLaunch, restrictedSafe: false },
          { name: "Machine", knownPaths: [file], args: [], restrictedSafe: true },
        ],
      },
    });
  }).pipe(Effect.provide(NodeServices.layer));

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.sync(() =>
    NodeChildProcess.execFileSync("git", [...args], {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    }),
  );

describe("LanguageServers project trust", () => {
  const untrusted = layerFor({ trusted: undefined });

  it.live("holds back a server that needs trust, and starts it in full once trusted", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      // The old global yes trusts nothing.
      yield* fileSystem.makeDirectory(`${config.providerStatusCacheDir}/language-servers`, {
        recursive: true,
      });
      yield* fileSystem.writeFileString(
        `${config.providerStatusCacheDir}/language-servers/download-consent.json`,
        '{"consented":true}',
      );
      const checkout = yield* makeCheckout(SOURCE);
      expect(yield* service.check(checkout.cwd)).toMatchObject({
        trusted: false,
        servers: [{ state: "trust", executable: null }],
      });
      const session = yield* openSession(checkout);
      const waiting = yield* session.state("trust-needed");
      expect(waiting.message).toBe("Fake can run code from this project.");
      expect(yield* checkout.starts).toBe(0);
      yield* service.trustProject(checkout.cwd);
      const ready = yield* session.state("ready");
      expect(ready).toMatchObject({ source: "project", restricted: false });
      expect(yield* service.check(checkout.cwd)).toMatchObject({
        trusted: true,
        servers: [{ state: "found" }],
      });
    }).pipe(Effect.scoped, Effect.provide(untrusted)),
  );

  it.live("tells an agent at once that the project needs trusting", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const failed = yield* service
        .diagnostics({ cwd: checkout.cwd, relativePath: FILE })
        .pipe(Effect.flip);
      expect(failed).toMatchObject({
        reason: "trust-needed",
        message: "The language server needs the user to trust this project in Astrolabe.",
      });
      const other = yield* makeCheckout(SOURCE);
      const located = yield* service
        .locate({ cwd: other.cwd, relativePath: FILE, line: 1, kind: "definition" })
        .pipe(Effect.flip);
      expect(located.reason).toBe("trust-needed");
    }).pipe(Effect.scoped, Effect.provide(untrusted)),
  );

  it.live("holds an untrusted checkout to a launch's limits until trust lifts them", () =>
    withMachineServer((specs) => {
      const machine = specs.typescript!.launches[1]!;
      const limited = {
        typescript: fakeSpec({
          ...machine,
          initializationOptions: { kept: true, schemas: "all" },
          settings: { store: { enable: true } },
          restricted: {
            initializationOptions: { schemas: "file" },
            settings: { store: { enable: false } },
            notify: ["test/limited"],
          },
        }),
      };
      return Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        const session = yield* openSession(checkout);
        const looks = (id: number) =>
          Effect.all([
            session.request(id, "test/state", {}),
            session.request(id + 1, "test/configuration", { items: [{ section: "store" }] }),
          ]);
        yield* session.state("ready");
        yield* service.updateSettings({
          cwd: checkout.cwd,
          change: {
            type: "server",
            scope: "machine",
            server: "typescript",
            override: { settings: { store: { enable: true, chosen: 1 } } },
          },
        });
        yield* session.state("ready");
        const [state, store] = yield* looks(1);
        expect(state.result.initializationOptions).toEqual({ kept: true, schemas: "file" });
        expect(state.result.notified).toContain("test/limited");
        expect(store.result).toEqual([{ enable: false, chosen: 1 }]);

        // What it would have fetched itself comes to the gateway, which has no way to.
        const asked = yield* session.request(3, "test/ask", {
          method: "vscode/content",
          params: "http://localhost:1/schema.json",
        });
        expect(asked.result.error.code).toBe(-32601);

        yield* service.trustProject(checkout.cwd);
        yield* session.state("starting");
        yield* session.state("ready");
        const [trusted, trustedStore] = yield* looks(4);
        expect(trusted.result.initializationOptions).toEqual({ kept: true, schemas: "all" });
        expect(trusted.result.notified).not.toContain("test/limited");
        expect(trustedStore.result).toEqual([{ enable: true, chosen: 1 }]);
      }).pipe(Effect.provide(layerFor({ specs: limited, trusted: undefined })));
    }).pipe(Effect.scoped),
  );

  it.live("runs a machine's safe server restricted, and swaps it as trust comes and goes", () =>
    withMachineServer((specs) =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        const session = yield* openSession(checkout);
        expect(yield* session.state("ready")).toMatchObject({
          name: "Machine",
          source: "path",
          restricted: true,
        });
        yield* service.trustProject(checkout.cwd);
        yield* session.state("starting");
        expect(yield* session.state("ready")).toMatchObject({
          name: "Fake",
          source: "project",
          restricted: false,
        });
        yield* service.revokeProjectTrust(checkout.cwd);
        yield* session.state("starting");
        expect(yield* session.state("ready")).toMatchObject({ name: "Machine", restricted: true });
        expect(yield* checkout.starts).toBe(3);
      }).pipe(Effect.provide(layerFor({ specs, trusted: undefined }))),
    ).pipe(Effect.scoped),
  );

  it.live("leaves a stopped server stopped when trust changes", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("trust-needed");
      yield* service.stop({ cwd: checkout.cwd, server: "typescript" });
      yield* session.state("stopped");
      yield* service.trustProject(checkout.cwd);
      yield* service.restart({ cwd: checkout.cwd, server: "typescript" });
      expect(yield* session.state("ready")).toMatchObject({ restricted: false });
      expect(yield* checkout.starts).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(untrusted)),
  );

  it.live("shares trust between a repository's worktrees", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const fileSystem = yield* FileSystem.FileSystem;
      const main = yield* makeCheckout(SOURCE);
      yield* git(main.cwd, "init", "-q");
      yield* git(main.cwd, "add", "-A");
      yield* git(main.cwd, "commit", "-q", "-m", "first");
      const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-worktree-" });
      const cwd = `${parent}/linked`;
      yield* git(main.cwd, "worktree", "add", "-q", "-b", "linked", cwd);
      const linked = { ...main, cwd };
      const first = yield* openSession(main);
      const second = yield* openSession(linked);
      yield* first.state("trust-needed");
      yield* second.state("trust-needed");
      yield* service.trustProject(main.cwd);
      yield* first.state("ready");
      yield* second.state("ready");
      expect((yield* service.check(cwd)).trusted).toBe(true);
      yield* service.revokeProjectTrust(cwd);
      yield* first.state("trust-needed");
      yield* second.state("trust-needed");
      expect((yield* service.check(main.cwd)).trusted).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(untrusted)),
  );

  it.live("gives no trust to a folder whose .git file only claims a trusted repository", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const fileSystem = yield* FileSystem.FileSystem;
      const main = yield* makeCheckout(SOURCE);
      yield* git(main.cwd, "init", "-q");
      yield* service.trustProject(main.cwd);
      const claimant = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-claimant-" });
      yield* fileSystem.writeFileString(`${claimant}/.git`, `gitdir: ${main.cwd}/.git\n`);
      expect((yield* service.check(main.cwd)).trusted).toBe(true);
      expect((yield* service.check(claimant)).trusted).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(untrusted)),
  );
});

/** A server's log subscription: each item, and the lines and trace entries so far. */
const openLogs = Effect.fn("openLogs")(function* (
  checkout: Checkout,
  server: LanguageServerId = "typescript",
  full = false,
) {
  const service = yield* LanguageServers.LanguageServers;
  const items = yield* Queue.unbounded<LanguageServerLogItem, Cause.Done | LanguageServerError>();
  const fiber = yield* service
    .logs({ cwd: checkout.cwd, server, full })
    .pipe(Stream.runIntoQueue(items), Effect.forkScoped);
  const seen: Array<LanguageServerLogItem> = [];
  const lines = () => seen.flatMap((item) => item.lines);
  const trace = () => seen.flatMap((item) => item.trace);
  const until = <A>(found: () => A | undefined) =>
    Effect.gen(function* () {
      for (;;) {
        const result = found();
        if (result !== undefined) return result;
        seen.push(yield* Queue.take(items));
      }
    });
  return { seen, lines, trace, until, close: Fiber.interrupt(fiber) };
});

describe("LanguageServers settings", () => {
  const set = (cwd: string, change: LanguageServerSettingsChange) =>
    Effect.flatMap(LanguageServers.LanguageServers, (service) =>
      service.updateSettings({ cwd, change }),
    );
  const stateOf = (session: Effect.Success<ReturnType<typeof openSession>>, id: number) =>
    session.request(id, "test/state", {}).pipe(Effect.map((answer) => answer.result));
  const routesIn = (cwd: string) =>
    Effect.flatMap(LanguageServers.LanguageServers, (service) =>
      service.routes(cwd).pipe(Stream.runHead, Effect.map(Option.getOrThrow)),
    );
  const pythonSpecs = {
    basedpyright: {
      ...companionSpec("basedpyright", { formatters: ["ruff", "basedpyright"] }),
      launches: [
        {
          ...fakeLaunch,
          name: "basedpyright",
          args: ["--role=basedpyright"],
          settings: { python: { pythonPath: "{python}" } },
        },
      ],
    },
    ruff: companionSpec("ruff"),
  };
  const CUSTOM = {
    name: "My Lang",
    command: process.execPath,
    env: {},
    languageIds: { foo: "foolang" },
    rootFiles: [],
    replaces: false,
  };
  const customFor = (checkout: Checkout) => ({
    ...CUSTOM,
    args: [`${checkout.cwd}/fake-server.mjs`, "--role=mine"],
  });

  it.live("passes a server's settings, and shows what changed them and where from", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* set(checkout.cwd, {
        type: "server",
        scope: "machine",
        server: "typescript",
        override: {
          args: ["--role=typed"],
          env: { FAKE_SETTING: "machine" },
          initializationOptions: { from: "machine", kept: true },
          settings: { fake: { level: "loose", extra: 1 } },
        },
      });
      yield* session.state("starting");
      yield* session.state("ready");
      yield* set(checkout.cwd, {
        type: "server",
        scope: "project",
        server: "typescript",
        override: { env: { FAKE_SETTING: "project" }, initializationOptions: { from: "project" } },
      });
      yield* session.state("starting");
      yield* session.state("ready");

      const state = yield* stateOf(session, 1);
      expect(state.args).toEqual(["--role=typed"]);
      expect(state.env).toBe("project");
      expect(state.initializationOptions).toEqual({ from: "project", kept: true });
      const answer = yield* session.request(2, "test/configuration", {
        items: [{ section: "fake" }],
      });
      expect(answer.result).toEqual([{ level: "loose", extra: 1 }]);
      const { servers } = yield* service.check(checkout.cwd);
      const settings = yield* service.settings(checkout.cwd);
      expect(servers[0]?.overrides).toEqual([
        { field: "args", source: "machine" },
        { field: "env", source: "machine" },
        { field: "initializationOptions", source: "machine" },
        { field: "settings", source: "machine" },
        { field: "env", source: "project" },
        { field: "initializationOptions", source: "project" },
      ]);
      expect(settings.project.servers.typescript?.env).toEqual({ FAKE_SETTING: "project" });

      // A project's settings stop at its own repository.
      const other = yield* makeCheckout(SOURCE);
      const elsewhere = yield* openSession(other);
      yield* elsewhere.state("ready");
      expect((yield* stateOf(elsewhere, 1)).env).toBe("machine");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerFor({
          specs: {
            typescript: fakeSpec({ ...fakeLaunch, settings: { fake: { level: "strict" } } }),
          },
        }),
      ),
    ),
  );

  it.live("runs the binary someone chose, and only in a trusted project", () =>
    withMachineServer((specs) =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        const session = yield* openSession(checkout);
        expect((yield* session.state("ready")).restricted).toBe(true);
        // What was safe without someone's arguments is no longer known to be.
        yield* set(checkout.cwd, {
          type: "server",
          scope: "machine",
          server: "typescript",
          override: { binary: process.execPath, args: [`${checkout.cwd}/fake-server.mjs`] },
        });
        expect((yield* session.state("trust-needed")).message).toContain("can run code");
        yield* service.trustProject(checkout.cwd);
        expect(yield* session.state("ready")).toMatchObject({ source: "path" });
        const [check] = (yield* service.check(checkout.cwd)).servers;
        expect(check).toMatchObject({ executable: process.execPath, state: "found" });
        yield* set(checkout.cwd, {
          type: "server",
          scope: "machine",
          server: "typescript",
          override: { binary: "/nowhere/server" },
        });
        expect((yield* session.state("missing")).message).toBe("No fake server here.");
      }).pipe(Effect.scoped, Effect.provide(layerFor({ specs, trusted: undefined }))),
    ),
  );

  it.live("restarts only the servers a change reaches", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { checkout } = yield* openWithCompanions("let bad;\n", {});
      const eslint = yield* openSession(checkout, "eslint");
      const startsOf = (role: string) =>
        fileSystem
          .readFileString(`${checkout.cwd}/starts-${role}.log`)
          .pipe(Effect.map((log) => log.trim().split("\n").length));
      expect(yield* checkout.starts).toBe(1);

      yield* set(checkout.cwd, {
        type: "server",
        scope: "machine",
        server: "eslint",
        override: { settings: { validate: "off" } },
      });
      yield* eslint.state("starting");
      yield* eslint.state("ready");
      expect(yield* startsOf("eslint")).toBe(2);
      expect(yield* startsOf("tailwindcss")).toBe(1);
      expect(yield* checkout.starts).toBe(1);

      // The same settings again reach nothing.
      yield* set(checkout.cwd, {
        type: "server",
        scope: "machine",
        server: "eslint",
        override: { settings: { validate: "off" } },
      });
      expect(yield* startsOf("eslint")).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("refuses what isn't a server or a language's own, and changes nothing", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const refused = (change: LanguageServerSettingsChange) =>
        set(checkout.cwd, change).pipe(
          Effect.flip,
          Effect.map((error) => error.reason),
        );
      expect(
        yield* refused({
          type: "server",
          scope: "machine",
          server: "custom:nobody",
          override: { enabled: false },
        }),
      ).toBe("invalid");
      expect(
        yield* refused({
          type: "order",
          scope: "machine",
          language: "typescript",
          order: ["basedpyright"],
        }),
      ).toBe("invalid");
      expect(
        yield* refused({
          type: "custom",
          id: null,
          server: { ...customFor(checkout), languageIds: { "no/slash": "x" } },
        }),
      ).toBe("invalid");
      expect(
        yield* refused({
          type: "custom",
          id: null,
          server: { ...customFor(checkout), command: "relative/server" },
        }),
      ).toBe("invalid");
      expect(
        yield* refused({ type: "toolchain", kind: "python", path: "/usr/bin/not-listed" }),
      ).toBe("invalid");
      expect(
        yield* refused({
          type: "server",
          scope: "machine",
          server: "typescript",
          override: { binary: "bin/server" },
        }),
      ).toBe("invalid");
      expect(yield* service.settings(checkout.cwd)).toMatchObject({
        machine: { servers: {}, order: {} },
        custom: [],
      });
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("keeps what can hold a token from anyone who can only read", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const TOKEN = "s3cret-token";
      yield* set(checkout.cwd, {
        type: "server",
        scope: "project",
        server: "typescript",
        override: {
          args: [`--token=${TOKEN}`],
          env: { API_KEY: TOKEN },
          initializationOptions: { key: TOKEN },
          settings: { key: TOKEN },
        },
      });
      yield* set(checkout.cwd, {
        type: "custom",
        id: null,
        server: {
          ...customFor(checkout),
          args: [`--token=${TOKEN}`],
          env: { MINE_KEY: TOKEN },
        },
      });
      const session = yield* openSession(checkout);
      yield* session.state("ready");

      const checked = yield* service.check(checkout.cwd);
      expect(JSON.stringify(checked)).not.toContain(TOKEN);
      expect(checked.servers.map((server) => server.envNames)).toEqual([["API_KEY"], ["MINE_KEY"]]);
      expect(JSON.stringify(yield* routesIn(checkout.cwd))).not.toContain(TOKEN);
      expect(JSON.stringify(yield* service.settings(checkout.cwd))).toContain(TOKEN);

      const firstOf = (input: { readonly full?: boolean }) =>
        service
          .logs({ cwd: checkout.cwd, server: "typescript", ...input })
          .pipe(Stream.runHead, Effect.map(Option.getOrThrow));
      const reader = yield* firstOf({});
      expect(JSON.stringify(reader)).not.toContain(TOKEN);
      expect(reader.state?.info).toMatchObject({ args: [], argsHidden: true });
      expect((yield* firstOf({ full: true })).state?.info).toMatchObject({
        args: expect.arrayContaining([`--token=${TOKEN}`]),
        argsHidden: false,
      });
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("keeps a trace from a logs reader who can only read", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      const full = yield* openLogs(checkout, "typescript", true);
      yield* full.until(() => full.seen[0]);
      yield* service.setTrace({ cwd: checkout.cwd, server: "typescript", enabled: true });
      const reader = yield* openLogs(checkout);
      yield* reader.until(() => reader.seen[0]);
      yield* session.request(1, "test/state", {});
      yield* full.until(() => full.trace()[0]);
      yield* session.request(2, "test/state", {});
      yield* full.until(() => full.trace().find((entry) => entry.text.includes('"id":2')));
      expect(reader.trace()).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("leaves a start that fails without its command line in the log", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const checkout = yield* makeCheckout(SOURCE);
      // There, so it's chosen, but it can't be run.
      yield* checkout.write("not-runnable", "");
      yield* fileSystem.chmod(`${checkout.cwd}/not-runnable`, 0o644);
      yield* set(checkout.cwd, {
        type: "server",
        scope: "machine",
        server: "typescript",
        override: { binary: `${checkout.cwd}/not-runnable`, args: ["--token=s3cret-token"] },
      });
      const logs = yield* openLogs(checkout);
      const session = yield* openSession(checkout);
      yield* session.state("failed");
      const line = yield* logs.until(() =>
        logs.lines().find((entry) => entry.text.startsWith("Could not start")),
      );
      expect(line.text).not.toContain("s3cret-token");
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("leaves everything alone when its own file can't be read, and says so", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const { settingsProblem } = yield* service.check(checkout.cwd);
      expect(settingsProblem).toContain("can't be read");
      const failed = yield* set(checkout.cwd, {
        type: "server",
        scope: "machine",
        server: "typescript",
        override: { enabled: false },
      }).pipe(Effect.flip);
      expect(failed.message).toContain("can't be read");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.unwrap(
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem;
            const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-bad-" });
            yield* fileSystem.writeFileString(
              `${folder}/language-server-settings.json`,
              "{ not json",
            );
            return layerFor({ cacheDir: `${folder}/language-servers` });
          }).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
    ),
  );

  it.live("treats a settings file it can't read as unreadable, not as empty", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      expect((yield* service.check(checkout.cwd)).settingsProblem).toContain("can't be read");
      const failed = yield* set(checkout.cwd, {
        type: "server",
        scope: "machine",
        server: "typescript",
        override: { enabled: false },
      }).pipe(Effect.flip);
      expect(failed.message).toContain("can't be read");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.unwrap(
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem;
            const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-eisdir-" });
            // Reading this fails, as a file without permission would, and it isn't missing.
            yield* fileSystem.makeDirectory(`${folder}/language-server-settings.json`);
            return layerFor({ cacheDir: `${folder}/language-servers` });
          }).pipe(Effect.provide(NodeServices.layer)),
        ),
      ),
    ),
  );

  it.live("shows a server turned off as off, to everyone, until it's turned on", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout("let bad;\n");
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      yield* session.diagnostics((message) => message.params.diagnostics.length > 0);

      yield* set(checkout.cwd, {
        type: "server",
        scope: "project",
        server: "typescript",
        override: { enabled: false },
      });
      yield* session.diagnostics((message) => message.params.diagnostics.length === 0);
      expect(yield* session.state("disabled")).toMatchObject({
        message: "Off in settings.",
        memoryBytes: null,
      });
      expect(yield* checkout.starts).toBe(1);
      expect((yield* service.check(checkout.cwd)).servers[0]).toMatchObject({
        off: true,
        overrides: [{ field: "enabled", source: "project" }],
      });
      expect((yield* routesIn(checkout.cwd)).extensions.ts?.[0]).toMatchObject({
        server: "typescript",
        off: true,
      });
      const asked = yield* service
        .diagnostics({ cwd: checkout.cwd, relativePath: FILE })
        .pipe(Effect.flip);
      expect(asked).toMatchObject({ reason: "not-running" });
      expect(asked.message).toContain("off in the user's settings");
      // Restart can't get past settings: they're the way back.
      yield* service.restart({ cwd: checkout.cwd, server: "typescript" });
      yield* statuses((list) => list[0]?.state === "disabled");
      expect(yield* checkout.starts).toBe(1);

      yield* set(checkout.cwd, {
        type: "enabled",
        scope: "project",
        server: "typescript",
        enabled: true,
      });
      yield* session.state("ready");
      expect(yield* checkout.starts).toBe(2);
      yield* session.diagnostics((message) => message.params.diagnostics.length > 0);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("drops a companion turned off, and lets the language lead with who's left", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const { checkout } = yield* openWithCompanions("let bad;\nlet worse;\n", {
        roles: { eslint: { word: "worse", source: "eslint" }, tailwindcss: { word: "worst" } },
      });
      yield* set(checkout.cwd, {
        type: "server",
        scope: "machine",
        server: "eslint",
        override: { enabled: false },
      });
      const list = yield* statuses((all) =>
        all.some((status) => status.server === "eslint" && status.state === "disabled"),
      );
      expect(list.find((status) => status.server === "typescript")?.state).toBe("ready");
      const checked = yield* service.diagnostics({ cwd: checkout.cwd, relativePath: FILE });
      expect(checked.diagnostics.map((diagnostic) => diagnostic.source)).toEqual(["fake"]);

      yield* set(checkout.cwd, {
        type: "server",
        scope: "machine",
        server: "typescript",
        override: { enabled: false },
      });
      const routes = (yield* routesIn(checkout.cwd)).extensions.ts ?? [];
      expect(primaryLanguageServerRoute(routes)?.server).toBe("tailwindcss");
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withBoth }))),
  );

  it.live("runs a language's servers in the order chosen, and tells those following", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout("x = 1\n");
      yield* checkout.write("main.py", "bad = 1\n");
      const order = () =>
        routesIn(checkout.cwd).pipe(
          Effect.map(({ extensions }) => extensions.py?.map((route) => route.server)),
        );
      expect(yield* order()).toEqual(["basedpyright", "ruff"]);
      const seen = yield* Queue.unbounded<LanguageServerRoutes>();
      yield* service.routes(checkout.cwd).pipe(
        Stream.runForEach((routes) => Queue.offer(seen, routes)),
        Effect.forkScoped,
      );
      yield* Queue.take(seen);
      yield* set(checkout.cwd, {
        type: "order",
        scope: "machine",
        language: "basedpyright",
        order: ["ruff", "basedpyright"],
      });
      const next = yield* Queue.take(seen);
      expect(next.extensions.py?.map((route) => route.server)).toEqual(["ruff", "basedpyright"]);
      expect((yield* service.check(checkout.cwd)).servers.map((check) => check.server)).toEqual([
        "ruff",
        "basedpyright",
      ]);
      // A session on the new primary still has the language's other server beside it.
      const session = yield* openSession(checkout, "ruff");
      yield* session.state("ready");
      yield* session.open(NodeURL.pathToFileURL(`${checkout.cwd}/main.py`).href);
      yield* statuses((list) =>
        list.some((status) => status.server === "basedpyright" && status.state === "ready"),
      );
      // A project's order takes over from the machine's.
      yield* set(checkout.cwd, {
        type: "order",
        scope: "project",
        language: "basedpyright",
        order: ["basedpyright", "ruff"],
      });
      expect(yield* order()).toEqual(["basedpyright", "ruff"]);
      yield* set(checkout.cwd, {
        type: "order",
        scope: "project",
        language: "basedpyright",
        order: [],
      });
      expect(yield* order()).toEqual(["ruff", "basedpyright"]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: pythonSpecs }))),
  );

  it.live("asks the next server when the one leading a language can't find a symbol", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE, {
        roles: { eslint: { without: ["definitionProvider"] } },
      });
      yield* checkout.write("eslint.config.js", "");
      yield* set(checkout.cwd, {
        type: "order",
        scope: "machine",
        language: "typescript",
        order: ["eslint", "typescript"],
      });
      const { locations } = yield* service.locate({
        cwd: checkout.cwd,
        relativePath: FILE,
        line: 2,
        symbol: "point",
        kind: "definition",
      });
      expect(locations[0]).toMatchObject({ path: FILE, line: 1 });
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withEslint }))),
  );

  it.live("doesn't let a server the checkout has no use for lead its language", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE);
      yield* set(checkout.cwd, {
        type: "order",
        scope: "machine",
        language: "typescript",
        order: ["eslint", "typescript"],
      });
      const routes = (yield* routesIn(checkout.cwd)).extensions.ts ?? [];
      expect(routes.map((route) => route.server)).toEqual(["typescript"]);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: withEslint }))),
  );

  describe("in a checkout's own file", () => {
    const FILE_PATH = ".astrolabe/language-servers.json";
    const ours = (settings: object) => JSON.stringify({ servers: { typescript: { settings } } });

    it.live("reads it only once the project is trusted", () =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        yield* checkout.write(FILE_PATH, ours({ fake: { level: "file" } }));
        const before = yield* service.check(checkout.cwd);
        expect(before.projectFile).toMatchObject({ read: false, problem: null });
        expect(before.servers[0]?.overrides).toEqual([]);
        yield* service.trustProject(checkout.cwd);
        const after = yield* service.check(checkout.cwd);
        expect(after.projectFile.read).toBe(true);
        expect(after.servers[0]?.overrides).toEqual([{ field: "settings", source: "file" }]);
      }).pipe(Effect.scoped, Effect.provide(layerFor({ trusted: undefined }))),
    );

    it.live("ranks it above machine settings and below the project's", () =>
      Effect.gen(function* () {
        const checkout = yield* makeCheckout(SOURCE);
        yield* checkout.write(
          FILE_PATH,
          ours({ fake: { level: "file", seen: "file" }, only: "file" }),
        );
        yield* set(checkout.cwd, {
          type: "server",
          scope: "machine",
          server: "typescript",
          override: { settings: { fake: { level: "machine", seen: "machine" } } },
        });
        yield* set(checkout.cwd, {
          type: "server",
          scope: "project",
          server: "typescript",
          override: { settings: { fake: { level: "project" } } },
        });
        const session = yield* openSession(checkout);
        yield* session.state("ready");
        const answer = yield* session.request(1, "test/configuration", {
          items: [{ section: "fake" }, { section: "only" }],
        });
        expect(answer.result).toEqual([{ level: "project", seen: "file" }, "file"]);
      }).pipe(Effect.scoped, Effect.provide(layerFor())),
    );

    it.live("shows a bad file in Settings and the status, and is otherwise ignored", () =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        const bad = [
          ["{ nope", "isn't valid JSON"],
          ['{"servers":{"nobody":{}}}', '"nobody", which isn\'t a language server'],
          ['{"servers":{"typescript":{"binary":"/evil"}}}', '"binary"'],
          ['{"servers":{"typescript":{"command":"/evil"}}}', '"command"'],
          ['{"servers":{"typescript":{"args":["--evil"]}}}', '"args"'],
          ['{"servers":{"typescript":{"env":{"A":"b"}}}}', '"env"'],
          ['{"servers":{"typescript":{"settings":3}}}', "must be objects"],
          ['{"servers":{},"custom":[]}', '"custom"'],
        ] as const;
        for (const [text, says] of bad) {
          yield* checkout.write(FILE_PATH, text);
          const { projectFile, servers } = yield* service.check(checkout.cwd);
          expect(projectFile.problem).toContain(says);
          expect(servers[0]?.overrides).toEqual([]);
        }
        const session = yield* openSession(checkout);
        const ready = yield* session.state("ready");
        expect(ready.message).toContain(FILE_PATH);

        // There but unreadable is a problem too, not the same as having none.
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.remove(`${checkout.cwd}/${FILE_PATH}`);
        expect((yield* service.check(checkout.cwd)).projectFile).toMatchObject({
          read: false,
          problem: null,
        });
        yield* fileSystem.makeDirectory(`${checkout.cwd}/${FILE_PATH}`);
        expect((yield* service.check(checkout.cwd)).projectFile.problem).toContain("can't be read");
      }).pipe(Effect.scoped, Effect.provide(layerFor())),
    );

    it.live("applies a change to it, restarting the servers it reaches", () =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        const session = yield* openSession(checkout);
        yield* session.state("ready");
        yield* checkout.write(FILE_PATH, ours({ fake: { level: "file" } }));
        yield* service.filesChanged({
          cwd: checkout.cwd,
          changes: [{ relativePath: FILE_PATH, type: "created" }],
        });
        yield* session.state("starting");
        yield* session.state("ready");
        const answer = yield* session.request(1, "test/configuration", {
          items: [{ section: "fake" }],
        });
        expect(answer.result).toEqual([{ level: "file" }]);
      }).pipe(Effect.scoped, Effect.provide(layerFor())),
    );
  });

  describe("for a server of someone's own", () => {
    const foo = (checkout: Checkout) => NodeURL.pathToFileURL(`${checkout.cwd}/src/app.foo`).href;

    it.live("serves an extension nothing else does, for editors, agents and logs alike", () =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        yield* checkout.write("src/app.foo", "let bad;\n");
        expect((yield* routesIn(checkout.cwd)).extensions.foo).toBeUndefined();
        yield* set(checkout.cwd, { type: "custom", id: null, server: customFor(checkout) });
        const routes = (yield* routesIn(checkout.cwd)).extensions.foo ?? [];
        expect(routes).toEqual([
          {
            server: "custom:my-lang",
            name: "My Lang",
            languageId: "foolang",
            off: false,
            toolchain: null,
          },
        ]);
        const session = yield* openSession(checkout, "custom:my-lang");
        yield* session.state("ready");
        yield* session.open(foo(checkout));
        const published = yield* session.diagnostics(
          (message) => message.params.diagnostics.length > 0,
        );
        expect(published.params.diagnostics[0].range.start.line).toBe(0);
        const state = yield* stateOf(session, 1);
        expect(state.docs[foo(checkout)].languageId).toBe("foolang");
        const checked = yield* service.diagnostics({
          cwd: checkout.cwd,
          relativePath: "src/app.foo",
        });
        expect(checked.diagnostics).toHaveLength(1);
        const logs = yield* openLogs(checkout, "custom:my-lang");
        yield* logs.until(() => logs.lines().find((line) => line.text === "fake is starting"));
        const { servers } = yield* service.check(checkout.cwd);
        expect(servers.at(-1)).toMatchObject({
          server: "custom:my-lang",
          state: "found",
          language: null,
          languages: ".foo",
        });
      }).pipe(Effect.scoped, Effect.provide(layerFor())),
    );

    it.live("replaces the default on its extensions, or joins it, and leaves when removed", () =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout("let bad;\n");
        const order = () =>
          routesIn(checkout.cwd).pipe(
            Effect.map(({ extensions }) => extensions.ts?.map((route) => route.server)),
          );
        const server = {
          ...customFor(checkout),
          languageIds: { ".TS": "typescript" },
          replaces: true,
        };
        yield* set(checkout.cwd, { type: "custom", id: null, server });
        const id = "custom:my-lang";
        expect(yield* order()).toEqual([id, "eslint"]);
        expect((yield* routesIn(checkout.cwd)).extensions.mts?.[0]?.server).toBe("typescript");
        const { servers } = yield* service.check(checkout.cwd);
        expect(servers.find((check) => check.server === "typescript")?.replacedBy).toEqual([
          "My Lang",
        ]);

        const session = yield* openSession(checkout, id);
        yield* session.state("ready");
        yield* session.open(checkout.uri);
        yield* session.diagnostics((message) => message.params.diagnostics.length > 0);

        yield* set(checkout.cwd, {
          type: "custom",
          id,
          server: { ...server, name: "Renamed", replaces: false },
        });
        yield* session.state("starting");
        expect((yield* session.state("ready")).name).toBe("Renamed");
        expect(yield* order()).toEqual(["typescript", "eslint", id]);

        yield* set(checkout.cwd, {
          type: "server",
          scope: "machine",
          server: id,
          override: { settings: { kept: false } },
        });
        yield* session.state("starting");
        yield* session.state("ready");
        yield* set(checkout.cwd, { type: "removeCustom", id });
        expect(yield* order()).toEqual(["typescript", "eslint"]);
        // Gone, not off: nothing lists it, and a session bound to it ends.
        const list = yield* statuses((all) => !all.some((status) => status.server === id));
        expect(list.map((status) => status.state)).not.toContain("disabled");
        expect(Exit.isFailure(yield* Effect.exit(session.state("ready")))).toBe(true);
        expect(
          (yield* service.logs({ cwd: checkout.cwd, server: id }).pipe(Stream.runHead, Effect.flip))
            .reason,
        ).toBe("unsupported");
        // Its settings went with it.
        expect((yield* service.settings(checkout.cwd)).machine.servers).toEqual({});
        // Anything still bound to it hears it can't be had.
        const gone = yield* service
          .session({ cwd: checkout.cwd, server: "custom:nobody", sessionId: "gone" })
          .pipe(Stream.runHead, Effect.flip);
        expect(gone.reason).toBe("unsupported");
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerFor({
            specs: { ...fakeSpecs, eslint: companionSpec("eslint") },
          }),
        ),
      ),
    );

    it.live("runs only in a trusted project", () =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        yield* set(checkout.cwd, { type: "custom", id: null, server: customFor(checkout) });
        const session = yield* openSession(checkout, "custom:my-lang");
        expect((yield* session.state("trust-needed")).message).toContain("can run code");
        expect((yield* service.check(checkout.cwd)).servers.at(-1)).toMatchObject({
          state: "trust",
          executable: null,
        });
        yield* service.trustProject(checkout.cwd);
        yield* session.state("ready");
      }).pipe(Effect.scoped, Effect.provide(layerFor({ trusted: undefined }))),
    );

    it.live("shows a start that fails, and its logs", () =>
      Effect.gen(function* () {
        const checkout = yield* makeCheckout(SOURCE, { roles: { mine: { crashTimes: 99 } } });
        yield* set(checkout.cwd, { type: "custom", id: null, server: customFor(checkout) });
        const logs = yield* openLogs(checkout, "custom:my-lang");
        const session = yield* openSession(checkout, "custom:my-lang");
        expect((yield* session.state("failed")).message).toContain("boom");
        yield* logs.until(() => logs.lines().find((line) => line.text === "boom"));

        yield* set(checkout.cwd, {
          type: "custom",
          id: "custom:my-lang",
          server: { ...customFor(checkout), command: "/nowhere/server" },
        });
        expect((yield* session.state("missing")).message).toContain("/nowhere/server");
      }).pipe(Effect.scoped, Effect.provide(layerFor())),
    );

    it.live("runs only where its root files are, when it names any", () =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const checkout = yield* makeCheckout(SOURCE);
        yield* set(checkout.cwd, {
          type: "custom",
          id: null,
          server: { ...customFor(checkout), rootFiles: ["foo.toml"] },
        });
        expect((yield* routesIn(checkout.cwd)).extensions.foo).toBeUndefined();
        expect((yield* service.check(checkout.cwd)).servers.at(-1)?.companion).toEqual({
          active: false,
          reason: "Not active: no foo.toml at this checkout's root.",
        });
        yield* checkout.write("foo.toml", "");
        yield* service.restart({ cwd: checkout.cwd, server: "typescript" });
        expect((yield* routesIn(checkout.cwd)).extensions.foo?.[0]?.server).toBe("custom:my-lang");
      }).pipe(Effect.scoped, Effect.provide(layerFor())),
    );
  });

  describe("choosing a toolchain", () => {
    it.live(
      "passes the chosen interpreter to the server reading it, and goes back to automatic",
      () =>
        Effect.gen(function* () {
          const service = yield* LanguageServers.LanguageServers;
          const fileSystem = yield* FileSystem.FileSystem;
          const checkout = yield* makeCheckout("x = 1\n");
          yield* checkout.write("main.py", "bad = 1\n");
          yield* checkout.write(".venv/bin/python", "");
          yield* checkout.write(".venv/pyvenv.cfg", "home = /x\nuv = 0.5\nversion_info = 3.12.1\n");
          yield* checkout.write("envs-a/bin/python", "");
          yield* checkout.write("envs-a/pyvenv.cfg", "version = 3.11.4\n");
          const automatic = `${checkout.cwd}/.venv/bin/python`;
          const chosen = `${checkout.cwd}/envs-a/bin/python`;
          // Never run: a checkout's interpreter is its code.
          yield* fileSystem.writeFileString(chosen, "#!/bin/sh\ntouch ran\n");
          yield* fileSystem.chmod(chosen, 0o755);

          const found = yield* service.toolchains(checkout.cwd);
          expect(found).toMatchObject({
            kind: "python",
            selected: null,
            trusted: true,
            active: { path: automatic, label: ".venv (uv)", version: "3.12.1" },
          });
          expect(found.options.slice(0, 2)).toEqual([
            { path: automatic, label: ".venv (uv)", version: "3.12.1" },
            { path: chosen, label: "envs-a", version: "3.11.4" },
          ]);

          const session = yield* openSession(checkout, "basedpyright");
          yield* session.state("ready");
          const pythonPath = (id: number) =>
            session
              .request(id, "test/configuration", { items: [{ section: "python" }] })
              .pipe(Effect.map((answer) => answer.result[0].pythonPath));
          yield* session.open(NodeURL.pathToFileURL(`${checkout.cwd}/main.py`).href);
          yield* statuses((list) => list.filter((status) => status.state === "ready").length === 2);
          expect(yield* pythonPath(1)).toBe(automatic);

          yield* service.updateSettings({
            cwd: checkout.cwd,
            change: { type: "toolchain", kind: "python", path: chosen },
          });
          yield* session.state("starting");
          yield* session.state("ready");
          expect(yield* pythonPath(2)).toBe(chosen);
          expect(yield* checkout.starts).toBe(0);
          const startsOf = (role: string) =>
            fileSystem
              .readFileString(`${checkout.cwd}/starts-${role}.log`)
              .pipe(Effect.map((log) => log.trim().split("\n").length));
          expect(yield* startsOf("basedpyright")).toBe(2);
          expect(yield* startsOf("ruff")).toBe(1);
          expect(yield* service.toolchains(checkout.cwd)).toMatchObject({
            selected: chosen,
            active: { path: chosen },
          });

          yield* service.updateSettings({
            cwd: checkout.cwd,
            change: { type: "toolchain", kind: "python", path: null },
          });
          yield* session.state("starting");
          yield* session.state("ready");
          expect(yield* pythonPath(3)).toBe(automatic);
          expect(yield* fileSystem.exists(`${checkout.cwd}/ran`)).toBe(false);
        }).pipe(Effect.scoped, Effect.provide(layerFor({ specs: pythonSpecs }))),
    );

    it.live("says when the chosen interpreter is gone, and doesn't pretend it's in use", () =>
      Effect.gen(function* () {
        const service = yield* LanguageServers.LanguageServers;
        const fileSystem = yield* FileSystem.FileSystem;
        const checkout = yield* makeCheckout("x = 1\n");
        yield* checkout.write("envs-a/bin/python", "");
        yield* checkout.write("envs-a/pyvenv.cfg", "version = 3.11.4\n");
        const chosen = `${checkout.cwd}/envs-a/bin/python`;
        const hintOf = service
          .check(checkout.cwd)
          .pipe(Effect.map(({ servers }) => servers[0]?.message));
        const choose = (path: string | null) =>
          service.updateSettings({
            cwd: checkout.cwd,
            change: { type: "toolchain", kind: "python", path },
          });
        expect(yield* hintOf).toBe("No venv here.");
        yield* choose(chosen);
        expect(yield* hintOf).toBeNull();
        expect(yield* service.toolchains(checkout.cwd)).toMatchObject({
          selected: chosen,
          selectedMissing: false,
          active: { path: chosen },
        });

        yield* fileSystem.remove(`${checkout.cwd}/envs-a`, { recursive: true });
        yield* checkout.write(".venv/bin/python", "");
        expect(yield* service.toolchains(checkout.cwd)).toMatchObject({
          selected: chosen,
          selectedMissing: true,
          active: { path: `${checkout.cwd}/.venv/bin/python` },
        });
        yield* fileSystem.remove(`${checkout.cwd}/.venv`, { recursive: true });
        expect(yield* hintOf).toBe("No venv here.");
        yield* choose(null);
        expect(yield* service.toolchains(checkout.cwd)).toMatchObject({
          selected: null,
          selectedMissing: false,
        });
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerFor({
            specs: {
              basedpyright: {
                ...pythonSpecs.basedpyright,
                hint: { unless: [".venv", "venv"], message: "No venv here." },
              },
            },
          }),
        ),
      ),
    );

    it.live("tells nothing of a chosen interpreter while the project isn't trusted", () =>
      withMachineServer((specs) =>
        Effect.gen(function* () {
          const service = yield* LanguageServers.LanguageServers;
          const checkout = yield* makeCheckout("x = 1\n");
          yield* checkout.write(".venv/bin/python", "");
          const chosen = `${checkout.cwd}/.venv/bin/python`;
          yield* service.updateSettings({
            cwd: checkout.cwd,
            change: { type: "toolchain", kind: "python", path: chosen },
          });
          expect(yield* service.toolchains(checkout.cwd)).toMatchObject({
            selected: chosen,
            trusted: false,
            active: null,
          });
          const session = yield* openSession(checkout, "basedpyright");
          yield* session.state("ready");
          const answer = yield* session.request(1, "test/configuration", {
            items: [{ section: "python" }],
          });
          expect(answer.result[0]).toEqual({});
        }).pipe(
          Effect.scoped,
          Effect.provide(
            layerFor({
              specs: {
                basedpyright: {
                  ...specs.typescript!,
                  id: "basedpyright",
                  launches: [
                    {
                      ...specs.typescript!.launches[1]!,
                      settings: { python: { pythonPath: "{python}" } },
                    },
                  ],
                },
              },
              trusted: undefined,
            }),
          ),
        ),
      ),
    );
  });
});

describe("LanguageServers logs", () => {
  it.live("streams a server's stderr and messages, keeping them across its restarts", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE, { crashTimes: 1 });
      const logs = yield* openLogs(checkout);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* logs.until(() => logs.lines().find((line) => line.text === "fake is starting"));
      const lines = logs.lines();
      expect(lines.find((line) => line.text === "boom")).toMatchObject({ source: "stderr" });
      expect(lines.find((line) => line.text === "fake is starting")).toMatchObject({
        source: "log",
        severity: "info",
      });
      yield* logs.until(() => logs.lines().find((line) => line.text === "fake wants a look"));
      expect(logs.lines().find((line) => line.text === "fake wants a look")).toMatchObject({
        source: "message",
        severity: "warning",
      });
      const info = yield* logs.until(() =>
        logs.seen.flatMap((item) => item.state?.info ?? []).findLast((i) => i.state === "ready"),
      );
      expect(info).toMatchObject({
        binary: `${checkout.cwd}/fake-server.mjs`,
        cwd: checkout.cwd,
        version: "9.9.9",
      });
      expect(info.pid).toBeGreaterThan(0);
      expect(JSON.parse(info.capabilities!)).toMatchObject({ referencesProvider: true });

      yield* logs.close;
      const again = yield* openLogs(checkout);
      yield* again.until(() => again.seen[0]);
      const [snapshot] = again.seen;
      expect(snapshot?.type).toBe("snapshot");
      expect(snapshot?.lines.map((line) => line.text)).toContain("boom");
      yield* service.stop({ cwd: checkout.cwd, server: "typescript" });
      const stopped = yield* again.until(() =>
        again.seen.flatMap((item) => item.state?.info ?? []).find((i) => i.state === "stopped"),
      );
      expect(stopped).toMatchObject({ pid: null, capabilities: null });
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("hands a burst of output over in batches", () =>
    Effect.gen(function* () {
      const checkout = yield* makeCheckout(SOURCE, { chatter: 400 });
      const logs = yield* openLogs(checkout);
      yield* openSession(checkout);
      yield* logs.until(() => logs.lines().find((line) => line.text === "chatter 400"));
      expect(logs.seen.length).toBeLessThan(40);
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("records a trace only while it is on, and only while someone reads it", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const target = { cwd: checkout.cwd, server: "typescript" } as const;
      const refused = yield* service.setTrace({ ...target, enabled: true }).pipe(Effect.flip);
      expect(refused.reason).toBe("not-running");
      const logs = yield* openLogs(checkout, "typescript", true);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* session.open(checkout.uri);
      yield* session.diagnostics();
      expect(logs.trace()).toEqual([]);

      yield* service.setTrace({ ...target, enabled: true });
      yield* session.request(1, "textDocument/hover", {
        textDocument: { uri: checkout.uri },
        position: { line: 0, character: 6 },
      });
      yield* logs.until(() => logs.trace().find((entry) => entry.direction === "received"));
      expect(
        logs
          .trace()
          .find((entry) => entry.direction === "sent")
          ?.text.includes("textDocument/hover"),
      ).toBe(true);

      yield* service.setTrace({ ...target, enabled: false });
      yield* logs.until(() =>
        logs.seen.some((item) => item.state?.tracing === false) ? true : undefined,
      );
      const before = logs.trace().length;
      yield* session.request(2, "textDocument/hover", {
        textDocument: { uri: checkout.uri },
        position: { line: 0, character: 6 },
      });
      const off = yield* openLogs(checkout, "typescript", true);
      yield* off.until(() => off.seen[0]);
      expect(off.seen[0]?.trace).toHaveLength(before);
      yield* off.close;

      // With the last reader gone it stops, and what it held goes.
      yield* service.setTrace({ ...target, enabled: true });
      yield* logs.close;
      const after = yield* openLogs(checkout, "typescript", true);
      yield* after.until(() => after.seen[0]);
      expect(after.seen[0]).toMatchObject({ trace: [], state: { tracing: false } });
    }).pipe(Effect.scoped, Effect.provide(layerFor())),
  );

  it.live("keeps a trace through its reader's absence, for a tab hidden behind another", () =>
    Effect.gen(function* () {
      const service = yield* LanguageServers.LanguageServers;
      const checkout = yield* makeCheckout(SOURCE);
      const logs = yield* openLogs(checkout, "typescript", true);
      const session = yield* openSession(checkout);
      yield* session.state("ready");
      yield* service.setTrace({ cwd: checkout.cwd, server: "typescript", enabled: true });
      yield* logs.close;
      yield* session.request(1, "textDocument/hover", {
        textDocument: { uri: checkout.uri },
        position: { line: 0, character: 6 },
      });
      const back = yield* openLogs(checkout, "typescript", true);
      yield* back.until(() => back.seen[0]);
      expect(back.seen[0]).toMatchObject({ state: { tracing: true } });
      expect(back.seen[0]?.trace.length).toBeGreaterThan(0);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ traceGrace: "1 hour" }))),
  );
});
