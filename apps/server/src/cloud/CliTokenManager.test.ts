import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CliTokenManager from "./CliTokenManager.ts";

const TEST_ENV = { T3CODE_AUTH_URL: "https://auth.example.test" };

const provideTestEnv = Effect.provide(
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: TEST_ENV })),
);

const isAuthorizationError = Schema.is(CliTokenManager.CloudCliAuthorizationError);

interface RecordedRequest {
  readonly path: string;
  readonly body: unknown;
  readonly authorization: string | undefined;
}

interface Reply {
  readonly status: number;
  readonly body: string;
}

interface AuthServer {
  readonly requests: Array<RecordedRequest>;
  /** Device token replies, consumed in order; the last one repeats. */
  readonly deviceTokenReplies: Array<Reply>;
  /** `/token` replies, consumed in order; the last one repeats. */
  readonly relayTokenReplies: Array<Reply>;
}

const DEVICE_AUTHORIZATION_BODY = JSON.stringify({
  device_code: "device-code-1",
  user_code: "BCDF-GHJK",
  verification_uri: "https://auth.example.test/device",
  verification_uri_complete: "https://auth.example.test/device?user_code=BCDF-GHJK",
  expires_in: 600,
  interval: 5,
});

const TestJwtPayloadJson = Schema.fromJsonString(
  Schema.Struct({ sub: Schema.String, exp: Schema.Number }),
);
const encodeTestJwtPayload = Schema.encodeSync(TestJwtPayloadJson);
/** An unsigned relay token; the CLI only reads `exp` from it. */
const relayToken = (expSeconds: number) =>
  `e30.${Base64Url.encode(encodeTestJwtPayload({ sub: "user-1", exp: expSeconds }))}.`;

const oauthError = (error: string): Reply => ({ status: 400, body: JSON.stringify({ error }) });
const sessionGranted: Reply = {
  status: 200,
  body: JSON.stringify({ access_token: "session-1", token_type: "Bearer", expires_in: 604800 }),
};
const relayTokenIssued = (expSeconds: number): Reply => ({
  status: 200,
  body: JSON.stringify({ token: relayToken(expSeconds) }),
});

const nextReply = (replies: Array<Reply>, fallback: Reply) =>
  (replies.length > 1 ? replies.shift() : replies[0]) ?? fallback;

