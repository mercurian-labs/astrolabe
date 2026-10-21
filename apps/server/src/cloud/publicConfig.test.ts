import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  makeAuthUrlConfig,
  makeCloudCliAuthConfig,
  makeRelayUrlConfig,
  resolveRelayClientTracingConfig,
} from "./publicConfig.ts";

const provideEnv = (env: Readonly<Record<string, string>>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

it.effect("uses the statically injected relay URL when no runtime override exists", () =>
  Effect.gen(function* () {
    const relayUrl = yield* makeRelayUrlConfig("https://embedded.example.test///").pipe(
      provideEnv({}),
    );

    assert.equal(relayUrl, "https://embedded.example.test");
  }),
);

it.effect("prefers a runtime relay URL override over the statically injected value", () =>
  Effect.gen(function* () {
    const relayUrl = yield* makeRelayUrlConfig("https://embedded.example.test").pipe(
      provideEnv({ T3CODE_RELAY_URL: "https://runtime.example.test///" }),
    );

    assert.equal(relayUrl, "https://runtime.example.test");
  }),
);

it.effect("requires a relay URL when the server bundle has no injected value", () =>
  makeRelayUrlConfig("").pipe(provideEnv({}), Effect.flip),
);

it.effect("rejects an insecure runtime relay URL override", () =>
  makeRelayUrlConfig("https://embedded.example.test").pipe(
    provideEnv({ T3CODE_RELAY_URL: "http://runtime.example.test" }),
    Effect.flip,
  ),
);

it.effect("rejects an injected relay URL with a non-origin path", () =>
  makeRelayUrlConfig("https://embedded.example.test/path").pipe(provideEnv({}), Effect.flip),
);

it.effect("normalizes the auth URL to an absolute origin", () =>
  Effect.gen(function* () {
    assert.equal(
      yield* makeAuthUrlConfig("").pipe(
        provideEnv({ T3CODE_AUTH_URL: "https://app.astrolabe.sh/" }),
      ),
      "https://app.astrolabe.sh",
    );
    assert.equal(
      yield* makeAuthUrlConfig("").pipe(provideEnv({ T3CODE_AUTH_URL: "http://localhost:4310" })),
      "http://localhost:4310",
    );
  }),
);

it.effect("rejects malformed or insecure auth URLs", () =>
  Effect.gen(function* () {
    for (const value of [
      "app.astrolabe.sh",
      "http://app.astrolabe.sh",
      "https://app.astrolabe.sh/nested",
      "https://app.astrolabe.sh?alias=true",
    ]) {
      const result = yield* makeAuthUrlConfig("").pipe(
        provideEnv({ T3CODE_AUTH_URL: value }),
        Effect.result,
      );
      assert.isTrue(Result.isFailure(result), value);
    }
  }),
);

it.effect("derives the CLI's sign-in endpoints from the injected auth URL", () =>
  Effect.gen(function* () {
    const config = yield* makeCloudCliAuthConfig("https://auth.example.test").pipe(provideEnv({}));

    assert.deepEqual(config, {
      deviceCodeEndpoint: "https://auth.example.test/api/auth/device/code",
      deviceTokenEndpoint: "https://auth.example.test/api/auth/device/token",
      sessionEndpoint: "https://auth.example.test/api/auth/get-session",
      relayTokenEndpoint: "https://auth.example.test/api/auth/token",
      clientId: "astrolabe-cli",
    });
  }),
);

it.effect("prefers a runtime auth URL over the injected one", () =>
  Effect.gen(function* () {
    const config = yield* makeCloudCliAuthConfig("https://embedded.example.test").pipe(
      provideEnv({ T3CODE_AUTH_URL: "https://runtime.example.test" }),
    );

    assert.equal(config.relayTokenEndpoint, "https://runtime.example.test/api/auth/token");
  }),
);

it.effect("requires an auth URL when the server bundle has no injected value", () =>
  makeCloudCliAuthConfig("").pipe(provideEnv({}), Effect.flip),
);

it("resolves relay client tracing from runtime config with build-time fallback", () => {
  const fallback = {
    tracesUrl: "https://embedded.example.test/v1/traces",
    tracesDataset: "embedded-dataset",
    tracesToken: "embedded-token",
  };

  assert.deepEqual(resolveRelayClientTracingConfig({}, fallback), fallback);
  assert.deepEqual(
    resolveRelayClientTracingConfig(
      {
        T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://runtime.example.test/v1/traces",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "runtime-dataset",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "runtime-token",
      },
      fallback,
    ),
    {
      tracesUrl: "https://runtime.example.test/v1/traces",
      tracesDataset: "runtime-dataset",
      tracesToken: "runtime-token",
    },
  );
  assert.equal(
    resolveRelayClientTracingConfig(
      {
        T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: "http://insecure.example.test/v1/traces",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "runtime-dataset",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "runtime-token",
      },
      fallback,
    ),
    null,
  );
});

it("product opt-out disables relay tracing with either built-in or runtime credentials", () => {
  const fallback = {
    tracesUrl: "https://embedded.example.test/v1/traces",
    tracesDataset: "embedded-dataset",
    tracesToken: "embedded-token",
  };
  const env = {
    T3CODE_TELEMETRY_ENABLED: "false",
    T3CODE_OTEL_SDK_DISABLED: "false",
  };

  assert.equal(resolveRelayClientTracingConfig(env, fallback), null);
  assert.equal(
    resolveRelayClientTracingConfig(
      {
        ...env,
        T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://runtime.example.test/v1/traces",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "runtime-dataset",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "runtime-token",
      },
      fallback,
    ),
    null,
  );
});
