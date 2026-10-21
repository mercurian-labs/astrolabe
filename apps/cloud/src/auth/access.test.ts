import { describe, expect, it } from "vite-plus/test";

import { makeAuth, ORIGIN, setAccess, signInWithCode } from "./testing.ts";

const createOrganization = (app: ReturnType<typeof makeAuth>, cookie: string, slug: string) =>
  app.post("/organization/create", { name: slug, slug }, cookie);

describe("waitlist", () => {
  it("lets only approved people create an organization, and only one", async () => {
    const app = makeAuth();
    const cookie = await signInWithCode(app, "owner@example.com");

    expect((await createOrganization(app, cookie, "first")).status).toBe(403);

    setAccess(app, "owner@example.com", "approved");
    expect((await createOrganization(app, cookie, "first")).status).toBe(200);
    expect((await createOrganization(app, cookie, "second")).status).toBe(403);
  });

  it("makes a waitlisted invitee a member, who still can't create an organization", async () => {
    const app = makeAuth();
    const owner = await signInWithCode(app, "owner@example.com");
    setAccess(app, "owner@example.com", "approved");
    const org = await createOrganization(app, owner, "acme");
    const invite = await app.post(
      "/organization/invite-member",
      { email: "guest@example.com", role: "member", organizationId: org.json.id },
      owner,
    );

    const guest = await signInWithCode(app, "guest@example.com");
    const accepted = await app.post(
      "/organization/accept-invitation",
      { invitationId: invite.json.id },
      guest,
    );
    expect(accepted.status).toBe(200);

    const session = await app.get("/get-session", guest);
    expect(session.json.user.access).toBe("member");
    expect((await createOrganization(app, guest, "guest-org")).status).toBe(403);
  });

  it("gives relay tokens only to people off the waitlist", async () => {
    const app = makeAuth();
    const cookie = await signInWithCode(app, "someone@example.com");
    expect((await app.get("/token", cookie)).status).toBe(403);

    setAccess(app, "someone@example.com", "member");
    expect((await app.get("/token", cookie)).status).toBe(200);
  });

  it("hands out relay tokens only from /token, never on session responses", async () => {
    const app = makeAuth();
    const cookie = await signInWithCode(app, "someone@example.com");
    const session = await app.get("/get-session", cookie);
    expect(session.json.user.email).toBe("someone@example.com");
    expect(session.headers.get("set-auth-jwt")).toBeNull();
  });

  it("deletes the account when someone leaves the waitlist", async () => {
    const app = makeAuth();
    const cookie = await signInWithCode(app, "leaving@example.com");
    const deleted = await app.post("/delete-user", {}, cookie);
    expect(deleted.status).toBe(200);
    expect(app.db.user).toHaveLength(0);
  });
});

describe("asking for your own organization", () => {
  it("queues a member, lets them cancel, and refuses anyone who isn't a member", async () => {
    const app = makeAuth();
    const cookie = await signInWithCode(app, "member@example.com");
    expect((await app.post("/access/request-organization", {}, cookie)).json.code).toBe(
      "NOT_A_MEMBER",
    );

    setAccess(app, "member@example.com", "member");
    expect((await app.post("/access/request-organization", {}, cookie)).status).toBe(200);
    const requested = await app.get("/get-session", cookie);
    expect(requested.json.user.orgRequestedAt).toEqual(expect.any(String));

    await app.post("/access/cancel-organization-request", {}, cookie);
    const cancelled = await app.get("/get-session", cookie);
    expect(cancelled.json.user.orgRequestedAt).toBeNull();
  });
});

describe("organization seats", () => {
  it("counts pending invitations toward owner plus four", async () => {
    const app = makeAuth();
    const owner = await signInWithCode(app, "owner@example.com");
    setAccess(app, "owner@example.com", "approved");
    const org = await createOrganization(app, owner, "acme");
    const invite = (email: string) =>
      app.post(
        "/organization/invite-member",
        { email, role: "member", organizationId: org.json.id },
        owner,
      );

    for (const n of [1, 2, 3, 4]) expect((await invite(`m${n}@example.com`)).status).toBe(200);
    const fifth = await invite("m5@example.com");
    expect(fifth.status).toBe(403);
    expect(fifth.json.code).toBe("ORGANIZATION_FULL");
  });

  it("won't make someone the owner of a second organization", async () => {
    const app = makeAuth();
    const alice = await signInWithCode(app, "alice@example.com");
    const bob = await signInWithCode(app, "bob@example.com");
    setAccess(app, "alice@example.com", "approved");
    setAccess(app, "bob@example.com", "approved");
    const acme = await createOrganization(app, alice, "acme");
    await createOrganization(app, bob, "bobco");
    const invite = await app.post(
      "/organization/invite-member",
      { email: "bob@example.com", role: "member", organizationId: acme.json.id },
      alice,
    );
    await app.post("/organization/accept-invitation", { invitationId: invite.json.id }, bob);
    const bobMember = (
      app.db.member as Array<{ id: string; role: string; organizationId: string }>
    ).find((member) => member.organizationId === acme.json.id && member.role !== "owner");

    const promoted = await app.post(
      "/organization/update-member-role",
      { memberId: bobMember?.id, role: "owner", organizationId: acme.json.id },
      alice,
    );
    expect(promoted.status).toBe(403);
    expect(promoted.json.code).toBe("ALREADY_OWNS_ORGANIZATION");
  });
});

describe("cross-origin calls", () => {
  const lan = "http://192.168.1.5:3773";

  it("lets a self-hosted page start device sign-in without a cookie", async () => {
    const app = makeAuth();
    const response = await app.auth.handler(
      new Request(`${ORIGIN}/api/auth/device/code`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: lan },
        body: JSON.stringify({ client_id: "astrolabe-web:192.168.1.5:3773" }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it("accepts device sign-in from every Astrolabe client", async () => {
    const app = makeAuth();
    for (const client_id of [
      "astrolabe-cli",
      "astrolabe-desktop",
      "astrolabe-mobile",
      "astrolabe-web:192.168.1.20:3773",
    ]) {
      const response = await app.auth.handler(
        new Request(`${ORIGIN}/api/auth/device/code`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: lan },
          body: JSON.stringify({ client_id }),
        }),
      );
      expect(response.status, client_id).toBe(200);
    }
  });

  it("refuses device sign-in from clients it doesn't know", async () => {
    const app = makeAuth();
    const response = await app.auth.handler(
      new Request(`${ORIGIN}/api/auth/device/code`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: lan },
        body: JSON.stringify({ client_id: "something-else" }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a cookie-carrying change from an origin it doesn't trust", async () => {
    const app = makeAuth();
    const cookie = await signInWithCode(app, "someone@example.com");
    const response = await app.auth.handler(
      new Request(`${ORIGIN}/api/auth/update-user`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: lan, cookie },
        body: JSON.stringify({ name: "Changed" }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
