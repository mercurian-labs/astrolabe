import { normalizeAuthOrigin } from "@t3tools/shared/mercurianAccount";
import { isRelayTracingEnabled } from "@t3tools/shared/otelEnvironment";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

declare const __T3CODE_BUILD_RELAY_URL__: string | undefined;
declare const __T3CODE_BUILD_AUTH_URL__: string | undefined;
declare const __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_URL__: string | undefined;
declare const __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_DATASET__: string | undefined;
declare const __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_TOKEN__: string | undefined;

/** Names the CLI on the device approval page. */
const CLOUD_CLI_CLIENT_ID = "astrolabe-cli";

function validateRelayUrl(value: string) {
  const relayUrl = normalizeSecureRelayUrl(value);
  return relayUrl === null
    ? Effect.fail(
        new Config.ConfigError(
          new Schema.SchemaError(
            new SchemaIssue.InvalidValue({
              message: "Relay URL must be a secure absolute HTTPS origin.",
            }),
          ),
        ),
      )
    : Effect.succeed(relayUrl);
}

function readBuildTimeValue(value: string | undefined): string {
  return typeof value === "undefined" ? "" : value.trim();
}

function normalizeSecureUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const buildTimeRelayUrl =
  typeof __T3CODE_BUILD_RELAY_URL__ === "undefined"
    ? ""
    : (normalizeSecureRelayUrl(__T3CODE_BUILD_RELAY_URL__) ?? "");
const buildTimeAuthUrl = readBuildTimeValue(
  typeof __T3CODE_BUILD_AUTH_URL__ === "undefined" ? undefined : __T3CODE_BUILD_AUTH_URL__,
);
const buildTimeRelayClientTracing = {
  tracesUrl: readBuildTimeValue(
    typeof __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_URL__ === "undefined"
      ? undefined
      : __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_URL__,
  ),
  tracesDataset: readBuildTimeValue(
    typeof __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_DATASET__ === "undefined"
      ? undefined
      : __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_DATASET__,
  ),
  tracesToken: readBuildTimeValue(
    typeof __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_TOKEN__ === "undefined"
      ? undefined
      : __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_TOKEN__,
  ),
} as const;

export function resolveRelayClientTracingConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fallback = buildTimeRelayClientTracing,
) {
  if (!isRelayTracingEnabled(env)) {
    return null;
  }

  const tracesUrl = env.T3CODE_RELAY_CLIENT_OTLP_TRACES_URL?.trim() || fallback.tracesUrl;
  const tracesDataset =
    env.T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET?.trim() || fallback.tracesDataset;
  const tracesToken = env.T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN?.trim() || fallback.tracesToken;
  const normalizedTracesUrl = normalizeSecureUrl(tracesUrl);
  return normalizedTracesUrl && tracesDataset && tracesToken
    ? { tracesUrl: normalizedTracesUrl, tracesDataset, tracesToken }
    : null;
}

export function makeRelayUrlConfig(fallback = buildTimeRelayUrl) {
  const runtimeConfig = Config.NonEmptyString("T3CODE_RELAY_URL");
  return (fallback ? runtimeConfig.pipe(Config.withDefault(fallback)) : runtimeConfig).pipe(
    Config.mapEffect(validateRelayUrl),
  );
}

export const relayUrlConfig = makeRelayUrlConfig();

/**
 * The sign-in pages' origin (app.astrolabe.sh). Overridable so a CLI
 * can point at a local cloud stack, which serves plain HTTP on loopback.
 */
export function makeAuthUrlConfig(fallback = buildTimeAuthUrl) {
  return makePublicValueConfig("T3CODE_AUTH_URL", fallback).pipe(Config.mapEffect(validateAuthUrl));
}

function validateAuthUrl(value: string) {
  const origin = normalizeAuthOrigin(value);
  return origin === null
    ? Effect.fail(
        new Config.ConfigError(
          new Schema.SchemaError(
            new SchemaIssue.InvalidValue({
              message: "Auth URL must be an absolute HTTPS origin (or a local HTTP origin).",
            }),
          ),
        ),
      )
    : Effect.succeed(origin);
}

function makePublicValueConfig(name: string, fallback: string) {
  const runtimeConfig = Config.NonEmptyString(name);
  return (fallback ? runtimeConfig.pipe(Config.withDefault(fallback)) : runtimeConfig).pipe(
    Config.map((value) => value.trim()),
  );
}

/**
 * The CLI signs in with Better Auth's device authorization grant, whatever
 * machine it runs on: the user approves a short code at app.astrolabe.sh/device
 * from any browser. The grant returns a Better Auth session token, which the
 * CLI trades at `/token` for the short-lived relay token every client uses.
 */
export interface CloudCliAuthConfig {
  readonly deviceCodeEndpoint: string;
  readonly deviceTokenEndpoint: string;
  readonly sessionEndpoint: string;
  readonly relayTokenEndpoint: string;
  readonly clientId: string;
}

export function makeCloudCliAuthConfig(fallback = buildTimeAuthUrl) {
  return makeAuthUrlConfig(fallback).pipe(
    Config.map((authUrl): CloudCliAuthConfig => ({
      deviceCodeEndpoint: `${authUrl}/api/auth/device/code`,
      deviceTokenEndpoint: `${authUrl}/api/auth/device/token`,
      sessionEndpoint: `${authUrl}/api/auth/get-session`,
      relayTokenEndpoint: `${authUrl}/api/auth/token`,
      clientId: CLOUD_CLI_CLIENT_ID,
    })),
  );
}

export const cloudCliAuthConfig = makeCloudCliAuthConfig();

export const hasCloudPublicConfig = Boolean(
  (normalizeSecureRelayUrl(process.env.T3CODE_RELAY_URL ?? "") ?? buildTimeRelayUrl) &&
  (process.env.T3CODE_AUTH_URL?.trim() || buildTimeAuthUrl),
);
