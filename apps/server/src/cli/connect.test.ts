import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as RelayClient from "@t3tools/shared/relayClient";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as References from "effect/References";
import * as Terminal from "effect/Terminal";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as BootService from "../cloud/bootService.ts";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import * as ExternalLauncher from "../process/externalLauncher.ts";
import {
  acquireRelayClientForLink,
  authorizeCli,
  headlessSessionConfig,
  reportCloudDisconnectResults,
  reportServiceOnboarding,
} from "./connect.ts";
import { offerServiceDuringOnboarding, recoverServiceOnboardingOffer } from "./service.ts";

const readHeadlessSessionConfig = (env: Record<string, string>) =>
  headlessSessionConfig.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))));

const managedExecutable = {
  status: "available",
  executablePath: "/tmp/cloudflared",
  source: "managed",
  version: RelayClient.CLOUDFLARED_VERSION,
} as const;

it.effect("detects headless operation from individual SSH config values", () =>
  Effect.gen(function* () {
    assert.isFalse(yield* readHeadlessSessionConfig({}));
    assert.isFalse(yield* readHeadlessSessionConfig({ CI: "true" }));
    assert.isTrue(yield* readHeadlessSessionConfig({ SSH_CONNECTION: "client server" }));
    assert.isTrue(yield* readHeadlessSessionConfig({ SSH_TTY: "/dev/pts/1" }));
  }),
);

it.effect("treats cancelling optional background setup as a successful skip", () =>
  Effect.gen(function* () {
    const result = yield* recoverServiceOnboardingOffer(Effect.fail(new Terminal.QuitError({})));
    assert.equal(result, "skipped");
  }),
);

it.effect("keeps a successful connection when a remote service update is pending", () =>
  Effect.gen(function* () {
    const result = yield* recoverServiceOnboardingOffer(
      Effect.fail(new BootService.BootServiceUpdatePendingError()),
    );
    assert.equal(result, "skipped");
  }),
);

it.effect("reports pending onboarding until the handed-off service is ready", () =>
  Effect.gen(function* () {
    const input = yield* Queue.make<Terminal.UserInput>();
    yield* Queue.offer(input, {
      input: Option.some("\r"),
      key: { name: "return", ctrl: false, meta: false, shift: false },
    });
    const terminal = Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.succeed(Queue.asDequeue(input)),
      readLine: Effect.die("unexpected line input"),
      display: () => Effect.void,
    });
    const plan = {
      program: ["/test/t3", "__service-launcher"],
      baseDir: "/test",
      unitPath: "/test/t3code.service",
      logPath: "/test/boot-service.log",
      handedOff: true,
    };
    let current = false;
    const service = BootService.BootService.of({
      status: Effect.sync(() => ({
        supported: true,
        installed: true,
        current,
        unitPath: plan.unitPath,
        logPath: plan.logPath,
      })),
      install: () => Effect.succeed(plan),
      restart: Effect.die("unexpected restart"),
      uninstall: Effect.die("unexpected uninstall"),
      withStopped: () => Effect.die("unexpected maintenance"),
    });
    const lines: string[] = [];
    const onboard = recoverServiceOnboardingOffer(offerServiceDuringOnboarding).pipe(
      Effect.flatMap(reportServiceOnboarding),
      Effect.provideService(BootService.BootService, service),
      Effect.provideService(Terminal.Terminal, terminal),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(Console.Console, {
        ...globalThis.console,
        log: (...args) => {
          lines.push(args.map(String).join(" "));
        },
      }),
    );

    yield* onboard;
    const output = lines.join("\n");
    assert.notInclude(output, "Background service ready");
    assert.notInclude(output, "Start the server");
    assert.include(output, "Background service restarting");
    assert.include(output, plan.logPath);

    current = true;
    lines.length = 0;
    yield* onboard;
    assert.include(lines.join("\n"), "Background service ready");
    assert.notInclude(lines.join("\n"), "restarting");
  }).pipe(Effect.provide(NodeServices.layer)),
);

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

it.effect("installs the relay client after the user accepts the managed download", () =>
  Effect.gen(function* () {
    let installCalls = 0;
    const progress: Array<string> = [];
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
        installWithProgress: (report) =>
          report({ type: "progress", stage: "downloading" }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                installCalls += 1;
                return managedExecutable;
              }),
            ),
          ),
        pruneManagedVersions: Effect.void,
      },
      () => Effect.succeed(true),
      (event) =>
        Effect.sync(() => {
          if (event.type === "progress") {
            progress.push(event.stage);
          }
        }),
    );

    assert.deepEqual(Option.getOrThrow(result), managedExecutable);
    assert.equal(installCalls, 1);
    assert.deepEqual(progress, ["downloading"]);
  }),
);

