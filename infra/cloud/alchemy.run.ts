// @effect-diagnostics anyUnknownInErrorContext:off layerMergeAllWithDependencies:off - Alchemy provider helpers expose framework-owned any requirements.
import * as Alchemy from "alchemy";
import * as AWS from "@alchemy.run/aws";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Docker from "@alchemy.run/docker";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import ApiLive, { Api } from "./src/Api.ts";
import { Electric, Mail } from "./src/resources.ts";

const dev = process.env.ALCHEMY_DEV === "true";

export default Alchemy.Stack(
  "MercurianCloud",
  {
    // Deployed stages publish their certificate and origin records in Cloudflare and keep state
    // there next to the relay's, so the stacks can reference each other. Dev needs no account.
    providers: dev
      ? Layer.mergeAll(AWS.providers(), Docker.providers())
      : Layer.mergeAll(AWS.providers(), Cloudflare.providers()),
    state: dev ? Alchemy.localState() : Cloudflare.state(),
  },
  Effect.gen(function* () {
    yield* Mail;
    const electric = yield* Electric;
    const api = yield* Api;
    return { apiUrl: api.url, electricUrl: electric.url };
  }).pipe(Effect.provide(ApiLive)),
);
