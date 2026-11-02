import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { encodeMessage, MessageDecoder } from "./framing.ts";
import { parseJson } from "./json.ts";

/** JSON-RPC to one language-server process over stdio. Writes are synchronous and ordered. */

export const RequestCancelled = -32800;
export const ContentModified = -32801;
export const ServerCancelled = -32802;
const MethodNotFound = -32601;

export class ResponseError extends Data.TaggedError("ResponseError")<{
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}> {}

export interface LspCommand {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface LspHandlers {
  readonly onNotification: (method: string, params: unknown) => void;
  /**
   * Answers the server's own requests; `undefined` means the method isn't supported. A promise
   * answers when it settles.
   */
  readonly onRequest: (method: string, params: unknown) => unknown;
}

export interface LspConnection {
  readonly pid: number;
  /** Writes the request now; the answer arrives on `response`. */
  readonly request: (
    method: string,
    params: unknown,
  ) => { readonly id: number; readonly response: Effect.Effect<unknown, ResponseError> };
  readonly notify: (method: string, params?: unknown) => void;
  readonly cancel: (id: number) => void;
  /** The exit code, once the process is gone. */
  readonly exited: Effect.Effect<number>;
  /** The end of what the process wrote to stderr. */
  readonly stderrTail: () => string;
}

const STDERR_KEPT = 4000;

/** Spawns the process in the current scope, which kills it when it closes. */
export const connect = Effect.fn("LanguageServers.connect")(function* (
  command: LspCommand,
  handlers: LspHandlers,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const input = yield* Queue.unbounded<Uint8Array>();
  const child = yield* spawner.spawn(
    ChildProcess.make(command.executable, [...command.args], {
      cwd: command.cwd,
      env: command.env,
      extendEnv: false,
      stdin: { stream: Stream.fromQueue(input) },
      forceKillAfter: "2 seconds",
    }),
  );
  const pending = new Map<number, Deferred.Deferred<unknown, ResponseError>>();
  const exited = yield* Deferred.make<number>();
  let nextId = 1;
  let stderr = "";
  const write = (message: object) => {
    Queue.offerUnsafe(input, encodeMessage({ jsonrpc: "2.0", ...message }));
  };

  const dispatch = (message: {
    readonly id?: number | string | null;
    readonly method?: string;
    readonly params?: unknown;
    readonly result?: unknown;
    readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
  }) => {
    if (message.method === undefined) {
      if (typeof message.id !== "number") return;
      const deferred = pending.get(message.id);
      if (deferred === undefined) return;
      pending.delete(message.id);
      Deferred.doneUnsafe(
        deferred,
        message.error
          ? Exit.fail(new ResponseError(message.error))
          : Exit.succeed(message.result ?? null),
      );
      return;
    }
    if (message.id === undefined || message.id === null) {
      handlers.onNotification(message.method, message.params);
      return;
    }
    const result = handlers.onRequest(message.method, message.params);
    const id = message.id;
    if (result instanceof Promise) {
      void result.then(
        (value) => write({ id, result: value ?? null }),
        () => write({ id, error: { code: -32603, message: "Failed" } }),
      );
      return;
    }
    write(
      result === undefined
        ? { id: message.id, error: { code: MethodNotFound, message: "Not supported" } }
        : { id: message.id, result },
    );
  };

  const decoder = new MessageDecoder();
  yield* child.stdout.pipe(
    Stream.runForEach((chunk) =>
      Effect.try(() => {
        for (const text of decoder.push(chunk)) {
          const message = parseJson(text);
          if (typeof message === "object" && message !== null) dispatch(message);
        }
      }),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );
  const stderrDone = yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((text) =>
      Effect.sync(() => {
        stderr = (stderr + text).slice(-STDERR_KEPT);
      }),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );
  yield* child.exitCode.pipe(
    Effect.map(Number),
    Effect.orElseSucceed(() => -1),
    // What it wrote last is usually why it stopped.
    Effect.tap(() => Fiber.await(stderrDone)),
    Effect.flatMap((code) =>
      Effect.sync(() => {
        for (const deferred of pending.values()) {
          Deferred.doneUnsafe(
            deferred,
            Exit.fail(new ResponseError({ code: -32099, message: "The language server stopped." })),
          );
        }
        pending.clear();
        Deferred.doneUnsafe(exited, Exit.succeed(code));
      }),
    ),
    Effect.forkScoped,
  );

  return {
    pid: Number(child.pid),
    request: (method, params) => {
      const id = nextId++;
      const deferred = Deferred.makeUnsafe<unknown, ResponseError>();
      if (Deferred.isDoneUnsafe(exited)) {
        Deferred.doneUnsafe(
          deferred,
          Exit.fail(new ResponseError({ code: -32099, message: "The language server stopped." })),
        );
      } else {
        pending.set(id, deferred);
        write({ id, method, params });
      }
      return { id, response: Deferred.await(deferred) };
    },
    notify: (method, params) => write(params === undefined ? { method } : { method, params }),
    cancel: (id) => {
      if (pending.has(id)) write({ method: "$/cancelRequest", params: { id } });
    },
    exited: Deferred.await(exited),
    stderrTail: () => stderr,
  } satisfies LspConnection;
});