it.effect("reuses an available relay client executable without prompting", () =>
  Effect.gen(function* () {
    let promptCalls = 0;
    const result = yield* acquireRelayClientForLink(
      {
        resolve: Effect.succeed(managedExecutable),
        install: Effect.die("unexpected install"),
        installWithProgress: () => Effect.die("unexpected install"),
        pruneManagedVersions: Effect.void,
      },
      () =>
        Effect.sync(() => {
          promptCalls += 1;
          return false;
        }),
      () => Effect.void,
    );

    assert.deepEqual(Option.getOrThrow(result), managedExecutable);
    assert.equal(promptCalls, 0);
  }),
);

it.effect("keeps disconnect causes in structured logs and out of console warnings", () => {
  const warnings: ReadonlyArray<unknown>[] = [];
  const logs: Readonly<Record<string, unknown>>[] = [];
  const testConsole = {
    ...globalThis.console,
    warn: (...args: ReadonlyArray<unknown>) => {
      warnings.push(args);
    },
  } satisfies Console.Console;
  const logger = Logger.make(({ fiber }) => {
    logs.push(fiber.getRef(References.CurrentLogAnnotations));
  });
  const liveFailure = "live unlink private diagnostic";
  const relayFailure = "relay revoke private diagnostic";

  return reportCloudDisconnectResults({
    clearAuthorization: true,
    liveResult: {
      status: "failed",
      cause: Cause.fail(new Error(liveFailure)),
    },
    relayResult: Exit.failCause(Cause.die(new Error(relayFailure))),
  }).pipe(
    Effect.provideService(Console.Console, testConsole),
    Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
    Effect.tap(() =>
      Effect.sync(() => {
        assert.lengthOf(warnings, 2);
        const warningText = warnings.flat().map(String).join("\n");
        assert.include(warningText, "running server could not stop its tunnel");
        assert.include(warningText, "Could not turn off remote access for this environment");
        assert.notInclude(warningText, liveFailure);
        assert.notInclude(warningText, relayFailure);
        assert.deepEqual(
          logs.map(({ operation, clearAuthorization }) => ({ operation, clearAuthorization })),
          [
            { operation: "live-server-unlink", clearAuthorization: true },
            { operation: "relay-environment-unlink", clearAuthorization: true },
          ],
        );
        const loggedCauses = logs.map((log) => String(log.cause)).join("\n");
        assert.include(loggedCauses, liveFailure);
        assert.include(loggedCauses, relayFailure);
      }),
    ),
  );
});

/** Captures console lines from a successful local disconnect report. */
const captureDisconnectReport = (input: {
  readonly clearAuthorization: boolean;
  readonly liveResult: {
    readonly status: "succeeded";
  };
  readonly relayResult: Exit.Exit<
    { readonly status: "not-authenticated" } | { readonly status: "revoked" },
    unknown
  >;
}) => {
  const lines: Array<{ readonly stream: "log" | "warn"; readonly text: string }> = [];
  const testConsole = {
    ...globalThis.console,
    log: (...args: ReadonlyArray<unknown>) => {
      lines.push({ stream: "log", text: args.map(String).join(" ") });
    },
    warn: (...args: ReadonlyArray<unknown>) => {
      lines.push({ stream: "warn", text: args.map(String).join(" ") });
    },
  } satisfies Console.Console;

  return reportCloudDisconnectResults(input).pipe(
    Effect.provideService(Console.Console, testConsole),
    Effect.provide(Logger.layer([Logger.make(() => undefined)], { mergeWithExisting: false })),
    Effect.as(lines),
  );
};

it.effect("warns to deregister when unlink has no stored CLI authorization", () =>
  Effect.gen(function* () {
    const lines = yield* captureDisconnectReport({
      clearAuthorization: false,
      liveResult: { status: "succeeded" },
      relayResult: Exit.succeed({ status: "not-authenticated" }),
    });

    assert.deepEqual(
      lines.map((line) => line.stream),
      ["log", "warn"],
    );
    assert.equal(lines[0]?.text, "Remote access is off locally.");
    assert.include(lines[1]?.text, "Remote access for this environment was not turned off.");
    assert.include(lines[1]?.text, "Remote access page of your Astrolabe account");
    assert.include(lines[1]?.text, "`astrolabe connect login`");
    assert.notInclude(
      lines.map((line) => line.text).join("\n"),
      "Turned off remote access for this environment.",
    );
  }),
);

it.effect("points a failed relay unlink at retry and account deregistration", () =>
  Effect.gen(function* () {
    const lines = yield* captureDisconnectReport({
      clearAuthorization: false,
      liveResult: { status: "succeeded" },
      relayResult: Exit.fail("relay unreachable"),
    });
    const warning = lines.find((line) => line.stream === "warn")?.text ?? "";

    assert.equal(lines[0]?.text, "Remote access is off locally.");
    assert.include(warning, "Run `astrolabe connect unlink` again when remote access is reachable");
    assert.include(warning, "remove it from the Remote access page of your Astrolabe account");
    assert.notInclude(warning, "relay unreachable");
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
