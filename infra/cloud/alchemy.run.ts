// @effect-diagnostics anyUnknownInErrorContext:off layerMergeAllWithDependencies:off - Alchemy provider helpers expose framework-owned any requirements.
import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Docker from "alchemy/Docker";
import { ALCHEMY_DEV } from "alchemy/Phase";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import ApiLive, { Api } from "./src/Api.ts";
import { Electric, MailIdentity } from "./src/resources.ts";

export default Alchemy.Stack(
  "MercurianCloud",
  {
    providers: Layer.mergeAll(AWS.providers(), Docker.providers()),
    // Deploys will keep state in Cloudflare next to the relay's, so stacks can
    // reference each other; local dev needs no account at all.
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    if (!(yield* ALCHEMY_DEV)) {
      return yield* Effect.die("MercurianCloud only runs under `alchemy dev` so far.");
    }
    yield* MailIdentity;
    const electric = yield* Electric;
    const api = yield* Api;
    return { apiUrl: api.url, electricUrl: electric.url };
  }).pipe(Effect.provide(ApiLive)),
);
