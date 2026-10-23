import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import type { OAuthCredentials } from "./options.ts";

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** A compact ES256 JWS. Web Crypto's ECDSA output is already JWS's r||s form. */
const signES256 = async (pem: string, header: object, payload: object) => {
  const der = Buffer.from(pem.replace(/-----[^-]+-----/gu, "").replace(/\s+/gu, ""), "base64");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const input = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
};

/** Apple caps a client secret's lifetime at six months. */
const SECRET_LIFETIME_SECONDS = 180 * 24 * 60 * 60;

const appleKey = Config.all({
  clientId: Config.String("APPLE_CLIENT_ID"),
  keyId: Config.String("APPLE_KEY_ID"),
  privateKey: Config.Redacted("APPLE_PRIVATE_KEY"),
  teamId: Config.String("APPLE_TEAM_ID").pipe(Config.withDefault("SC9Q89Q4B6")),
}).pipe(Config.option);

/**
 * Sign in with Apple's credentials, or undefined when no key is configured.
 * Apple wants the client secret as an ES256 JWT signed with the team's .p8
 * key; it's minted when the service starts, well inside its lifetime since
 * every deploy restarts the service.
 */
export const appleCredentials = Effect.gen(function* () {
  const key = yield* appleKey;
  if (Option.isNone(key)) return undefined;
  const { clientId, keyId, privateKey, teamId } = key.value;
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
  const clientSecret = yield* Effect.promise(() =>
    signES256(
      Redacted.value(privateKey),
      { alg: "ES256", kid: keyId },
      {
        iss: teamId,
        sub: clientId,
        aud: "https://appleid.apple.com",
        iat: now,
        exp: now + SECRET_LIFETIME_SECONDS,
      },
    ),
  );
  return { clientId, clientSecret } satisfies OAuthCredentials;
});
