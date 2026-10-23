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

it.effect("rejects an insecure runtime relay URL override", () =>
  makeRelayUrlConfig("https://embedded.example.test").pipe(
    provideEnv({ T3CODE_RELAY_URL: "http://runtime.example.test" }),
    Effect.flip,
  ),
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
