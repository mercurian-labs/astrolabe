import { normalizeRelayIssuer } from "@t3tools/shared/relayJwt";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Astrolabe account tokens: short-lived JWTs from app.astrolabe.sh
 * (`/api/auth/token`), signed EdDSA with keys published at
 * `<issuer>/api/auth/jwks`. Their audience is this relay's own origin.
 */
export class AccountTokenVerificationFailed extends Schema.TaggedError<AccountTokenVerificationFailed>()(
  "AccountTokenVerificationFailed",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Account token verification failed";
  }
}

// One key set per issuer for the isolate's life; jose caches keys and refetches on an unknown kid.
const keySets = new Map<string, JWTVerifyGetKey>();
const keySetFor = (issuer: string) => {
  let keySet = keySets.get(issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL("/api/auth/jwks", issuer));
    keySets.set(issuer, keySet);
  }
  return keySet;
};

export const verifyAccountToken = (
  settings: { readonly accountJwtIssuer: string; readonly relayIssuer: string },
  token: string,
) =>
  Effect.tryPromise({
    try: async () => {
      const issuer = normalizeRelayIssuer(settings.accountJwtIssuer);
      const { payload } = await jwtVerify(token, keySetFor(issuer), {
        issuer,
        audience: normalizeRelayIssuer(settings.relayIssuer),
        algorithms: ["EdDSA"],
      });
      if (!payload.sub) throw new Error("missing_subject");
      return { sub: payload.sub };
    },
    catch: (cause) => new AccountTokenVerificationFailed({ cause }),
  }).pipe(
    Effect.withSpan("verify_account_token", {
      attributes: { "relay.auth.token_length": token.length },
    }),
  );

/** A short, log-safe reason for a rejected token. */
export function accountTokenFailureReason(cause: unknown): string {
  if (cause instanceof errors.JOSEError) return cause.code.toLowerCase();
  if (cause instanceof Error && /^[a-z0-9._-]+$/i.test(cause.message)) return cause.message;
  return "unknown";
}
