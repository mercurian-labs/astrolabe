import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { cloudCliAuthConfig, type CloudCliAuthConfig } from "./publicConfig.ts";

const CLOUD_CLI_OAUTH_TOKEN_SECRET = "cloud-cli-oauth-token";
// Relay tokens live 15 minutes; mint a new one shortly before that.
const CLOUD_CLI_RELAY_TOKEN_REFRESH_EARLY_MS = Duration.toMillis(Duration.minutes(1));
const CLOUD_CLI_RELAY_TOKEN_DEFAULT_LIFETIME = Duration.minutes(15);
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
// RFC 8628 defaults, used only when the server omits the field.
const DEVICE_AUTHORIZATION_DEFAULT_INTERVAL = Duration.seconds(5);
// RFC 8628 §3.5: a slow_down response means "add 5 seconds to the interval".
const DEVICE_AUTHORIZATION_SLOW_DOWN_INCREMENT = Duration.seconds(5);
// Bounds one relay-token or device-code request, including reading the body.
// A stalled refresh holds the manager's semaphore and blocks every other
// credential call.
const AUTH_REQUEST_TIMEOUT = Duration.seconds(10);

/**
 * `accessToken` is the relay token the CLI presents to the relay, and
 * `refreshToken` is the Better Auth session it was minted from: the session
 * mints a fresh relay token whenever the stored one is about to expire.
 */
const PersistedToken = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAtEpochMs: Schema.Number,
  identity: Schema.optional(Schema.String),
});
export type PersistedToken = typeof PersistedToken.Type;

const PersistedTokenJson = Schema.fromJsonString(PersistedToken);
const decodePersistedToken = Schema.decodeUnknownEffect(PersistedTokenJson);
const encodePersistedToken = Schema.encodeEffect(PersistedTokenJson);

const DeviceTokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
});

const OAuthErrorResponse = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optional(Schema.String),
});

const DeviceAuthorizationResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.optional(Schema.Number),
});

const RelayTokenResponse = Schema.Struct({ token: Schema.String });
const RelayTokenRefusal = Schema.Struct({ code: Schema.optional(Schema.String) });

const SessionResponse = Schema.NullOr(
  Schema.Struct({ user: Schema.Struct({ email: Schema.String }) }),
);

const JwtExpiryJson = Schema.fromJsonString(Schema.Struct({ exp: Schema.Number }));
const decodeJwtExpiryJson = Schema.decodeUnknownOption(JwtExpiryJson);

/** Reads a relay token's `exp`; the CLI only uses it to schedule a refresh. */
function jwtExpiryEpochMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  const decoded = Base64Url.decodeString(payload);
  if (decoded._tag !== "Success") return null;
  const claims = decodeJwtExpiryJson(decoded.success);
  return Option.isSome(claims) ? claims.value.exp * 1_000 : null;
}

export class CloudCliCredentialRemovalError extends Schema.TaggedError<CloudCliCredentialRemovalError>()(
  "CloudCliCredentialRemovalError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not remove the stored T3 Connect CLI credential.";
  }
}

const isPermanentRefreshStatus = (status: number): boolean =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

export class CloudCliCredentialRefreshError extends Schema.TaggedError<CloudCliCredentialRefreshError>()(
  "CloudCliCredentialRefreshError",
  {
    cause: Schema.Defect(),
    status: Schema.optional(Schema.Number),
  },
) {
  /** The session behind the stored credential was rejected, so retrying cannot help. */
  get requiresLogin(): boolean {
    return this.status !== undefined && isPermanentRefreshStatus(this.status);
  }

  override get message(): string {
    return this.requiresLogin
      ? "Could not refresh the T3 Connect CLI credential. Run `astrolabe connect login` to authorize again."
      : "Could not refresh the T3 Connect CLI credential.";
  }
}

export const isCloudCliCredentialRefreshError = Schema.is(CloudCliCredentialRefreshError);

export class CloudCliCredentialReadError extends Schema.TaggedError<CloudCliCredentialReadError>()(
  "CloudCliCredentialReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the stored T3 Connect CLI credential.";
  }
}

export class CloudCliAuthorizationError extends Schema.TaggedError<CloudCliAuthorizationError>()(
  "CloudCliAuthorizationError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not authorize the T3 Connect CLI.";
  }
}

export class CloudCliAuthorizationTimeoutError extends Schema.TaggedError<CloudCliAuthorizationTimeoutError>()(
  "CloudCliAuthorizationTimeoutError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Timed out waiting for T3 Connect authorization.";
  }
}

export class CloudCliAuthorizationDeniedError extends Schema.TaggedError<CloudCliAuthorizationDeniedError>()(
  "CloudCliAuthorizationDeniedError",
  {},
) {
  override get message(): string {
    return "T3 Connect authorization was denied in the browser.";
  }
}

export class CloudCliAccountWaitlistedError extends Schema.TaggedError<CloudCliAccountWaitlistedError>()(
  "CloudCliAccountWaitlistedError",
  {},
) {
  override get message(): string {
    return "Your Astrolabe account is still on the waitlist. You'll get an email once it's approved.";
  }
}

