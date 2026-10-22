// @effect-diagnostics anyUnknownInErrorContext:off - Alchemy runtimes expose framework-owned any requirements.
/**
 * The cloud API's request handling. infra/cloud/src/Api.ts hosts it as an
 * Alchemy ECS service, which supplies the runtime, the SES binding behind
 * `sendMail`, and Better Auth's managed secret.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { BetterAuth, Database } from "@alchemy.run/better-auth";
import { ALCHEMY_PHASE } from "alchemy/Phase";
import { drizzle } from "drizzle-orm/node-postgres";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as ServerRequest from "effect/http/HttpServerRequest";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { Pool } from "pg";
import { WORKSPACE_PATHS, isWorkspaceShape } from "@t3tools/shared/mercurianWorkspaces";

import { appleCredentials } from "./auth/apple.ts";
import { authOptions, type AuthConfig, type OAuthCredentials } from "./auth/options.ts";
import * as schema from "./auth/schema.ts";
import type { Mail } from "./mail/Mailer.ts";
import { decideCors } from "./cors.ts";
import { loadMailbox } from "./dev/mailbox.ts";
import { renderPage } from "./pages.ts";
import { deletePushRegistrations, removeRelayData } from "./relay/RelayAccount.ts";
import { defineShape, electricShapeUrl, privateShapeHeaders } from "./workspaces/shapes.ts";
import { makeWorkspaceWriter, type WorkspaceApi } from "./workspaces/writes.ts";

const optional = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));

const list = (name: string) =>
  Config.String(name).pipe(
    Config.withDefault(""),
    Config.map((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const oauth = (prefix: string) =>
  Config.all({
    clientId: Config.String(`${prefix}_CLIENT_ID`),
    clientSecret: Config.Redacted(`${prefix}_CLIENT_SECRET`),
  }).pipe(
    Config.map(({ clientId, clientSecret }): OAuthCredentials => ({
      clientId,
      clientSecret: Redacted.value(clientSecret),
    })),
    Config.option,
    Config.map(Option.getOrUndefined),
  );

// Every setting has a default: Alchemy also evaluates the service at plan
// time, where the container's environment isn't present.
const authConfig = Config.all({
  baseUrl: optional("AUTH_URL"),
  trustedOrigins: list("AUTH_TRUSTED_ORIGINS"),
  passkeyRpId: Config.String("PASSKEY_RP_ID").pipe(Config.withDefault("localhost")),
  // Behind Cloudflare this must be cf-connecting-ip, or every rate limit
  // counts all visitors as Cloudflare's address.
  ipAddressHeaders: list("AUTH_IP_HEADERS").pipe(
    Config.map((headers) => (headers.length > 0 ? headers : ["x-forwarded-for"])),
  ),
  turnstileSecret: optional("TURNSTILE_SECRET_KEY"),
  turnstileSiteKey: optional("TURNSTILE_SITE_KEY"),
  // Normalized like the relay normalizes its own origin, so `aud` always matches.
  relayUrl: Config.String("RELAY_URL").pipe(
    Config.withDefault("http://localhost:8787"),
    Config.map((url) => url.trim().replace(/\/+$/u, "")),
  ),
  google: oauth("GOOGLE"),
  github: oauth("GITHUB"),
  microsoft: oauth("MICROSOFT"),
}) satisfies Config.Config<Omit<AuthConfig, "apple"> & { turnstileSiteKey: string | undefined }>;

// Settings with no safe default. Checked at startup in the running service,
// so a misconfigured deploy fails its health check instead of a sign-in.
const requiredAtRuntime = Config.all({
  databaseUrl: Config.Redacted("DATABASE_URL"),
  authUrl: Config.String("AUTH_URL"),
  // Without it every relay token would be issued for localhost.
  relayUrl: Config.String("RELAY_URL"),
});

export const makeCloudApp = (deps: {
  readonly sendMail: (mail: Mail) => Effect.Effect<void, unknown>;
  /** The built sign-in pages (`@mercurian/auth/page`); without it page paths answer 404. */
  readonly page?: string;
}) =>
  Effect.gen(function* () {
    if ((yield* ALCHEMY_PHASE) === "runtime") yield* requiredAtRuntime.pipe(Effect.orDie);
    const config: AuthConfig = { ...(yield* authConfig), apple: yield* appleCredentials };
    const corsOrigins = [...config.trustedOrigins, ...(config.baseUrl ? [config.baseUrl] : [])];
    // One pool for the process: an ECS task serves many requests. Opened on
    // first use, so plan-time evaluation never dials out.
    const pool = yield* Effect.cached(
      Config.Redacted("DATABASE_URL").pipe(
        Effect.map((url) => new Pool({ connectionString: Redacted.value(url) })),
        Effect.orDie,
      ),
    );
    // Better Auth calls back with promises; these run with the service's own
    // context, never a request's, so no request state is shared.
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const auth = yield* BetterAuth(
      authOptions(config, {
        sendMail: (mail) => runPromise(deps.sendMail(mail)),
        removeRelayData: (userId, token) =>
          runPromise(
            Effect.gen(function* () {
              yield* removeRelayData({ relayUrl: config.relayUrl, userId, token });
              yield* deletePushRegistrations(yield* pool, userId);
            }).pipe(Effect.provide(FetchHttpClient.layer)),
          ),
      }),
    ).pipe(
      // Our own database rather than the package's Drizzle layer, which drops
      // `transaction`: sign-up writes the user and their account together.
      Effect.provideService(Database, {
        provider: "postgres",
        runtime: pool.pipe(
          Effect.map((client) =>
            drizzleAdapter(drizzle({ client, relations: schema.authRelations }), {
              provider: "pg",
              schema,
              transaction: true,
            }),
          ),
        ),
      }),
    );

    // Where shapes come from; only the API reaches Electric.
    const electricUrl = yield* optional("ELECTRIC_URL");

    /** Workspace writes, in the cloud's own transaction, and shapes scoped to the caller. */
    const workspaces = (pathname: string) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const web = yield* ServerRequest.toWeb(request).pipe(Effect.orDie);
        const instance = yield* auth.auth;
        if (pathname === WORKSPACE_PATHS.write && request.method === "POST") {
          const write = makeWorkspaceWriter({
            db: drizzle({ client: yield* pool, relations: schema.authRelations }),
            api: instance.api as unknown as WorkspaceApi,
            authOptions: instance.options,
          });
          const body: unknown = yield* Effect.promise(() => web.json().catch(() => null));
          const response = yield* Effect.promise(() => write(web.headers, body));
          return HttpServerResponse.jsonUnsafe(response.body, { status: response.status });
        }
        if (pathname === WORKSPACE_PATHS.shape && request.method === "GET") {
          const session = yield* Effect.promise(() =>
            instance.api.getSession({ headers: web.headers }),
          );
          if (session === null) return HttpServerResponse.empty({ status: 401 });
          const params = new URL(web.url).searchParams;
          const shape = params.get("shape");
          if (!isWorkspaceShape(shape)) return HttpServerResponse.empty({ status: 400 });
          if (electricUrl === undefined) return HttpServerResponse.empty({ status: 503 });
          const definition = defineShape(shape, {
            userId: session.user.id,
            verifiedEmail: session.user.emailVerified ? session.user.email : null,
          });
          // Passes Electric's long-poll body through as a stream, untouched.
          const upstream = yield* Effect.promise(() =>
            // @effect-diagnostics-next-line globalFetchInEffect:off
            fetch(electricShapeUrl(electricUrl, params, definition), { signal: web.signal }),
          );
          return HttpServerResponse.fromWeb(
            new Response(upstream.body, {
              status: upstream.status,
              headers: privateShapeHeaders(upstream.headers),
            }),
          );
        }
        return HttpServerResponse.empty({ status: 404 });
      });

    // Only the local emulator sets this; it turns on /dev/mailbox.
    const emulatorEndpoint = yield* optional("AWS_ENDPOINT_URL");

    const { turnstileSiteKey } = yield* authConfig;
    const page = yield* Effect.cached(
      deps.page === undefined
        ? Effect.succeed(null)
        : Effect.promise(() =>
            renderPage(deps.page!, {
              providers: Object.entries({
                google: config.google,
                github: config.github,
                microsoft: config.microsoft,
                apple: config.apple,
              })
                .filter(([, credentials]) => credentials !== undefined)
                .map(([provider]) => provider),
              turnstileSiteKey: turnstileSiteKey ?? null,
              // App schemes (astrolabe://) are trusted for Better Auth, not page returns.
              returnOrigins: config.trustedOrigins.filter((origin) => /^https?:\/\//.test(origin)),
            }),
          ),
    );

    return {
      /** Serves `/api/auth/*`, `/api/workspaces/*` and, given the built pages, every other page path. */
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const { pathname } = new URL(request.url, "http://api");
        if (pathname === "/dev/mailbox" && emulatorEndpoint !== undefined) {
          return HttpServerResponse.html(
            yield* Effect.promise(() => loadMailbox(emulatorEndpoint)),
          );
        }
        const workspaceRoute = pathname.startsWith("/api/workspaces/");
        if (!pathname.startsWith("/api/auth/") && !workspaceRoute) {
          const rendered = yield* page;
          if (rendered && (request.method === "GET" || request.method === "HEAD")) {
            return HttpServerResponse.text(rendered.html, { headers: rendered.headers });
          }
          return HttpServerResponse.empty({ status: 404 });
        }
        const cors = decideCors(
          {
            method: request.method,
            origin: request.headers["origin"],
            requestedMethod: request.headers["access-control-request-method"],
          },
          corsOrigins,
        );
        if (cors.preflight) return HttpServerResponse.empty({ status: 204, headers: cors.headers });
        const response = workspaceRoute ? yield* workspaces(pathname) : yield* auth.fetch;
        return HttpServerResponse.setHeaders(response, cors.headers);
      }),
    };
  });
