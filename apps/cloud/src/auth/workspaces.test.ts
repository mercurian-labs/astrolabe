import { describe, expect, it } from "vite-plus/test";

import { makeAuth, setAccess, signInWithCode } from "./testing.ts";

type App = ReturnType<typeof makeAuth>;

/** An approved owner's workspace, with each named person invited and accepted. */
const workspace = async (app: App, people: Array<{ email: string; role?: string }> = []) => {
  const owner = await signInWithCode(app, "owner@example.com");
  setAccess(app, "owner@example.com", "approved");
  const created = await app.post("/organization/create", { name: "Acme", slug: "acme" }, owner);
  const organizationId = created.json.id as string;
  const cookies: Record<string, string> = {};
  for (const { email, role = "member" } of people) {
    const invite = await app.post(
      "/organization/invite-member",
      { email, role, organizationId },
      owner,
    );
    cookies[email] = await signInWithCode(app, email);
    await app.post(
      "/organization/accept-invitation",
      { invitationId: invite.json.id },
      cookies[email],
    );
  }
  return { owner, organizationId, cookies };
};

const userId = (app: App, email: string) =>
  (app.db.user as Array<{ id: string; email: string }>).find((user) => user.email === email)!.id;

const memberId = (app: App, email: string) =>
  (app.db.member as Array<{ id: string; userId: string }>).find(
    (member) => member.userId === userId(app, email),
  )!.id;

const teamOwners = (app: App, teamId: string) =>
  (app.db.teamOwner as Array<{ teamId: string; userId: string }>)
    .filter((row) => row.teamId === teamId)
    .map((row) => row.userId);

const createTeam = (app: App, cookie: string, organizationId: string, name: string) =>
  app.post("/organization/create-team", { name, organizationId }, cookie);

describe("workspace roles", () => {
  it("makes the creator of a workspace the owner of its first team", async () => {
    const app = makeAuth();
    await workspace(app);
    const [team] = app.db.team as Array<{ id: string; name: string }>;
    expect(team!.name).toBe("Acme");
    expect(teamOwners(app, team!.id)).toEqual([userId(app, "owner@example.com")]);
  });

  it("lets only the owner and admins invite, until the workspace opens invitations to members", async () => {
    const app = makeAuth();
    const { owner, organizationId, cookies } = await workspace(app, [
      { email: "member@example.com" },
    ]);
    const member = cookies["member@example.com"]!;
    const invite = (role: string, email: string) =>
      app.post("/organization/invite-member", { email, role, organizationId }, member);

    expect((await invite("member", "new@example.com")).json.code).toBe("INVITES_ADMINS_ONLY");

    await app.post(
      "/organization/update",
      { organizationId, data: { invitePolicy: "members" } },
      owner,
    );
    expect((await invite("member", "new@example.com")).status).toBe(200);
    expect((await invite("admin", "other@example.com")).json.code).toBe("MEMBERS_INVITE_MEMBERS");
  });

  it("never invites anyone as owner", async () => {
    const app = makeAuth();
    const { owner, organizationId } = await workspace(app);
    const invite = await app.post(
      "/organization/invite-member",
      { email: "new@example.com", role: "owner", organizationId },
      owner,
    );
    expect(invite.json.code).toBe("OWNER_NOT_INVITED");
  });

  it("lets members create teams, which they then own, until the workspace limits it to admins", async () => {
    const app = makeAuth();
    const { owner, organizationId, cookies } = await workspace(app, [
      { email: "member@example.com" },
    ]);
    const member = cookies["member@example.com"]!;

    const design = await createTeam(app, member, organizationId, "Design");
    expect(design.status).toBe(200);
    expect(teamOwners(app, design.json.id)).toEqual([userId(app, "member@example.com")]);

    await app.post(
      "/organization/update",
      { organizationId, data: { teamCreationPolicy: "admins" } },
      owner,
    );
    expect((await createTeam(app, member, organizationId, "Infra")).json.code).toBe(
      "TEAMS_ADMINS_ONLY",
    );
    expect((await createTeam(app, owner, organizationId, "Infra")).status).toBe(200);
  });

  it("lets a team's owners, and the workspace's owner and admins, rename and delete it", async () => {
    const app = makeAuth();
    const { owner, organizationId, cookies } = await workspace(app, [
      { email: "creator@example.com" },
      { email: "other@example.com" },
      { email: "admin@example.com", role: "admin" },
    ]);
    const team = await createTeam(app, cookies["creator@example.com"]!, organizationId, "Design");
    const rename = (cookie: string, name: string) =>
      app.post("/organization/update-team", { teamId: team.json.id, data: { name } }, cookie);

    expect((await rename(cookies["other@example.com"]!, "Nope")).json.code).toBe("NOT_TEAM_OWNER");
    expect((await rename(cookies["creator@example.com"]!, "Design 2")).status).toBe(200);
    expect((await rename(cookies["admin@example.com"]!, "Design 3")).status).toBe(200);

    const remove = (cookie: string) =>
      app.post("/organization/remove-team", { teamId: team.json.id, organizationId }, cookie);
    expect((await remove(cookies["other@example.com"]!)).json.code).toBe("NOT_TEAM_OWNER");
    expect((await remove(owner)).status).toBe(200);
  });

  it("lets team owners name other owners from the team, and nobody else", async () => {
    const app = makeAuth();
    const { organizationId, cookies } = await workspace(app, [
      { email: "creator@example.com" },
      { email: "other@example.com" },
    ]);
    const creator = cookies["creator@example.com"]!;
    const other = cookies["other@example.com"]!;
    const team = await createTeam(app, creator, organizationId, "Design");
    const setOwner = (cookie: string, email: string, owner: boolean) =>
      app.post(
        "/workspace/set-team-owner",
        { teamId: team.json.id, userId: userId(app, email), owner },
        cookie,
      );

    expect((await setOwner(creator, "other@example.com", true)).json.code).toBe("NOT_ON_TEAM");
    await app.post("/workspace/join-team", { teamId: team.json.id }, other);
    expect((await setOwner(other, "other@example.com", true)).json.code).toBe("NOT_TEAM_OWNER");
    expect((await setOwner(creator, "other@example.com", true)).status).toBe(200);
    expect(teamOwners(app, team.json.id)).toHaveLength(2);
    expect((await setOwner(other, "creator@example.com", false)).status).toBe(200);
    expect(teamOwners(app, team.json.id)).toEqual([userId(app, "other@example.com")]);
  });

  it("lets members join and leave teams themselves, and leaving ends ownership", async () => {
    const app = makeAuth();
    const { organizationId, cookies } = await workspace(app, [{ email: "member@example.com" }]);
    const member = cookies["member@example.com"]!;
    const team = await createTeam(app, member, organizationId, "Design");
    const memberships = () =>
      (app.db.teamMember as Array<{ teamId: string }>).filter((row) => row.teamId === team.json.id);

    expect(memberships()).toHaveLength(1);
    await app.post("/workspace/leave-team", { teamId: team.json.id }, member);
    expect(memberships()).toHaveLength(0);
    // The memory adapter has no cascades; Postgres removes ownership with the membership.
    await app.post("/workspace/join-team", { teamId: team.json.id }, member);
    expect(memberships()).toHaveLength(1);

    const outsider = await signInWithCode(app, "outsider@example.com");
    const joined = await app.post("/workspace/join-team", { teamId: team.json.id }, outsider);
    expect(joined.json.code).toBe("NOT_A_MEMBER");
  });
});

