import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Schema from "effect/Schema";
import type { Pool } from "pg";

const Environments = Schema.Struct({
  environments: Schema.Array(Schema.Struct({ environmentId: Schema.String })),
});

/**
 * Removes a departing user's relay data. Machines are unlinked through the
 * relay's own API, which tears down their tunnels and DNS; push
 * registrations have nothing outside the database and are deleted directly.
 */
export const removeRelayData = Effect.fn("RelayAccount.removeRelayData")(function* (input: {
  readonly relayUrl: string;
  readonly userId: string;
  /** A relay token for the user, minted by the account issuer. */
  readonly token: string;
}) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(HttpClientRequest.bearerToken(input.token)),
    HttpClient.filterStatusOk,
  );
  const url = (path: string) => new URL(path, input.relayUrl).toString();
  const { environments } = yield* client
    .get(url("/v1/environments"))
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Environments)));
  for (const { environmentId } of environments) {
    yield* client.del(url(`/v1/client/environment-links/${encodeURIComponent(environmentId)}`));
  }
});

export const deletePushRegistrations = (pool: Pool, userId: string) =>
  Effect.acquireUseRelease(
    Effect.promise(() => pool.connect()),
    (connection) =>
      Effect.promise(async () => {
        await connection.query("BEGIN");
        for (const table of [
          "relay_live_activities",
          "relay_delivery_attempts",
          "relay_mobile_devices",
          "relay_managed_tunnel_limits",
        ]) {
          await connection.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
        }
        await connection.query("COMMIT");
      }).pipe(Effect.onError(() => Effect.promise(() => connection.query("ROLLBACK")))),
    (connection) => Effect.sync(() => connection.release()),
  );
