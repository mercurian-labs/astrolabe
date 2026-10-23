import type { EnvironmentId, OrchestrationV2ThreadLineage, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/http";
import type { Atom } from "effect/reactivity";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { PreparedConnection } from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  withOrchestrationProtocolHeader,
} from "./environmentHttpAuth.ts";
import { createEnvironmentQueryAtomFamily } from "./runtime.ts";

const DEFAULT_THREAD_LINEAGE_TIMEOUT_MS = 6_000;

/** @public Required to name the error in consumers' inferred lineage results. */
export class ThreadLineageConnectionNotReadyError extends Data.TaggedError(
  "ThreadLineageConnectionNotReadyError",
)<{ readonly message: string }> {}

/** Loads a thread's fork family over HTTP, the same authenticated path as thread history. */
export class ThreadLineageLoader extends Context.Service<
  ThreadLineageLoader,
  {
    readonly load: (
      prepared: PreparedConnection,
      threadId: ThreadId,
    ) => Effect.Effect<OrchestrationV2ThreadLineage, RemoteEnvironmentRequestError>;
  }
>()("@t3tools/client-runtime/state/threadLineageHttp/ThreadLineageLoader") {}

export const layer: Layer.Layer<ThreadLineageLoader, never, HttpClient.HttpClient> = Layer.effect(
  ThreadLineageLoader,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
    );
    return ThreadLineageLoader.of({
      load: (prepared, threadId) => {
        const endpoint = { params: { threadId } };
        return executeAuthenticatedEnvironmentHttpRequest({
          prepared,
          signer,
          remoteAuthorization,
          group: "orchestration",
          method: "GET",
          url: (urls) => urls.threadLineage(endpoint),
          timeoutMs: DEFAULT_THREAD_LINEAGE_TIMEOUT_MS,
          request: ({ client, headers }) =>
            client.threadLineage({
              ...endpoint,
              headers: withOrchestrationProtocolHeader(headers),
            }),
        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
      },
    });
  }),
);

/**
 * A thread's lineage, keyed by the viewed thread. It loads once per open and again only when
 * `refreshTrigger` changes value, keeping the previous lineage while a reload is in flight.
 */
export function createThreadLineageAtomFamily<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | ThreadLineageLoader | R, E>,
  options: {
    readonly refreshTrigger: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: ThreadId;
    }) => Atom.Atom<unknown>;
  },
) {
  return createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:thread-lineage",
    // Each open revalidates; the kept value draws while it does.
    staleTimeMs: 0,
    refreshTrigger: options.refreshTrigger,
    execute: Effect.fn("ThreadLineage.load")(function* (threadId: ThreadId) {
      const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
      const loader = yield* ThreadLineageLoader;
      const prepared = yield* SubscriptionRef.get(supervisor.prepared);
      if (Option.isNone(prepared)) {
        return yield* new ThreadLineageConnectionNotReadyError({
          message: "The environment HTTP connection is not ready.",
        });
      }
      return yield* loader.load(prepared.value, threadId);
    }),
  });
}
