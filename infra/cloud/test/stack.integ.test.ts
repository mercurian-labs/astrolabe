// @effect-diagnostics globalFetchInEffect:off globalDateInEffect:off globalTimers:off anyUnknownInErrorContext:off - The suite drives the deployed stack over HTTP like a client would.
/**
 * The cloud stack as it runs locally: Postgres, Electric and the Bun API under
 * Alchemy's AWS emulator, deployed from `alchemy.run.ts` into its own stage
 * and destroyed afterwards. Run with `vp run test:integration` (needs Docker),
 * which builds what `alchemy dev` would, runs this file, and cleans the stage up.
 */
import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Docker from "alchemy/Docker";
import * as Test from "alchemy/Test/Vitest";
import { PgClient } from "@effect/sql-pg";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import { expect } from "vite-plus/test";

import Stack from "../alchemy.run.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Layer.mergeAll(AWS.providers(), Docker.providers()),
  state: Alchemy.localState(),
  dev: true,
  stage: "it",
});

// Deploys, then waits until the stack answers quiet live requests. The person
// it signs in is reused: Better Auth limits how many codes one address sends.
const stack = beforeAll(
  Effect.gen(function* () {
    const apiUrl = apiOf(yield* deploy(Stack));
    return { apiUrl, quietToken: yield* settled(apiUrl) };
  }),
  { timeout: 900_000 },
);
// test/integration.sh sets NO_DESTROY and tears the stage down itself: at the
// end of the file this destroy can't reach the harness's sidecar (it waits out
// a 300s headers timeout and leaves the stage up). Without the sidecar
// (`sidecar: false`) the dev session ends with beforeAll and destroys the
// stage mid-suite.
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack), { timeout: 600_000 });

const postgresUrl = `postgresql://mercurian:mercurian@localhost:${process.env.CLOUD_POSTGRES_PORT}/mercurian_cloud`;
const sql = <A>(run: (client: PgClient.PgClient) => Effect.Effect<A, unknown>) =>
  Effect.flatMap(PgClient.PgClient, run).pipe(
    Effect.provide(PgClient.layer({ url: Redacted.make(postgresUrl) })),
  );

const call = (api: string, path: string, init: RequestInit & { token?: string } = {}) =>
  Effect.promise(async () => {
    const headers = new Headers(init.headers);
    headers.set("origin", api);
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    return fetch(`${api}${path}`, { ...init, headers });
  });

/** Signs in with an emailed code, read back from the stack's dev mailbox, and returns a bearer token. */
const signIn = (api: string, email: string) =>
  Effect.gen(function* () {
    const sent = yield* call(api, "/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      body: JSON.stringify({ email, type: "sign-in" }),
    });
    expect(sent.status).toBe(200);
    const code = yield* Effect.promise(async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const html = await (await fetch(`${api}/dev/mailbox`)).text();
        const mine = html.split("<article>").find((article) => article.includes(email));
        const match = mine?.match(/(\d{6}) is your Astrolabe sign-in code/);
        if (match) return match[1]!;
        // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- polls the deployed stack's dev mailbox over HTTP; nothing tells the test when the mail lands.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`no sign-in code reached ${email}`);
    });
    const signedIn = yield* call(api, "/api/auth/sign-in/email-otp", {
      method: "POST",
      body: JSON.stringify({ email, otp: code }),
    });
    expect(signedIn.status).toBe(200);
    const token = signedIn.headers.get("set-auth-token");
    expect(token).toBeTruthy();
    return token!;
  });

const write = (api: string, token: string, name: string, input: unknown) =>
  Effect.gen(function* () {
    const response = yield* call(api, "/api/workspaces/write", {
      method: "POST",
      token,
      body: JSON.stringify({ write: name, input }),
    });
    const body = (yield* Effect.promise(() => response.json())) as { result?: any; code?: string };
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body.result;
  });

/** A shape read the way Electric's client does: catch up until up-to-date, keeping the rows. */
const readShape = (api: string, token: string, shape: string) =>
  Effect.gen(function* () {
    // Keyed like Electric's client: a row can arrive in the snapshot and again in the log.
    const rows = new Map<string, unknown>();
    let query = "offset=-1";
    for (let page = 0; page < 20; page++) {
      const response = yield* call(api, `/api/workspaces/shape?shape=${shape}&${query}`, { token });
      expect(response.status).toBe(200);
      const messages = (yield* Effect.promise(() => response.json())) as Array<{
        key?: string;
        value?: unknown;
        headers?: { control?: string; operation?: string };
      }>;
      for (const message of messages) {
        if (message.key === undefined) continue;
        if (message.headers?.operation === "delete") rows.delete(message.key);
        else
          rows.set(message.key, {
            ...(rows.get(message.key) as object),
            ...(message.value as object),
          });
      }
      const handle = response.headers.get("electric-handle")!;
      const offset = response.headers.get("electric-offset")!;
      if (messages.some((message) => message.headers?.control === "up-to-date")) {
        return {
          rows: [...rows.values()],
          handle,
          offset,
          cursor: response.headers.get("electric-cursor") ?? "",
        };
      }
      query = `handle=${handle}&offset=${offset}`;
    }
    throw new Error(`${shape} never caught up`);
  });

