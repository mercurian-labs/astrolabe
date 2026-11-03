import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { Command } from "effect/cli";

import { TRIAGE_REPOSITORY } from "../triage/triagePrompt.ts";
import { triageCommand, TriageUnavailableError } from "./triage.ts";

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