describe("workspace ownership", () => {
  it("never demotes or removes the owner, and never promotes anyone to owner", async () => {
    const app = makeAuth();
    const { owner, organizationId, cookies } = await workspace(app, [
      { email: "admin@example.com", role: "admin" },
    ]);
    const admin = cookies["admin@example.com"]!;

    const demote = await app.post(
      "/organization/update-member-role",
      { memberId: memberId(app, "owner@example.com"), role: "admin", organizationId },
      admin,
    );
    // The plugin refuses an admin touching the owner before our rule runs.
    expect(demote.status).toBe(403);
    const promote = await app.post(
      "/organization/update-member-role",
      { memberId: memberId(app, "admin@example.com"), role: "owner", organizationId },
      owner,
    );
    expect(promote.json.code).toBe("TRANSFER_OWNERSHIP");
    const remove = await app.post(
      "/organization/remove-member",
      { memberIdOrEmail: "owner@example.com", organizationId },
      admin,
    );
    expect(remove.status).not.toBe(200);
    expect(memberId(app, "owner@example.com")).toBeDefined();
  });

  it("hands the workspace over, making the former owner an admin", async () => {
    const app = makeAuth();
    const { owner, organizationId, cookies } = await workspace(app, [
      { email: "next@example.com" },
    ]);
    const transfer = (cookie: string) =>
      app.post(
        "/workspace/transfer-ownership",
        { organizationId, userId: userId(app, "next@example.com") },
        cookie,
      );

    expect((await transfer(cookies["next@example.com"]!)).json.code).toBe("NOT_OWNER");
    expect((await transfer(owner)).status).toBe(200);
    const roles = Object.fromEntries(
      (app.db.member as Array<{ userId: string; role: string }>).map((m) => [m.userId, m.role]),
    );
    expect(roles[userId(app, "next@example.com")]).toBe("owner");
    expect(roles[userId(app, "owner@example.com")]).toBe("admin");
  });

  it("won't hand a workspace to someone who already owns one", async () => {
    const app = makeAuth();
    const { owner, organizationId, cookies } = await workspace(app, [
      { email: "next@example.com" },
    ]);
    setAccess(app, "next@example.com", "approved");
    await app.post(
      "/organization/create",
      { name: "Theirs", slug: "theirs" },
      cookies["next@example.com"]!,
    );
    const transfer = await app.post(
      "/workspace/transfer-ownership",
      { organizationId, userId: userId(app, "next@example.com") },
      owner,
    );
    expect(transfer.json.code).toBe("ALREADY_OWNS_ORGANIZATION");
  });
});
