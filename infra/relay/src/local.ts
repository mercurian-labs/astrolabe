/**
 * What the relay uses in place of cloud-only resources under `alchemy dev`.
 * Tunnels, DNS zones and Axiom have no local emulation, so local dev runs
 * without managed endpoints or tracing, against the cloud stack's local
 * Postgres (infra/cloud), which also applies the relay's migrations.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import * as ManagedEndpointProvider from "./environments/ManagedEndpointProvider.ts";

export const RELAY_LOCAL_PORT = 8787;
export const RELAY_LOCAL_ORIGIN = `http://localhost:${RELAY_LOCAL_PORT}`;

const LOCAL_ONLY = "Cloudflare Tunnels need a deployed relay; local dev has no managed endpoints.";

/**
 * Matches the Docker Postgres in infra/cloud/alchemy.run.ts. workerd runs on
 * the host, so it reaches the published port directly.
 */
export const LocalHyperdrive = Effect.gen(function* () {
  const port = yield* Config.Int("CLOUD_POSTGRES_PORT").pipe(Config.withDefault(54341));
  const origin = {
    scheme: "postgres",
    host: "localhost",
    port,
    database: "mercurian_cloud",
    user: "mercurian",
    password: Redacted.make("mercurian"),
  } as const;
  return yield* Cloudflare.Hyperdrive.Connection("RelayHyperdrive", {
    origin,
    dev: { ...origin, sslmode: "disable" },
    caching: { disabled: true },
  });
});

/**
 * With no managed endpoint domain configured, provisioning already fails as
 * "not configured"; these clients only answer the cleanup sweep.
 */
export const layerManagedEndpoints = ManagedEndpointProvider.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      ManagedEndpointProvider.layerTunnelClient({
        get: (tunnelId) => tunnelError("get", { tunnelId }),
        list: () => Effect.succeed({ result: [] }),
        create: (request) => tunnelError("create", { tunnelName: request.name }),
        putConfiguration: (tunnelId) => tunnelError("put-configuration", { tunnelId }),
        getToken: (tunnelId) => tunnelError("get-token", { tunnelId }),
        delete: (tunnelId) => tunnelError("delete", { tunnelId }),
      }),
      ManagedEndpointProvider.layerDnsClient({
        listRecords: () => Effect.succeed([]),
        createRecord: (request) => dnsError("create-record", { hostname: request.name }),
        updateRecord: (dnsRecordId) => dnsError("update-record", { dnsRecordId }),
        deleteRecord: (dnsRecordId) => dnsError("delete-record", { dnsRecordId }),
      }),
    ),
  ),
);

const tunnelError = (
  operation: ManagedEndpointProvider.ManagedEndpointTunnelClientError["operation"],
  target: { readonly tunnelId?: string; readonly tunnelName?: string },
) =>
  Effect.fail(
    new ManagedEndpointProvider.ManagedEndpointTunnelClientError({
      operation,
      ...target,
      cause: LOCAL_ONLY,
    }),
  );

const dnsError = (
  operation: ManagedEndpointProvider.ManagedEndpointDnsClientError["operation"],
  target: { readonly hostname?: string; readonly dnsRecordId?: string },
) =>
  Effect.fail(
    new ManagedEndpointProvider.ManagedEndpointDnsClientError({
      operation,
      ...target,
      cause: LOCAL_ONLY,
    }),
  );
