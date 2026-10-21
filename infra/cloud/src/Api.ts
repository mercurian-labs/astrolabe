// @effect-diagnostics anyUnknownInErrorContext:off - Alchemy runtimes expose framework-owned any requirements.
/**
 * The cloud API as an Alchemy-hosted ECS service: Alchemy bundles this file
 * with its own startup code, which serves `fetch` and supplies bindings.
 * ECS hosting only ships Bun startup code today, so the image is Bun; keep
 * the code to Effect and Node APIs (tests run on Node) so it can move to
 * Node once Alchemy supports it.
 *
 * Astrolabe sign-in (`/api/auth/*`) comes from apps/cloud; `/health`
 * proves the API reaches Postgres and Electric.
 */
import { makeCloudApp } from "@mercurian/cloud/app";
import * as AWS from "alchemy/AWS";
import * as Drizzle from "alchemy/Drizzle/Postgres";
import * as Output from "alchemy/Output";
import { ALCHEMY_PHASE } from "alchemy/Phase";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import {
  ApiIngress,
  ARM64,
  Cluster,
  DatabaseUrl,
  Electric,
  MailIdentity,
  Migrations,
} from "./resources.ts";

export class Api extends AWS.ECS.Service<Api>()("Api") {}

export default Api.make(
  Effect.gen(function* () {
    const electric = yield* Electric;
    const mail = yield* MailIdentity;
    const ingress = yield* ApiIngress;
    return {
      cluster: yield* Cluster,
      main: import.meta.url,
      image: "oven/bun:1.3",
      port: 4310,
      desiredCount: 1,
      runtimePlatform: ARM64,
      loadBalancer: {
        listener: ingress.listener,
        health: { "4310/http": { path: "/health" } },
      },
      env: {
        DATABASE_URL: yield* DatabaseUrl,
        ELECTRIC_URL: electric.url,
        MAIL_FROM: Output.map(mail.emailIdentity, (address) => `Astrolabe <${address}>`),
        AUTH_URL: ingress.url,
        AUTH_TRUSTED_ORIGINS: ingress.url,
        // The local relay (infra/relay `vp run dev`); relay tokens name it as audience.
        RELAY_URL: "http://localhost:8787",
        // Starts only after migrations succeed.
        MIGRATED: yield* Migrations,
      },
    };
  }),
  Effect.gen(function* () {
    const sendEmail = yield* AWS.SES.SendEmail(yield* MailIdentity);
    // Read once at startup; at plan time the container's environment isn't there.
    const mailFrom =
      (yield* ALCHEMY_PHASE) === "runtime"
        ? yield* Config.String("MAIL_FROM").pipe(Effect.orDie)
        : "";
    const app = yield* makeCloudApp({
      sendMail: (mail) =>
        Effect.gen(function* () {
          yield* sendEmail({
            FromEmailAddress: mailFrom,
            Destination: { ToAddresses: [mail.to] },
            Content: {
              Simple: { Subject: { Data: mail.subject }, Body: { Text: { Data: mail.text } } },
            },
          });
        }),
    });

    // Connects on first query, so construction at plan time never dials out.
    const db = yield* Drizzle.Postgres(
      Effect.gen(function* () {
        return yield* Config.Redacted("DATABASE_URL");
      }),
    );

    const health = Effect.gen(function* () {
      const tables = yield* db.$client.unsafe<{ count: string }>(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
      );
      const electricUrl = yield* Config.String("ELECTRIC_URL");
      const electric = yield* HttpClient.get(new URL("/v1/health", electricUrl));
      return yield* HttpServerResponse.json({
        runtime: "Bun" in globalThis ? "bun" : "node",
        database: { tables: Number(tables[0]?.count ?? 0) },
        electric: { status: electric.status, body: yield* electric.json },
      });
    });

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        if (new URL(request.url, "http://api").pathname !== "/health") return yield* app.fetch;
        return yield* health.pipe(
          Effect.catchCause((cause) =>
            HttpServerResponse.text(String(cause), { status: 503 }).pipe(Effect.succeed),
          ),
        );
      }),
    };
  }).pipe(Effect.provide(AWS.SES.SendEmailHttp)),
);
