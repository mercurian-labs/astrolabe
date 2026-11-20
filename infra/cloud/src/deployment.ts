/**
 * Settings for a deployed stage (`prod`, later `staging`), read from the deploying process's
 * environment. Local dev reads none of these; see resources.ts for what each stage creates.
 */
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/** The header the app router sends with every request it forwards; the load balancer drops the rest. */
export const ORIGIN_SECRET_HEADER = "x-astrolabe-origin-secret";
/** The visitor's address as the app router saw it, which rate limits count by. */
export const CLIENT_IP_HEADER = "x-astrolabe-client-ip";

/** Sign-in provider settings passed to the API when set, so a provider turns on by adding them. */
const OPTIONAL_API_SETTINGS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
] as const;

const origin = (name: string) =>
  Config.URL(name).pipe(
    Config.map((url) => url.origin),
    Effect.orDie,
  );

export const Deployment = Effect.gen(function* () {
  // Where people and clients reach the cloud: the app router on this origin forwards the
  // sign-in pages and /api/* here (apps/web/cloudflare/router.ts).
  const appUrl = yield* origin("CLOUD_APP_URL");
  const relayUrl = yield* origin("RELAY_URL");
  // The load balancer's own name, a DNS-only record in Cloudflare that only the app router uses.
  const originDomain = yield* Config.NonEmptyString("CLOUD_ORIGIN_DOMAIN").pipe(Effect.orDie);
  const originSecret = yield* Config.Redacted("CLOUD_ORIGIN_SECRET").pipe(Effect.orDie);
  // An SES domain identity, verified with DKIM in Cloudflare by hand; the stack adopts it.
  const mailDomain = yield* Config.NonEmptyString("CLOUD_MAIL_DOMAIN").pipe(Effect.orDie);
  const optional: Record<string, string> = {};
  for (const name of OPTIONAL_API_SETTINGS) {
    const value = yield* Config.String(name).pipe(Config.option, Effect.orDie);
    if (Option.isSome(value) && value.value.trim() !== "") optional[name] = value.value;
  }
  return {
    appUrl,
    relayUrl,
    originDomain,
    originSecret: Redacted.value(originSecret),
    mailDomain,
    optional,
  };
});
