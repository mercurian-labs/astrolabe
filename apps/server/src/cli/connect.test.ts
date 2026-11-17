// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises the Node HTTP boundary.
import * as NodeHttp from "node:http";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import * as RelayClient from "@t3tools/shared/relayClient";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Terminal from "effect/Terminal";
import * as TestClock from "effect/testing/TestClock";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { makeCli } from "../binCli.ts";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import * as ExternalLauncher from "../process/externalLauncher.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import { acquireRelayClientForLink, authorizeCli } from "./connect.ts";

const managedExecutable = {
  status: "available",
  executablePath: "/tmp/cloudflared",
  source: "managed",
  version: RelayClient.CLOUDFLARED_VERSION,
} as const;

it.effect("does not install the relay client when the user declines the managed download", () =>
  Effect.gen(function* () {
    let installCalls = 0;
    const result = yield* acquireRelayClientForLink(
      {
        resolve: Effect.succeed({
          status: "missing",
          version: RelayClient.CLOUDFLARED_VERSION,
        }),
        install: Effect.sync(() => {
          installCalls += 1;
          return managedExecutable;
        }),
        installWithProgress: () =>
          Effect.sync(() => {
            installCalls += 1;
            return managedExecutable;
          }),
        pruneManagedVersions: Effect.void,
      },
      () => Effect.succeed(false),
      () => Effect.void,
    );

    assert.isTrue(Option.isNone(result));
    assert.equal(installCalls, 0);
  }),
);

const DEVICE_APPROVAL_URL = "https://auth.example.test/device?user_code=BCDF-GHJK";

/**
 * Hands out a device code polled every 5s and approves it on the first poll, which runs only
 * once the test clock passes those 5s.
 */
const layerDeviceCodeServer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => {
    const json = (body: unknown) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    switch (new URL(request.url).pathname) {
      case "/api/auth/device/code":
        return json({
          device_code: "device-code-1",
          user_code: "BCDF-GHJK",
          verification_uri: "https://auth.example.test/device",
          verification_uri_complete: DEVICE_APPROVAL_URL,
          expires_in: 600,
          interval: 5,
        });
      case "/api/auth/device/token":
        return json({ access_token: "session-1", token_type: "Bearer" });
      case "/api/auth/get-session":
        return json(null);
      case "/api/auth/token":
        return json({ token: "relay-token-1" });
      default:
        return Effect.die(`unexpected request to ${request.url}`);
    }
  }),
);

/** Signs in on a terminal whose keys come from `input`, recording what it printed, opened and stored. */
const signInWith = (input: Queue.Queue<Terminal.UserInput, Cause.Done>) => {
  const lines: Array<string> = [];
  const opened: Array<string> = [];
  const stored: Array<string> = [];
  const run = authorizeCli({ headless: false }).pipe(
    Effect.provideService(
      CliTokenManager.CloudCliTokenManager,
      CliTokenManager.CloudCliTokenManager.of({
        getExisting: Effect.succeedNone,
        hasCredential: Effect.succeed(false),
        store: (token) =>
          Effect.sync(() => {
            stored.push(token.accessToken);
          }),
        clear: Effect.void,
      }),
    ),
    Effect.provideService(
      Terminal.Terminal,
      Terminal.make({
        columns: Effect.succeed(80),
        rows: Effect.succeed(24),
        size: Queue.unbounded<Terminal.Size, Cause.Done>(),
        readInput: Effect.succeed(Queue.asDequeue(input)),
        readLine: Effect.die("unexpected line input"),
        display: () => Effect.void,
      }),
    ),
    Effect.provideService(
      ExternalLauncher.ExternalLauncher,
      ExternalLauncher.ExternalLauncher.of({
        resolveAvailableEditors: () => Effect.die("unexpected editor lookup"),
        resolveFileManagerRevealKind: () => Effect.die("unexpected file manager lookup"),
        launchBrowser: (url) =>
          Effect.sync(() => {
            opened.push(url);
          }),
        launchEditor: () => Effect.die("unexpected editor launch"),
      }),
    ),
    Effect.provideService(Console.Console, {
      ...globalThis.console,
      log: (...args) => {
        lines.push(args.map(String).join(" "));
      },
    }),
    Effect.provide(
      Layer.mergeAll(
        layerDeviceCodeServer,
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { T3CODE_AUTH_URL: "https://auth.example.test" } }),
        ),
      ),
    ),
  );
  return { run, lines, opened, stored };
};

