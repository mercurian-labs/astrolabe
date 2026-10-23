import { it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { expect } from "vite-plus/test";

import { appleCredentials } from "./apple.ts";

const fromBase64url = (value: string) => Buffer.from(value, "base64url");

it.effect("signs Apple's client secret as an ES256 JWT that verifies with the team key", () =>
  Effect.gen(function* () {
    const keys = yield* Effect.promise(() =>
      crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
    );
    const pkcs8 = yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", keys.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString("base64")}\n-----END PRIVATE KEY-----`;

    const credentials = yield* appleCredentials.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({
          APPLE_CLIENT_ID: "sh.astrolabe.auth",
          APPLE_KEY_ID: "KEY123",
          APPLE_PRIVATE_KEY: pem,
        }),
      ),
    );
    const [header, payload, signature] = credentials!.clientSecret.split(".");
    expect(JSON.parse(fromBase64url(header!).toString())).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(fromBase64url(payload!).toString())).toMatchObject({
      iss: "SC9Q89Q4B6",
      sub: "sh.astrolabe.auth",
      aud: "https://appleid.apple.com",
    });
    const valid = yield* Effect.promise(() =>
      crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keys.publicKey,
        fromBase64url(signature!),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    );
    expect(valid).toBe(true);
  }),
);