/** Reads until the shape holds `count` rows; changes reach Electric a moment after the write. */
const eventuallyRows = (api: string, token: string, shape: string, count: number) =>
  Effect.gen(function* () {
    let rows: Array<unknown> = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      rows = (yield* readShape(api, token, shape)).rows;
      if (rows.length === count) return rows;
      // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- the deployed Electric replicates a moment after the write; nothing the test can await marks it.
      yield* Effect.sleep("500 millis");
    }
    return rows;
  });

/** Keeps each run's addresses and slugs apart; Better Auth limits codes sent to one address. */
const uniqueSuffix = Random.nextIntBetween(0, 2 ** 40).pipe(
  Effect.map((value) => value.toString(36)),
);

const apiOf = (outputs: { readonly apiUrl?: string | undefined }) => {
  if (!outputs.apiUrl) throw new Error("the stack reported no API URL");
  return outputs.apiUrl;
};

/** A quiet live request through the API, answered after Electric's long-poll timeout. */
const quietLiveRequest = (api: string, token: string) =>
  Effect.gen(function* () {
    const { handle, offset, cursor } = yield* readShape(api, token, "workspaces");
    // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- how long the deployed stack holds a live request is what the suite checks.
    const started = Date.now();
    const live = yield* call(
      api,
      `/api/workspaces/shape?shape=workspaces&live=true&handle=${handle}&offset=${offset}&cursor=${cursor}`,
      { token },
    );
    // oxlint-disable-next-line t3code/no-wall-clock-in-tests -- the end of the hold measured above.
    return { status: live.status, waited: Date.now() - started };
  });

/**
 * Waits out the first minute after a deploy, when the emulator's load balancer
 * still drops held requests (502 after a few seconds) while it settles its
 * targets; minutes later the same request is answered. A real idle-timeout
 * fault never settles, so this times out and fails the suite.
 */
const settled = (api: string) =>
  Effect.gen(function* () {
    const token = yield* signIn(api, `settle-${yield* uniqueSuffix}@it.test`);
    for (let attempt = 0; attempt < 10; attempt++) {
      if ((yield* quietLiveRequest(api, token)).status === 200) return token;
    }
    throw new Error("quiet live requests never got through after the deploy");
  });

test(
  "the API reaches its database and Electric",
  Effect.gen(function* () {
    const { apiUrl } = yield* stack;
    const health = yield* call(apiUrl, "/health");
    const body = (yield* Effect.promise(() => health.json())) as any;
    expect(body.runtime).toBe("bun");
    expect(body.electric.body.status).toBe("active");
  }),
);

test(
  "a workspace reaches only the people in it",
  Effect.gen(function* () {
    const { apiUrl } = yield* stack;
    const run = yield* uniqueSuffix;
    const ada = `ada-${run}@it.test`;
    const bo = `bo-${run}@it.test`;
    const adaToken = yield* signIn(apiUrl, ada);
    const boToken = yield* signIn(apiUrl, bo);
    yield* sql((client) => client`UPDATE auth.user SET access = 'approved' WHERE email = ${ada}`);

    const created = yield* write(apiUrl, adaToken, "createWorkspace", {
      name: "Integration",
      slug: `integration-${run}`,
    });
    expect(yield* eventuallyRows(apiUrl, adaToken, "workspaces", 1)).toHaveLength(1);
    expect((yield* readShape(apiUrl, boToken, "workspaces")).rows).toHaveLength(0);

    const invitation = yield* write(apiUrl, adaToken, "invite", {
      organizationId: created.id,
      email: bo,
      role: "member",
    });
    yield* write(apiUrl, boToken, "acceptInvitation", { invitationId: invitation.id });
    expect(yield* eventuallyRows(apiUrl, boToken, "workspaces", 1)).toHaveLength(1);
  }),
);

test(
  "a quiet live request outlasts the API server's idle timeout",
  Effect.gen(function* () {
    const { apiUrl, quietToken } = yield* stack;
    const { status, waited } = yield* quietLiveRequest(apiUrl, quietToken);
    // Electric answers an idle live request after its long-poll timeout. Bun
    // drops requests idle for 10s, so a 502 here means the two disagree.
    expect(status, `after ${waited}ms`).toBe(200);
    expect(waited).toBeGreaterThan(5_000);
  }),
);
