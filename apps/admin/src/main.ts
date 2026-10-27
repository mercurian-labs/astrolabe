// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A small Node HTTP entry point and its log.
/**
 * Internal admin site. It listens on loopback, so `tailscale serve` is the only way in and
 * names the operator on every request. Env: DATABASE_URL (cloud Postgres), AUTH_URL (sign-in
 * link in approval emails), MAIL_FROM (SES sender; unset logs the mail), PORT (default 4320).
 */
import * as NodeHttp from "node:http";

import * as Mailer from "@mercurian/cloud/mail";
import { approvedMail } from "@mercurian/cloud/mail/templates";
import { makeWaitlist } from "@mercurian/cloud/waitlist";
import * as Effect from "effect/Effect";
import { Pool } from "pg";

import { makeAdminHandler } from "./handler.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const signInUrl = process.env.AUTH_URL ?? "https://app.astrolabe.sh";
const mailFrom = process.env.MAIL_FROM;
const port = Number(process.env.PORT ?? 4320);

const mailer = mailFrom === undefined ? Mailer.layerLog : Mailer.layerSes(mailFrom);
const handler = makeAdminHandler({
  waitlist: makeWaitlist(new Pool({ connectionString: databaseUrl, max: 4 })),
  sendApproval: (email) =>
    Effect.runPromise(
      Mailer.Mailer.use((service) => service.send(approvedMail(email, signInUrl))).pipe(
        Effect.provide(mailer),
      ),
    ),
  allowAnonymous: process.env.ADMIN_ALLOW_ANONYMOUS === "1",
  log: (line) => console.log(`[admin] ${line}`),
});

const server = NodeHttp.createServer((req, res) => {
  void (async () => {
    const chunks: Array<Buffer> = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    // Rebuild the address the browser used (`tailscale serve` passes it in
    // X-Forwarded-*), so the Origin check compares like with like.
    const forwarded = (name: string) => {
      const value = req.headers[name];
      return typeof value === "string" ? value : undefined;
    };
    const proto = forwarded("x-forwarded-proto") ?? "http";
    const host = forwarded("x-forwarded-host") ?? req.headers.host ?? `localhost:${port}`;
    const response = await handler(
      new Request(`${proto}://${host}${req.url ?? "/"}`, {
        method: req.method ?? "GET",
        headers,
        ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  })().catch((error: unknown) => {
    console.error("[admin] request failed", error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[admin] listening on http://127.0.0.1:${port}`);
});
