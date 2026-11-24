import type {
  InvitationRow,
  MemberRow,
  TeamRow,
  WorkspaceRow,
} from "@t3tools/shared/mercurianWorkspaces";
import { describe, expect, it } from "vite-plus/test";

import {
  buildWorkspaceViews,
  invitationsForYou,
  selectedWorkspace,
  slugFor,
  workspaceColor,
  workspaceInitials,
  workspaceMemberships,
  type WorkspaceRows,
} from "./model.ts";

const workspace = (id: string, name: string): WorkspaceRow => ({
  id,
  name,
  slug: id,
  logo: null,
  created_at: "2026-10-16",
  invite_policy: null,
  team_creation_policy: null,
});
const member = (id: string, org: string, user: string, role: MemberRow["role"]): MemberRow => ({
  id,
  organization_id: org,
  user_id: user,
  role,
  created_at: "2026-10-16",
});
const team = (id: string, org: string, name: string): TeamRow => ({
  id,
  name,
  organization_id: org,
  created_at: "2026-10-16",
});
const invitation = (
  id: string,
  org: string,
  email: string,
  status: InvitationRow["status"] = "pending",
): InvitationRow => ({
  id,
  organization_id: org,
  email,
  role: "member",
  status,
  team_id: null,
  inviter_id: "owner",
  expires_at: "2026-10-30",
  created_at: "2026-10-16",
});

const rows = (overrides: Partial<WorkspaceRows>): WorkspaceRows => ({
  workspaces: [],
  members: [],
  people: [],
  teams: [],
  teamMembers: [],
  teamOwners: [],
  invitations: [],
  ...overrides,
});

describe("workspace views", () => {
  it("lists only workspaces you belong to, and gives admins every team to manage", () => {
    const views = buildWorkspaceViews(
      rows({
        workspaces: [workspace("a", "Acme"), workspace("b", "Invited only")],
        members: [member("m1", "a", "me", "admin"), member("m2", "a", "them", "member")],
        teams: [team("t1", "a", "Design")],
      }),
      "me",
    );
    expect(views.map((view) => view.workspace.name)).toEqual(["Acme"]);
    expect(views[0]!.teams[0]!.manageable).toBe(true);
    expect(views[0]!.teams[0]!.joined).toBe(false);
  });

  it("lets a member manage only the teams they own", () => {
    const views = buildWorkspaceViews(
      rows({
        workspaces: [workspace("a", "Acme")],
        members: [member("m1", "a", "me", "member")],
        teams: [team("t1", "a", "Design"), team("t2", "a", "Infra")],
        teamMembers: [{ id: "tm1", team_id: "t1", user_id: "me" }],
        teamOwners: [{ id: "o1", team_member_id: "tm1", team_id: "t1", user_id: "me" }],
      }),
      "me",
    );
    const [design, infra] = views[0]!.teams;
    expect(design!.manageable && design!.joined).toBe(true);
    expect(infra!.manageable || infra!.joined).toBe(false);
  });

  it("orders people owner first, then admins, then members", () => {
    const view = buildWorkspaceViews(
      rows({
        workspaces: [workspace("a", "Acme")],
        members: [
          member("m1", "a", "me", "member"),
          member("m2", "a", "boss", "owner"),
          member("m3", "a", "lead", "admin"),
        ],
      }),
      "me",
    )[0]!;
    expect(view.people.map((person) => person.member.role)).toEqual(["owner", "admin", "member"]);
  });
});

describe("invitations for you", () => {
  it("shows pending invitations to your address for workspaces you haven't joined", () => {
    const found = invitationsForYou(
      rows({
        workspaces: [workspace("a", "Acme"), workspace("b", "Beta")],
        members: [member("m1", "b", "me", "member")],
        invitations: [
          invitation("i1", "a", "Me@Example.com"),
          invitation("i2", "b", "me@example.com"),
          invitation("i3", "a", "me@example.com", "canceled"),
          invitation("i4", "a", "someone@example.com"),
        ],
      }),
      "me",
      "me@example.com",
    );
    expect(found.map((item) => item.invitation.id)).toEqual(["i1"]);
    expect(found[0]!.workspace?.name).toBe("Acme");
  });
});

describe("workspace short names", () => {
  it("makes a URL-safe slug from any name", () => {
    expect(slugFor("  Acme & Co. Design ")).toBe("acme-co-design");
    expect(slugFor("Café Ünited")).toBe("cafe-united");
    expect(slugFor("!!!")).toBe("workspace");
  });
});

describe("the selected workspace", () => {
  const synced = rows({
    workspaces: [workspace("b", "Beta"), workspace("a", "Acme"), workspace("c", "Invited only")],
    members: [
      member("m1", "a", "me", "owner"),
      member("m2", "b", "me", "member"),
      member("m3", "c", "them", "owner"),
    ],
  });
  const memberships = workspaceMemberships(synced, "me");

  it("offers the workspaces you belong to, by name, with your role", () => {
    expect(memberships.map(({ workspace, myRole }) => [workspace.name, myRole])).toEqual([
      ["Acme", "owner"],
      ["Beta", "member"],
    ]);
  });

  it("is the saved one while you still belong to it", () => {
    expect(selectedWorkspace(memberships, "b")?.workspace.name).toBe("Beta");
  });

  it("is none when nothing was saved", () => {
    expect(selectedWorkspace(memberships, null)).toBeNull();
  });

  it("falls back to none once you leave the saved one or it is deleted", () => {
    const afterLeaving = workspaceMemberships(
      { workspaces: synced.workspaces, members: synced.members.filter((m) => m.id !== "m2") },
      "me",
    );
    expect(selectedWorkspace(afterLeaving, "b")).toBeNull();
    const afterDeletion = workspaceMemberships(
      { workspaces: synced.workspaces.filter((w) => w.id !== "b"), members: synced.members },
      "me",
    );
    expect(selectedWorkspace(afterDeletion, "b")).toBeNull();
  });

  it("never selects a workspace you were only invited to", () => {
    expect(selectedWorkspace(memberships, "c")).toBeNull();
  });
});

describe("workspace tiles", () => {
  it("shows the first and last words' initials", () => {
    expect(workspaceInitials("Acme design co")).toBe("AC");
    expect(workspaceInitials("acme")).toBe("A");
    expect(workspaceInitials("  Ünited  ")).toBe("Ü");
    expect(workspaceInitials("!!!")).toBe("W");
  });

  it("colours a workspace by its id, the same every time and never gray", () => {
    const ids = Array.from({ length: 50 }, (_, index) => `org_${index}`);
    expect(ids.map(workspaceColor)).toEqual(ids.map(workspaceColor));
    expect(ids.map(workspaceColor)).not.toContain("gray");
    expect(new Set(ids.map(workspaceColor)).size).toBeGreaterThan(5);
  });
});