it.effect("Ctrl+C cancels a pending device-code sign-in after Enter opened the browser", () =>
  Effect.gen(function* () {
    const input = yield* Queue.make<Terminal.UserInput, Cause.Done>();
    // A raw-mode terminal delivers Ctrl+C as a key press, then ends its input.
    yield* Queue.offerAll(input, [
      { input: Option.some("\r"), key: { name: "return", ctrl: false, meta: false, shift: false } },
      { input: Option.some("\u0003"), key: { name: "c", ctrl: true, meta: false, shift: false } },
    ]);
    yield* Queue.end(input);
    const signIn = signInWith(input);

    const exit = yield* Effect.exit(signIn.run);

    assert.include(signIn.lines.join("\n"), "BCDF-GHJK");
    assert.deepEqual(signIn.opened, [DEVICE_APPROVAL_URL]);
    assert.deepEqual(signIn.stored, []);
    assert.isTrue(Exit.isFailure(exit) && Terminal.isQuitError(Cause.squash(exit.cause)));
  }),
);

it.effect("input that ends without a key leaves the sign-in waiting for approval", () =>
  Effect.gen(function* () {
    const input = yield* Queue.make<Terminal.UserInput, Cause.Done>();
    // A script's or an agent's shell: stdin is already at its end, and no key arrives.
    yield* Queue.end(input);
    const signIn = signInWith(input);

    const fiber = yield* Effect.forkChild(signIn.run);
    yield* TestClock.adjust("5 seconds");
    const identity = yield* Fiber.join(fiber);

    assert.isNull(identity);
    assert.deepEqual(signIn.stored, ["relay-token-1"]);
    assert.deepEqual(signIn.opened, []);
  }),
);

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer))(
  "astrolabe connect unlink",
  (it) => {
    const runUnlink = (recordedPid: number, options?: { readonly portFreed?: boolean }) =>
      Effect.gen(function* () {
        const requests: Array<string> = [];
        const warnings: Array<string> = [];
        const server = yield* Effect.acquireRelease(
          Effect.callback<NodeHttp.Server>((resume) => {
            const listening = NodeHttp.createServer((request, response) => {
              requests.push(`${request.method} ${request.url}`);
              response.writeHead(200, { "content-type": "application/json" });
              response.end(JSON.stringify({ ok: true, endpointRuntimeStatus: null }));
            });
            listening.listen(0, "127.0.0.1", () => resume(Effect.succeed(listening)));
          }),
          (listening) => Effect.sync(() => listening.close()),
        );
        const address = server.address();
        if (address === null || typeof address === "string") {
          return yield* Effect.die(new Error("Expected a TCP address"));
        }
        if (options?.portFreed) {
          yield* Effect.callback<void>((resume) => {
            server.close(() => resume(Effect.void));
          });
        }

        const fs = yield* FileSystem.FileSystem;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-connect-unlink-test-" });
        const state = yield* makePersistedServerRuntimeState({
          config: { host: "127.0.0.1", devUrl: undefined },
          port: address.port,
        });
        yield* persistServerRuntimeState({
          path: `${baseDir}/userdata/server-runtime.json`,
          state: { ...state, pid: recordedPid },
        });

        yield* Command.runWith(makeCli({ cloudEnabled: true }), { version: "0.0.0" })([
          "connect",
          "unlink",
          "--base-dir",
          baseDir,
        ]).pipe(
          // TestConsole has no reader for Console.warn.
          Effect.updateService(Console.Console, (console) => ({
            ...console,
            warn: (...args: ReadonlyArray<unknown>) => {
              warnings.push(args.join(" "));
            },
          })),
        );

        return { requests, warnings, printed: (yield* TestConsole.logLines).join("\n") };
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            Layer.fresh(TestConsole.layer),
          ),
        ),
      );

    // Above Linux's PID ceiling, as in pair.test.ts: no process can hold it.
    const deadPid = 4_194_305;

    it.effect("does not tell the user to restart a server that is gone", () =>
      Effect.gen(function* () {
        const { printed, warnings } = yield* runUnlink(deadPid, { portFreed: true });

        assert.include(printed, "Remote access is off locally.");
        assert.notInclude(warnings.join("\n"), "Restart that server");
      }),
    );

    it.effect("warns that a server that is gone may have left its connector running", () =>
      Effect.gen(function* () {
        const { warnings } = yield* runUnlink(deadPid, { portFreed: true });

        assert.include(warnings.join("\n"), "its cloudflared process may still be running");
      }),
    );

    it.effect("does not send a token to whatever took over a dead server's port", () =>
      Effect.gen(function* () {
        const { requests } = yield* runUnlink(deadPid);

        assert.deepEqual(requests, []);
      }),
    );

    it.effect("asks a running server to stop its tunnel", () =>
      Effect.gen(function* () {
        const { requests, printed, warnings } = yield* runUnlink(process.pid);

        assert.deepEqual(requests, ["POST /api/connect/unlink"]);
        assert.include(printed, "Remote access is off locally.");
        assert.notInclude(warnings.join("\n"), "cloudflared process");
      }),
    );
  },
);
