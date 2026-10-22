// @effect-diagnostics nodeBuiltinImport:off - The test reads the migration files directly, as the migration task does.
import * as NodeFS from "node:fs";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { authOptions } from "../auth/options.ts";
import * as schema from "../auth/schema.ts";
import type { Mail } from "../mail/Mailer.ts";
import { makeWorkspaceWriter, type WorkspaceApi } from "./writes.ts";

// A real Postgres in-process, migrated as production is, so txids and
// rollbacks are Postgres's own.
const client = new PGlite();
const db = drizzle({ client, relations: schema.authRelations });
const mail: Array<Mail> = [];
const options = {
  ...authOptions(
    {
      baseUrl: "http://localhost:4399",
      trustedOrigins: ["http://localhost:4399"],
      passkeyRpId: "localhost",
      ipAddressHeaders: ["x-forwarded-for"],
      turnstileSecret: undefined,
      relayUrl: "http://localhost:8787",
      google: undefined,
      github: undefined,
      microsoft: undefined,
      apple: undefined,
    },
    { sendMail: async (message) => void mail.push(message), removeRelayData: async () => {} },
  ),
  database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
  secret: "test-secret-that-is-at-least-32-characters",
  rateLimit: { enabled: false },
};
const auth = betterAuth(options);
const write = makeWorkspaceWriter({
  db: db as never,
  api: auth.api as unknown as WorkspaceApi,
  authOptions: options,
});

const migrate = async () => {
  const root = new URL("../../migrations/auth/", import.meta.url);
  for (const folder of NodeFS.readdirSync(root).sort()) {
    await client.exec(NodeFS.readFileSync(new URL(`${folder}/migration.sql`, root), "utf8"));
  }
};

/** An approved, verified person with a bearer session. */
const person = async (email: string) => {
  const id = email.split("@")[0]!;
  await client.query(
    `INSERT INTO auth.user (id, name, email, email_verified, access, updated_at)
     VALUES ($1, $1, $2, true, 'approved', now())`,
    [id, email],
  );
  const session = await (await auth.$context).internalAdapter.createSession(id);
  return { id, headers: new Headers({ authorization: `Bearer ${session.token}` }) };
};

const xminOf = async (table: string, id: string) =>
  (await client.query<{ xmin: string }>(`SELECT xmin::text FROM auth.${table} WHERE id = $1`, [id]))
    .rows[0]?.xmin;

beforeAll(migrate);
afterAll(() => client.close());

describe("workspace writes", () => {
  it("returns the txid of the transaction that made the change", async () => {
    const owner = await person("owner@example.com");
    const created = await write(owner.headers, {
      write: "createWorkspace",
      input: { name: "Acme", slug: "acme" },
    });
    expect(created.status).toBe(200);
    const body = created.body as { txid: number; result: { id: string } };
    expect(body.txid).toBeTypeOf("number");
    expect(await xminOf("organization", body.result.id)).toBe(String(body.txid));
  });

  it("refuses with the rule's code, and leaves nothing behind", async () => {
    const owner = await person("owner2@example.com");
    const created = await write(owner.headers, {
      write: "createWorkspace",
      input: { name: "Beta", slug: "beta" },
    });
    const organizationId = (created.body as { result: { id: string } }).result.id;
    const outsider = await person("outsider@example.com");
    const refused = await write(outsider.headers, {
      write: "createTeam",
      input: { organizationId, name: "Sneaky" },
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const teams = await client.query(`SELECT 1 FROM auth.team WHERE name = 'Sneaky'`);
    expect(teams.rows).toHaveLength(0);
  });

  it("has no txid when nothing changed, so clients don't wait for one", async () => {
    const someone = await person("someone@example.com");
    const left = await write(someone.headers, {
      write: "leaveTeam",
      input: { teamId: "not-a-team-of-theirs" },
    });
    expect(left).toEqual({
      status: 200,
      body: { txid: null, result: { teamId: "not-a-team-of-theirs" } },
    });
  });

  it("sends an invitation's email once it commits", async () => {
    const owner = await person("owner3@example.com");
    const created = await write(owner.headers, {
      write: "createWorkspace",
      input: { name: "Gamma", slug: "gamma" },
    });
    const organizationId = (created.body as { result: { id: string } }).result.id;
    const before = mail.length;
    const invited = await write(owner.headers, {
      write: "invite",
      input: { organizationId, email: "new@example.com", role: "member" },
    });
    expect(invited.status).toBe(200);
    expect(mail.slice(before).map((message) => message.to)).toEqual(["new@example.com"]);
  });

  it("renames a team in the named workspace, whatever the session's active one", async () => {
    // These sessions have no active organization, as a client switching
    // between workspaces may not.
    const owner = await person("owner4@example.com");
    const created = await write(owner.headers, {
      write: "createWorkspace",
      input: { name: "Delta", slug: "delta" },
    });
    const organizationId = (created.body as { result: { id: string } }).result.id;
    const team = (
      await client.query<{ id: string }>(`SELECT id FROM auth.team WHERE organization_id = $1`, [
        organizationId,
      ])
    ).rows[0]!;
    await client.query(`UPDATE auth.session SET active_organization_id = NULL`);
    const renamed = await write(owner.headers, {
      write: "renameTeam",
      input: { organizationId, teamId: team.id, name: "Delta Design" },
    });
    expect(renamed.status).toBe(200);
    const names = await client.query<{ name: string }>(`SELECT name FROM auth.team WHERE id = $1`, [
      team.id,
    ]);
    expect(names.rows[0]!.name).toBe("Delta Design");
  });

  it("refuses unknown writes and malformed input before touching the database", async () => {
    const someone = await person("someone2@example.com");
    expect((await write(someone.headers, { write: "dropTables", input: {} })).status).toBe(400);
    expect((await write(someone.headers, { write: "createTeam", input: {} })).status).toBe(400);
  });
});