export const CloudCliTokenManagerError = Schema.Union([
  CloudCliCredentialRemovalError,
  CloudCliCredentialRefreshError,
  CloudCliCredentialReadError,
  CloudCliAuthorizationError,
  CloudCliAuthorizationTimeoutError,
  CloudCliAuthorizationDeniedError,
  CloudCliAccountWaitlistedError,
]);
export type CloudCliTokenManagerError = typeof CloudCliTokenManagerError.Type;

export class CloudCliTokenManager extends Context.Service<
  CloudCliTokenManager,
  {
    readonly getExisting: Effect.Effect<Option.Option<PersistedToken>, CloudCliTokenManagerError>;
    readonly hasCredential: Effect.Effect<boolean, CloudCliTokenManagerError>;
    readonly store: (token: PersistedToken) => Effect.Effect<void, CloudCliTokenManagerError>;
    readonly clear: Effect.Effect<void, CloudCliTokenManagerError>;
  }
>()("t3/cloud/CliTokenManager/CloudCliTokenManager") {}

function stringToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToString(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

/**
 * Trades a Better Auth session for a relay token at `/token`, the one path
 * every client uses. A waitlisted account has a session but gets no token.
 */
const issueRelayToken = Effect.fn("cloud.cli_token.issue_relay_token")(function* (
  config: Pick<CloudCliAuthConfig, "relayTokenEndpoint">,
  sessionToken: string,
  identity: string | undefined,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const { token } = yield* HttpClientRequest.get(config.relayTokenEndpoint).pipe(
    HttpClientRequest.bearerToken(sessionToken),
    httpClient.execute,
    Effect.flatMap((response) =>
      Effect.gen(function* () {
        if (response.status === 403) {
          const refusal = yield* HttpClientResponse.schemaBodyJson(RelayTokenRefusal)(
            response,
          ).pipe(Effect.orElseSucceed(() => ({ code: undefined })));
          if (refusal.code === "WAITLISTED") return yield* new CloudCliAccountWaitlistedError();
        }
        return yield* HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(RelayTokenResponse)),
        );
      }),
    ),
    Effect.timeout(AUTH_REQUEST_TIMEOUT),
  );
  const now = yield* Clock.currentTimeMillis;
  return {
    accessToken: token,
    refreshToken: sessionToken,
    expiresAtEpochMs:
      jwtExpiryEpochMs(token) ?? now + Duration.toMillis(CLOUD_CLI_RELAY_TOKEN_DEFAULT_LIFETIME),
    ...(identity === undefined ? {} : { identity }),
  } satisfies PersistedToken;
});

/** Best-effort read of the signed-in email, shown so the operator knows which account linked. */
const readSessionIdentity = Effect.fn("cloud.cli_token.read_session_identity")(function* (
  config: Pick<CloudCliAuthConfig, "sessionEndpoint">,
  sessionToken: string,
) {
  const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  return yield* HttpClientRequest.get(config.sessionEndpoint).pipe(
    HttpClientRequest.bearerToken(sessionToken),
    httpClient.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(SessionResponse)),
    Effect.timeout(AUTH_REQUEST_TIMEOUT),
    Effect.map((session) => session?.user.email),
    Effect.orElseSucceed(() => undefined),
  );
});

export interface DeviceAuthorizationPrompt {
  readonly verificationUri: string;
  readonly verificationUriComplete: string | undefined;
  readonly userCode: string;
  readonly expiresIn: Duration.Duration;
}

const isTransportError = (error: unknown) =>
  HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError";

const pollDeviceToken = Effect.fn("cloud.cli_token.poll_device_token")(function* (
  config: Pick<CloudCliAuthConfig, "deviceTokenEndpoint" | "clientId">,
  deviceCode: string,
  initialInterval: Duration.Duration,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const body = {
    grant_type: DEVICE_CODE_GRANT_TYPE,
    device_code: deviceCode,
    client_id: config.clientId,
  };
  let interval = initialInterval;
  while (true) {
    yield* Effect.sleep(interval);
    const response = yield* HttpClientRequest.post(config.deviceTokenEndpoint).pipe(
      HttpClientRequest.bodyJsonUnsafe(body),
      httpClient.execute,
      Effect.asSome,
      Effect.catchIf(isTransportError, () => Effect.succeedNone),
    );
    // Transport failures and upstream 5xx are transient while the device code
    // is still valid. RFC 8628 §3.5 asks clients to back off before retrying,
    // so widen the interval like slow_down; drain the body so the connection
    // returns to the pool for the next poll.
    if (Option.isNone(response) || response.value.status >= 500) {
      if (Option.isSome(response)) yield* Effect.ignore(response.value.text);
      interval = Duration.sum(interval, DEVICE_AUTHORIZATION_SLOW_DOWN_INCREMENT);
      continue;
    }
    if (response.value.status >= 200 && response.value.status < 300) {
      const granted = yield* HttpClientResponse.schemaBodyJson(DeviceTokenResponse)(response.value);
      return granted.access_token;
    }
    const failure = yield* HttpClientResponse.schemaBodyJson(OAuthErrorResponse)(response.value);
    switch (failure.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval = Duration.sum(interval, DEVICE_AUTHORIZATION_SLOW_DOWN_INCREMENT);
        continue;
      case "expired_token":
        return yield* new CloudCliAuthorizationTimeoutError({ cause: failure });
      case "access_denied":
        return yield* new CloudCliAuthorizationDeniedError();
      default:
        return yield* new CloudCliAuthorizationError({
          cause: failure.error_description ?? failure.error,
        });
    }
  }
});

