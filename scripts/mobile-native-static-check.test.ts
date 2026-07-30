import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/hostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ConfigProvider from "effect/ConfigProvider";

import {
  collectSources,
  handleMissingTool,
  requireTools,
  runCommand,
} from "./mobile-native-static-check.ts";

const processHandle = (
  exitCode: Effect.Effect<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>,
) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode,
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

const provideSpawner = (spawn: ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"]) =>
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(spawn));

const runSwiftLint = runCommand("swiftlint", ["lint", "--strict"], "/repo/apps/mobile").pipe(
  Effect.provideService(HostProcess.HostProcessPlatform, "linux"),
);

it.layer(NodeServices.layer)("mobile native source discovery", (it) => {
  it.effect("preserves the failed discovery operation, path, and exact cause", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "mobile-native-static-check-" });
      const missingDirectory = path.join(root, "missing");

      const error = yield* collectSources(missingDirectory, root).pipe(Effect.flip);

      assert.equal(error._tag, "NativeStaticCheckSourceDiscoveryError");
      assert.equal(error.operation, "read-directory");
      assert.equal(error.path, missingDirectory);
      assert.instanceOf(error.cause, PlatformError.PlatformError);
      assert.equal(error.message, "Native source discovery operation 'read-directory' failed.");
    }),
  );
});

const swiftLintTool = { command: "swiftlint", installHint: "brew install swiftlint" } as const;

const withEnv = (env: Record<string, string>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

it.effect("fails instead of skipping when a missing tool is required", () =>
  Effect.gen(function* () {
    const error = yield* handleMissingTool(swiftLintTool, "SwiftLint", true).pipe(Effect.flip);

    assert.equal(error._tag, "NativeStaticCheckMissingToolError");
    assert.equal(error.command, "swiftlint");
    assert.equal(error.checkName, "SwiftLint");
    assert.equal(
      error.message,
      "swiftlint is required to run SwiftLint but was not found on PATH. Install it with 'brew install swiftlint' (macOS), or see the tool install step in .github/workflows/ci.yml.",
    );
  }),
);

it.effect("does not require tools when nothing is configured", () =>
  Effect.gen(function* () {
    assert.equal(yield* requireTools.pipe(withEnv({})), false);
  }),
);

it.effect("requires tools when CI is set", () =>
  Effect.gen(function* () {
    assert.equal(yield* requireTools.pipe(withEnv({ CI: "true" })), true);
  }),
);

it.effect("lets an explicit opt-out override CI", () =>
  Effect.gen(function* () {
    const required = yield* requireTools.pipe(
      withEnv({ CI: "true", T3CODE_MOBILE_LINT_REQUIRE_TOOLS: "false" }),
    );

    assert.equal(required, false);
  }),
);

it.effect("keeps tools required in CI when the opt-out is malformed", () =>
  Effect.gen(function* () {
    // Config.option yields None for a malformed value as well as a missing one,
    // so a typo falls back to CI rather than silently disabling the linters.
    const required = yield* requireTools.pipe(
      withEnv({ CI: "true", T3CODE_MOBILE_LINT_REQUIRE_TOOLS: "ture" }),
    );

    assert.equal(required, true);
  }),
);

// Succeeds rather than failing, preserving local-dev ergonomics.
it.effect("skips a missing tool when it is not required", () =>
  handleMissingTool(swiftLintTool, "SwiftLint", false),
);

it.effect("preserves process spawn context and the exact cause", () => {
  const cause = PlatformError.systemError({
    _tag: "NotFound",
    module: "ChildProcess",
    method: "spawn",
    description: "swiftlint was not found",
  });

  return Effect.gen(function* () {
    const error = yield* runSwiftLint.pipe(
      Effect.provide(provideSpawner(() => Effect.fail(cause))),
      Effect.flip,
    );

    if (error._tag !== "NativeStaticCheckProcessError") {
      return assert.fail(`Unexpected error: ${error._tag}`);
    }
    assert.equal(error.operation, "spawn");
    assert.equal(error.command, "swiftlint");
    assert.equal(error.argumentCount, 2);
    assert.equal(error.cwd, "/repo/apps/mobile");
    assert.equal(error.shell, false);
    assert.equal(error.cause, cause);
    assert.equal(
      error.message,
      "Native static check process operation 'spawn' failed for command 'swiftlint'.",
    );
    assert.notProperty(error, "args");
  });
});

it.effect("preserves process wait context and the exact cause", () => {
  const cause = PlatformError.systemError({
    _tag: "Unknown",
    module: "ChildProcess",
    method: "exitCode",
    description: "status unavailable",
  });

  return Effect.gen(function* () {
    const error = yield* runSwiftLint.pipe(
      Effect.provide(provideSpawner(() => Effect.succeed(processHandle(Effect.fail(cause))))),
      Effect.flip,
    );

    if (error._tag !== "NativeStaticCheckProcessError") {
      return assert.fail(`Unexpected error: ${error._tag}`);
    }
    assert.equal(error.operation, "wait-for-exit");
    assert.equal(error.command, "swiftlint");
    assert.equal(error.argumentCount, 2);
    assert.equal(error.cwd, "/repo/apps/mobile");
    assert.equal(error.shell, false);
    assert.equal(error.cause, cause);
    assert.equal(
      error.message,
      "Native static check process operation 'wait-for-exit' failed for command 'swiftlint'.",
    );
    assert.notProperty(error, "args");
  });
});

it.effect("reports non-zero exits without manufacturing a cause", () =>
  Effect.gen(function* () {
    const error = yield* runSwiftLint.pipe(
      Effect.provide(
        provideSpawner(() =>
          Effect.succeed(processHandle(Effect.succeed(ChildProcessSpawner.ExitCode(2)))),
        ),
      ),
      Effect.flip,
    );

    if (error._tag !== "NativeStaticCheckCommandError") {
      return assert.fail(`Unexpected error: ${error._tag}`);
    }
    assert.equal(error.command, "swiftlint");
    assert.equal(error.argumentCount, 2);
    assert.equal(error.cwd, "/repo/apps/mobile");
    assert.equal(error.shell, false);
    assert.equal(error.exitCode, 2);
    assert.notProperty(error, "cause");
    assert.notProperty(error, "args");
  }),
);
