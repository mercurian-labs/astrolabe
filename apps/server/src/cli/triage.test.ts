import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { Command } from "effect/cli";

import packageJson from "../../package.json" with { type: "json" };
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";
import { describeServerProcess, triageCommand, TriageUnavailableError } from "./triage.ts";
import { TRIAGE_REPOSITORY } from "./triagePrompt.ts";

it.effect("reports the version the running server recorded, not the CLI's", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const statePath = path.join(
      yield* fs.makeTempDirectoryScoped({ prefix: "t3-triage-" }),
      "server-runtime.json",
    );
    const state = yield* makePersistedServerRuntimeState({
      config: { host: undefined, devUrl: undefined },
      port: 3773,
    });
    yield* persistServerRuntimeState({ path: statePath, state });

    assert.equal(
      yield* describeServerProcess(statePath),
      `running (pid ${String(process.pid)}, http://127.0.0.1:3773, version ${packageJson.version})`,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.skipIf(TRIAGE_REPOSITORY !== null)(
  "refuses to triage while Astrolabe has no public repository",
  () =>
    Effect.gen(function* () {
      const error = yield* Command.runWith(triageCommand, { version: "0.0.0" })([
        "--agent",
        "claude",
      ]).pipe(Effect.provide(NodeServices.layer), Effect.flip);
      assert.instanceOf(error, TriageUnavailableError);
    }),
);