const layerAuthServer = (server: AuthServer) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        const path = new URL(request.url).pathname;
        const text =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        server.requests.push({
          path,
          body: text ? JSON.parse(text) : undefined,
          authorization: request.headers.authorization,
        });
        const reply =
          path === "/api/auth/device/code"
            ? { status: 200, body: DEVICE_AUTHORIZATION_BODY }
            : path === "/api/auth/device/token"
              ? nextReply(server.deviceTokenReplies, oauthError("invalid_grant"))
              : path === "/api/auth/get-session"
                ? { status: 200, body: JSON.stringify({ user: { email: "theo@example.test" } }) }
                : nextReply(server.relayTokenReplies, { status: 401, body: "{}" });
        return HttpClientResponse.fromWeb(
          request,
          new Response(reply.body, {
            status: reply.status,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    ),
  );

/** Answers every request with a body that never finishes. */
const layerStalledBody = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(
          new ReadableStream({
            start: (controller) => controller.enqueue(new TextEncoder().encode("{")),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    ),
  ),
);

const requestsTo = (requests: ReadonlyArray<RecordedRequest>, path: string) =>
  requests.filter((request) => request.path === path);

const startLogin = (server: AuthServer) =>
  CliTokenManager.deviceAuthorizationLogin(() => Effect.void).pipe(
    Effect.provide(layerAuthServer(server)),
    provideTestEnv,
  );

it.layer(NodeServices.layer)("CliTokenManager.deviceAuthorizationLogin", (it) => {
  it.effect("polls until approval, then trades the session for a relay token", () =>
    Effect.gen(function* () {
      const server: AuthServer = {
        requests: [],
        deviceTokenReplies: [oauthError("authorization_pending"), sessionGranted],
        relayTokenReplies: [relayTokenIssued(900)],
      };
      const prompts: Array<CliTokenManager.DeviceAuthorizationPrompt> = [];

      const fiber = yield* CliTokenManager.deviceAuthorizationLogin((prompt) =>
        Effect.sync(() => {
          prompts.push(prompt);
        }),
      ).pipe(Effect.provide(layerAuthServer(server)), provideTestEnv, Effect.forkChild);

      yield* TestClock.adjust(Duration.seconds(10));
      const { token, identity } = yield* Fiber.join(fiber);

      assert.deepEqual(prompts, [
        {
          verificationUri: "https://auth.example.test/device",
          verificationUriComplete: "https://auth.example.test/device?user_code=BCDF-GHJK",
          userCode: "BCDF-GHJK",
          expiresIn: Duration.seconds(600),
        },
      ]);
      assert.deepEqual(token, {
        accessToken: relayToken(900),
        refreshToken: "session-1",
        expiresAtEpochMs: 900_000,
        identity: "theo@example.test",
      });
      assert.equal(identity, "theo@example.test");

      assert.deepEqual(requestsTo(server.requests, "/api/auth/device/code")[0]?.body, {
        client_id: "astrolabe-cli",
      });
      const polls = requestsTo(server.requests, "/api/auth/device/token");
      assert.lengthOf(polls, 2);
      for (const poll of polls) {
        assert.deepEqual(poll.body, {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: "device-code-1",
          client_id: "astrolabe-cli",
        });
      }
      assert.equal(
        requestsTo(server.requests, "/api/auth/token")[0]?.authorization,
        "Bearer session-1",
      );
    }),
  );

  it.effect("waits the advertised interval between polls and backs off on slow_down", () =>
    Effect.gen(function* () {
      const server: AuthServer = {
        requests: [],
        deviceTokenReplies: [oauthError("slow_down"), oauthError("authorization_pending")],
        relayTokenReplies: [],
      };

      const fiber = yield* startLogin(server).pipe(Effect.forkChild);
      const polls = () => requestsTo(server.requests, "/api/auth/device/token");

      yield* TestClock.adjust(Duration.seconds(4));
      assert.lengthOf(polls(), 0);
      yield* TestClock.adjust(Duration.seconds(1));
      assert.lengthOf(polls(), 1);
      // slow_down widens the 5s interval to 10s.
      yield* TestClock.adjust(Duration.seconds(9));
      assert.lengthOf(polls(), 1);
      yield* TestClock.adjust(Duration.seconds(1));
      assert.lengthOf(polls(), 2);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("backs off after a transient upstream failure and keeps polling", () =>
    Effect.gen(function* () {
      const server: AuthServer = {
        requests: [],
        deviceTokenReplies: [{ status: 503, body: "upstream unavailable" }, sessionGranted],
        relayTokenReplies: [relayTokenIssued(900)],
      };

      const fiber = yield* startLogin(server).pipe(Effect.forkChild);
      const polls = () => requestsTo(server.requests, "/api/auth/device/token");

      yield* TestClock.adjust(Duration.seconds(5));
      assert.lengthOf(polls(), 1);
      // The 5xx widens the 5s interval to 10s before the retry.
      yield* TestClock.adjust(Duration.seconds(9));
      assert.lengthOf(polls(), 1);
      yield* TestClock.adjust(Duration.seconds(1));
      const { token } = yield* Fiber.join(fiber);
      assert.lengthOf(polls(), 2);
      assert.equal(token.refreshToken, "session-1");
    }),
  );

  it.effect("fails with a denied error when the user rejects the request", () =>
    Effect.gen(function* () {
      const server: AuthServer = {
        requests: [],
        deviceTokenReplies: [oauthError("access_denied")],
        relayTokenReplies: [],
      };

      const fiber = yield* startLogin(server).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust(Duration.seconds(5));
      const result = yield* Fiber.join(fiber);

      assert.instanceOf(result, CliTokenManager.CloudCliAuthorizationDeniedError);
    }),
  );

  it.effect("times out once the device code lifetime elapses", () =>
    Effect.gen(function* () {
      const server: AuthServer = {
        requests: [],
        deviceTokenReplies: [oauthError("authorization_pending")],
        relayTokenReplies: [],
      };

      const fiber = yield* startLogin(server).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust(Duration.seconds(600));
      const result = yield* Fiber.join(fiber);

      assert.instanceOf(result, CliTokenManager.CloudCliAuthorizationTimeoutError);
    }),
  );

  it.effect("surfaces other OAuth errors as authorization failures", () =>
    Effect.gen(function* () {
      const server: AuthServer = {
        requests: [],
        deviceTokenReplies: [oauthError("invalid_grant")],
        relayTokenReplies: [],
      };

      const fiber = yield* startLogin(server).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust(Duration.seconds(5));
      const result = yield* Fiber.join(fiber);

      assert.isTrue(isAuthorizationError(result));
    }),
  );

  it.effect("tells a waitlisted account why it gets no relay token", () =>
    Effect.gen(function* () {
      const server: AuthServer = {
        requests: [],
        deviceTokenReplies: [sessionGranted],
        relayTokenReplies: [
          { status: 403, body: JSON.stringify({ code: "WAITLISTED", message: "On the list" }) },
        ],
      };

      const fiber = yield* startLogin(server).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust(Duration.seconds(5));
      const result = yield* Fiber.join(fiber);

      assert.instanceOf(result, CliTokenManager.CloudCliAccountWaitlistedError);
    }),
  );

  it.effect("fails instead of hanging when the device code response stalls", () =>
    Effect.gen(function* () {
      const fiber = yield* CliTokenManager.deviceAuthorizationLogin(() => Effect.void).pipe(
        Effect.provide(layerStalledBody),
        provideTestEnv,
        Effect.flip,
        Effect.forkChild,
      );
      yield* TestClock.adjust(Duration.seconds(10));

      assert.isTrue(Cause.isTimeoutError(yield* Fiber.join(fiber)));
    }),
  );
});

const PersistedTokenJson = Schema.fromJsonString(
  Schema.Struct({
    accessToken: Schema.String,
    refreshToken: Schema.String,
    expiresAtEpochMs: Schema.Number,
    identity: Schema.optional(Schema.String),
  }),
);
const encodePersistedToken = Schema.encodeSync(PersistedTokenJson);
const decodePersistedToken = Schema.decodeEffect(PersistedTokenJson);

const layerMemorySecretStore = (secrets: Map<string, Uint8Array>) =>
  Layer.succeed(
    ServerSecretStore.ServerSecretStore,
    ServerSecretStore.ServerSecretStore.of({
      get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
      set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
      create: (name, value) => Effect.sync(() => void secrets.set(name, value)),
      getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
      remove: (name) => Effect.sync(() => void secrets.delete(name)),
    }),
  );

const withStoredToken = (expiresAtEpochMs: number) =>
  new Map([
    [
      "cloud-cli-oauth-token",
      new TextEncoder().encode(
        encodePersistedToken({
          accessToken: relayToken(expiresAtEpochMs / 1_000),
          refreshToken: "session-1",
          expiresAtEpochMs,
          identity: "theo@example.test",
        }),
      ),
    ],
  ]);

const withManager = <A, E>(
  httpClient: Layer.Layer<HttpClient.HttpClient>,
  secrets: Map<string, Uint8Array>,
  use: (manager: CliTokenManager.CloudCliTokenManager["Service"]) => Effect.Effect<A, E>,
) =>
  CliTokenManager.make.pipe(
    Effect.flatMap(use),
    Effect.provide(Layer.merge(httpClient, layerMemorySecretStore(secrets))),
    provideTestEnv,
  );

const getExisting = (server: AuthServer, secrets: Map<string, Uint8Array>) =>
  withManager(layerAuthServer(server), secrets, (manager) => manager.getExisting);

it.effect("reuses a stored relay token that is still fresh", () =>
  Effect.gen(function* () {
    const server: AuthServer = { requests: [], deviceTokenReplies: [], relayTokenReplies: [] };

    const token = yield* getExisting(server, withStoredToken(900_000));

    assert.equal(Option.getOrThrow(token).expiresAtEpochMs, 900_000);
    assert.lengthOf(server.requests, 0);
  }),
);

it.effect("mints a new relay token from the stored session when the old one is expiring", () =>
  Effect.gen(function* () {
    const server: AuthServer = {
      requests: [],
      deviceTokenReplies: [],
      relayTokenReplies: [relayTokenIssued(1_800)],
    };
    const secrets = withStoredToken(30_000);

    const token = Option.getOrThrow(yield* getExisting(server, secrets));

    assert.equal(token.accessToken, relayToken(1_800));
    assert.equal(token.refreshToken, "session-1");
    assert.equal(token.identity, "theo@example.test");
    assert.equal(
      requestsTo(server.requests, "/api/auth/token")[0]?.authorization,
      "Bearer session-1",
    );
    const stored = yield* decodePersistedToken(
      new TextDecoder().decode(secrets.get("cloud-cli-oauth-token")),
    );
    assert.equal(stored.expiresAtEpochMs, 1_800_000);
  }),
);

it.effect.each([
  { status: 401, requiresLogin: true },
  { status: 403, requiresLogin: true },
  { status: 408, requiresLogin: false },
  { status: 429, requiresLogin: false },
  { status: 500, requiresLogin: false },
])(
  "a relay-token refusal with HTTP $status keeps the credential and says whether to sign in again",
  ({ status, requiresLogin }) =>
    Effect.gen(function* () {
      const server: AuthServer = {
        requests: [],
        deviceTokenReplies: [],
        relayTokenReplies: [
          { status, body: JSON.stringify({ code: "private-code", message: "private-message" }) },
        ],
      };

      const [error, hasCredential] = yield* withManager(
        layerAuthServer(server),
        withStoredToken(30_000),
        (manager) => Effect.all([manager.getExisting.pipe(Effect.flip), manager.hasCredential]),
      );

      assert.instanceOf(error, CliTokenManager.CloudCliCredentialRefreshError);
      assert.equal(error.requiresLogin, requiresLogin);
      assert.equal(error.message.includes("astrolabe connect login"), requiresLogin);
      assert.notInclude(error.message, "private");
      assert.isTrue(HttpClientError.isHttpClientError(error.cause));
      if (HttpClientError.isHttpClientError(error.cause)) {
        assert.equal(error.cause.reason._tag, "StatusCodeError");
        if (error.cause.reason._tag === "StatusCodeError") {
          assert.equal(error.cause.reason.response.status, status);
        }
      }
      assert.isTrue(hasCredential);
    }),
);

it.effect("a stalled relay-token refresh fails and releases the credential lock", () =>
  withManager(layerStalledBody, withStoredToken(30_000), (manager) =>
    Effect.gen(function* () {
      const refresh = yield* manager.getExisting.pipe(Effect.flip, Effect.forkChild);
      const hasCredential = yield* manager.hasCredential.pipe(Effect.forkChild);

      yield* TestClock.adjust(Duration.seconds(10));

      const error = yield* Fiber.join(refresh);
      assert.instanceOf(error, CliTokenManager.CloudCliCredentialRefreshError);
      assert.isFalse(error.requiresLogin);
      assert.isTrue(yield* Fiber.join(hasCredential));
    }),
  ),
);