/**
 * Better Auth's device authorization grant (RFC 8628). The user approves a
 * short code at app.astrolabe.sh/device from any browser while this process polls;
 * no redirect URI is involved, so it works the same over SSH. The approved
 * session is then traded for a relay token.
 */
export const deviceAuthorizationLogin = Effect.fn("cloud.cli_token.device_authorization_login")(
  function* <E, R>(showPrompt: (prompt: DeviceAuthorizationPrompt) => Effect.Effect<void, E, R>) {
    const config = yield* cloudCliAuthConfig;
    const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const authorization = yield* HttpClientRequest.post(config.deviceCodeEndpoint).pipe(
      HttpClientRequest.bodyJsonUnsafe({ client_id: config.clientId }),
      httpClient.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(DeviceAuthorizationResponse)),
      Effect.timeout(AUTH_REQUEST_TIMEOUT),
    );
    const expiresIn = Duration.seconds(authorization.expires_in);
    const interval =
      authorization.interval === undefined
        ? DEVICE_AUTHORIZATION_DEFAULT_INTERVAL
        : Duration.seconds(authorization.interval);
    yield* showPrompt({
      verificationUri: authorization.verification_uri,
      verificationUriComplete: authorization.verification_uri_complete,
      userCode: authorization.user_code,
      expiresIn,
    });
    const sessionToken = yield* pollDeviceToken(config, authorization.device_code, interval).pipe(
      Effect.timeout(expiresIn),
      Effect.catchTags({
        TimeoutError: (cause) => Effect.fail(new CloudCliAuthorizationTimeoutError({ cause })),
      }),
    );
    const identity = yield* readSessionIdentity(config, sessionToken);
    const token = yield* issueRelayToken(config, sessionToken, identity);
    return { token, identity: identity ?? null };
  },
);

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const services = Context.make(HttpClient.HttpClient, httpClient);
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const semaphore = yield* Semaphore.make(1);
  const persist = Effect.fn("cloud.cli_token.persist")(function* (token: PersistedToken) {
    const encoded = yield* encodePersistedToken(token);
    yield* secrets.set(CLOUD_CLI_OAUTH_TOKEN_SECRET, stringToBytes(encoded));
    return token;
  });

  const clear = secrets
    .remove(CLOUD_CLI_OAUTH_TOKEN_SECRET)
    .pipe(Effect.mapError((cause) => new CloudCliCredentialRemovalError({ cause })));

  const read = Effect.fn("cloud.cli_token.read")(function* () {
    const encoded = yield* secrets.get(CLOUD_CLI_OAUTH_TOKEN_SECRET);
    if (Option.isNone(encoded)) return Option.none<PersistedToken>();
    return Option.some(yield* decodePersistedToken(bytesToString(encoded.value)));
  });

  // An ended session (signed out everywhere, account deleted) fails here, and
  // callers fall through to a fresh device authorization.
  const refresh = Effect.fn("cloud.cli_token.refresh")(function* (token: PersistedToken) {
    const config = yield* cloudCliAuthConfig;
    return yield* issueRelayToken(config, token.refreshToken, token.identity);
  });

  const getExistingNoLock = Effect.fn("cloud.cli_token.get_existing_no_lock")(function* () {
    const token = yield* read();
    if (Option.isNone(token)) return token;
    const now = yield* Clock.currentTimeMillis;
    if (token.value.expiresAtEpochMs - CLOUD_CLI_RELAY_TOKEN_REFRESH_EARLY_MS > now) {
      return token;
    }
    return Option.some(yield* refresh(token.value).pipe(Effect.flatMap(persist)));
  });

  const getExisting = semaphore.withPermits(1)(
    getExistingNoLock().pipe(
      Effect.mapError(
        (cause) =>
          new CloudCliCredentialRefreshError({
            cause,
            ...(HttpClientError.isHttpClientError(cause) && cause.reason._tag === "StatusCodeError"
              ? { status: cause.reason.response.status }
              : {}),
          }),
      ),
      Effect.provide(services),
    ),
  );
  const hasCredential = semaphore.withPermits(1)(
    read().pipe(
      Effect.map(Option.isSome),
      Effect.mapError((cause) => new CloudCliCredentialReadError({ cause })),
    ),
  );
  const store = Effect.fn("cloud.cli_token.store")(function* (token: PersistedToken) {
    yield* semaphore.withPermits(1)(
      persist(token).pipe(
        Effect.asVoid,
        Effect.mapError((cause) => new CloudCliAuthorizationError({ cause })),
      ),
    );
  });

  return CloudCliTokenManager.of({ getExisting, hasCredential, store, clear });
});

export const layer = Layer.effect(CloudCliTokenManager, make);
