import {
  administers,
  type InvitationRow,
  type MemberRow,
  type PersonRow,
  type TeamMemberRow,
  type TeamOwnerRow,
  type TeamRow,
  type WorkspaceRole,
  type WorkspaceRow,
} from "@t3tools/shared/mercurianWorkspaces";

/** Everything the cloud has synced to this device for the signed-in person. */
export interface WorkspaceRows {
  readonly workspaces: ReadonlyArray<WorkspaceRow>;
  readonly members: ReadonlyArray<MemberRow>;
  readonly people: ReadonlyArray<PersonRow>;
  readonly teams: ReadonlyArray<TeamRow>;
  readonly teamMembers: ReadonlyArray<TeamMemberRow>;
  readonly teamOwners: ReadonlyArray<TeamOwnerRow>;
  readonly invitations: ReadonlyArray<InvitationRow>;
}

export interface WorkspacePerson {
  readonly member: MemberRow;
  readonly person: PersonRow | undefined;
}

export interface WorkspaceTeam {
  readonly team: TeamRow;
  /** The people on the team, by user id. */
  readonly memberIds: ReadonlyArray<string>;
  /** Named owners; the workspace's owner and admins own every team without being named. */
  readonly ownerIds: ReadonlyArray<string>;
  readonly joined: boolean;
  /** Whether the signed-in person can rename or delete it and name its owners. */
  readonly manageable: boolean;
}

export interface WorkspaceView {
  readonly workspace: WorkspaceRow;
  readonly myRole: WorkspaceRole;
  readonly myMemberId: string;
  readonly people: ReadonlyArray<WorkspacePerson>;
  readonly teams: ReadonlyArray<WorkspaceTeam>;
  readonly pendingInvitations: ReadonlyArray<InvitationRow>;
}

const ROLE_ORDER: Readonly<Record<WorkspaceRole, number>> = { owner: 0, admin: 1, member: 2 };

// Hermes, on mobile, has no change-by-copy array methods (toSorted); sort copies.
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The workspaces the signed-in person belongs to, each with its people, teams and pending invitations. */
export function buildWorkspaceViews(rows: WorkspaceRows, userId: string): Array<WorkspaceView> {
  const people = new Map(rows.people.map((person) => [person.id, person]));
  return rows.workspaces
    .flatMap((workspace) => {
      const members = rows.members.filter((member) => member.organization_id === workspace.id);
      const mine = members.find((member) => member.user_id === userId);
      if (mine === undefined) return [];
      const ownsEveryTeam = administers(mine.role);
      const teams = rows.teams
        .filter((team) => team.organization_id === workspace.id)
        .slice()
        .sort(byName)
        .map((team): WorkspaceTeam => {
          const memberIds = rows.teamMembers
            .filter((row) => row.team_id === team.id)
            .map((row) => row.user_id);
          const ownerIds = rows.teamOwners
            .filter((row) => row.team_id === team.id)
            .map((row) => row.user_id);
          return {
            team,
            memberIds,
            ownerIds,
            joined: memberIds.includes(userId),
            manageable: ownsEveryTeam || ownerIds.includes(userId),
          };
        });
      return [
        {
          workspace,
          myRole: mine.role,
          myMemberId: mine.id,
          people: members
            .map((member) => ({ member, person: people.get(member.user_id) }))
            .slice()
            .sort(
              (a, b) =>
                ROLE_ORDER[a.member.role] - ROLE_ORDER[b.member.role] ||
                (a.person?.name ?? "").localeCompare(b.person?.name ?? ""),
            ),
          teams,
          pendingInvitations: rows.invitations.filter(
            (invitation) =>
              invitation.organization_id === workspace.id && invitation.status === "pending",
          ),
        },
      ];
    })
    .slice()
    .sort((a, b) => byName(a.workspace, b.workspace));
}

export interface InvitationForYou {
  readonly invitation: InvitationRow;
  readonly workspace: WorkspaceRow | undefined;
  readonly inviter: PersonRow | undefined;
}

/** Pending invitations addressed to you, for workspaces you aren't in yet. */
export function invitationsForYou(
  rows: WorkspaceRows,
  userId: string,
  email: string,
): Array<InvitationForYou> {
  const address = email.toLowerCase();
  const joined = new Set(
    rows.members.filter((member) => member.user_id === userId).map((m) => m.organization_id),
  );
  return rows.invitations
    .filter(
      (invitation) =>
        invitation.status === "pending" &&
        invitation.email.toLowerCase() === address &&
        !joined.has(invitation.organization_id),
    )
    .map((invitation) => ({
      invitation,
      workspace: rows.workspaces.find((workspace) => workspace.id === invitation.organization_id),
      inviter: rows.people.find((person) => person.id === invitation.inviter_id),
    }));
}

/** A URL-safe short name for a new workspace, unique enough to try first. */
export function slugFor(name: string): string {
  const base = name
    .normalize("NFKD")
    // Accents decompose into combining marks; drop them so é becomes e.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}
