import { describe, expect, it } from "vite-plus/test";

import { makeAuth, setAccess, signInWithCode } from "./testing.ts";

const ownerWithOrganization = async (app: ReturnType<typeof makeAuth>) => {
  const owner = await signInWithCode(app, "owner@example.com");
  setAccess(app, "owner@example.com", "approved");
  const org = await app.post("/organization/create", { name: "Acme", slug: "acme" }, owner);
  return { owner, organizationId: org.json.id as string };
};

describe("account deletion", () => {
  it("refuses while you own an organization with other people in it", async () => {
    const removed: Array<string> = [];
    const app = makeAuth({ removeRelayData: async (userId) => void removed.push(userId) });
    const { owner, organizationId } = await ownerWithOrganization(app);
    const invite = await app.post(
      "/organization/invite-member",
      { email: "guest@example.com", role: "member", organizationId },
      owner,
    );
    const guest = await signInWithCode(app, "guest@example.com");
    await app.post("/organization/accept-invitation", { invitationId: invite.json.id }, guest);

    const deleted = await app.post("/delete-user", {}, owner);
    expect(deleted.status).toBe(400);
    expect(deleted.json.code).toBe("OWNS_SHARED_ORGANIZATION");
    expect(app.db.user).toHaveLength(2);
    expect(removed).toEqual([]);
  });

  it("takes an organization you're alone in, and your relay data, with the account", async () => {
    const removed: Array<string> = [];
    const app = makeAuth({ removeRelayData: async (userId) => void removed.push(userId) });
    const { owner } = await ownerWithOrganization(app);
    const [user] = app.db.user as Array<{ id: string }>;

    expect((await app.post("/delete-user", {}, owner)).status).toBe(200);
    expect(app.db.user).toHaveLength(0);
    expect(app.db.organization).toHaveLength(0);
    expect(removed).toEqual([user?.id]);
  });

  it("keeps the account when the relay can't unlink its machines", async () => {
    const app = makeAuth({
      removeRelayData: async () => {
        throw new Error("relay unavailable");
      },
    });
    const cookie = await signInWithCode(app, "someone@example.com");

    expect((await app.post("/delete-user", {}, cookie)).status).toBeGreaterThanOrEqual(500);
    expect(app.db.user).toHaveLength(1);
  });
});
