import * as RelayClient from "@t3tools/shared/relayClient";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Terminal from "effect/Terminal";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import * as ExternalLauncher from "../process/externalLauncher.ts";
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
