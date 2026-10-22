import * as Schema from "effect/Schema";

/**
 * Workspaces and teams on the wire between the cloud and every client.
 * Better Auth calls a workspace an organization, so rows keep its names;
 * only what people read says "workspace".
 *
 * Reads arrive as Electric shapes the cloud scopes to the caller
 * (`WORKSPACE_PATHS.shape`). Writes go to `WORKSPACE_PATHS.write`, which runs
 * them in one transaction and returns its id, so a client can wait for the
 * change to arrive through its shapes. A write that changed nothing returns
 * a null txid and there is nothing to wait for.
 */
export const WORKSPACE_PATHS = {
  write: "/api/workspaces/write",
  shape: "/api/workspaces/shape",
} as const;

export type WorkspaceRole = "owner" | "admin" | "member";
export type WorkspacePolicy = "members" | "admins";

const Id = Schema.String.check(Schema.isMinLength(1));
const Name = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80));
const Policy = Schema.Literals(["members", "admins"]);
const GrantedRole = Schema.Literals(["admin", "member"]);

/** Every write a client can make, and its input. */
export const WorkspaceWrites = {
  createWorkspace: Schema.Struct({ name: Name, slug: Id }),
  updateWorkspace: Schema.Struct({
    organizationId: Id,
    name: Schema.optional(Name),
    invitePolicy: Schema.optional(Policy),
    teamCreationPolicy: Schema.optional(Policy),
  }),
  deleteWorkspace: Schema.Struct({ organizationId: Id }),
  leaveWorkspace: Schema.Struct({ organizationId: Id }),
  transferOwnership: Schema.Struct({ organizationId: Id, userId: Id }),
  invite: Schema.Struct({
    organizationId: Id,
    email: Schema.Trim.check(Schema.isMinLength(3)),
    role: GrantedRole,
    teamId: Schema.optional(Id),
  }),
  revokeInvitation: Schema.Struct({ invitationId: Id }),
  acceptInvitation: Schema.Struct({ invitationId: Id }),
  declineInvitation: Schema.Struct({ invitationId: Id }),
  setMemberRole: Schema.Struct({ organizationId: Id, memberId: Id, role: GrantedRole }),
  removeMember: Schema.Struct({ organizationId: Id, memberId: Id }),
  createTeam: Schema.Struct({ organizationId: Id, name: Name }),
  renameTeam: Schema.Struct({ organizationId: Id, teamId: Id, name: Name }),
  deleteTeam: Schema.Struct({ organizationId: Id, teamId: Id }),
  joinTeam: Schema.Struct({ teamId: Id }),
  leaveTeam: Schema.Struct({ teamId: Id }),
  setTeamOwner: Schema.Struct({ teamId: Id, userId: Id, owner: Schema.Boolean }),
} as const;

export type WorkspaceWrite = keyof typeof WorkspaceWrites;
export type WorkspaceWriteInput<W extends WorkspaceWrite> = (typeof WorkspaceWrites)[W]["Type"];

export const WorkspaceWriteRequest = Schema.Struct({
  write: Schema.Literals(Object.keys(WorkspaceWrites) as Array<WorkspaceWrite>),
  input: Schema.Unknown,
});

export const WorkspaceWriteResult = Schema.Struct({
  txid: Schema.NullOr(Schema.Number),
  /** What Better Auth returned, e.g. the created team or invitation. */
  result: Schema.Unknown,
});
export type WorkspaceWriteResult = typeof WorkspaceWriteResult.Type;

/** A refused write: Better Auth's code (e.g. `NOT_TEAM_OWNER`) and a sentence for people. */
export const WorkspaceWriteError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});
export type WorkspaceWriteError = typeof WorkspaceWriteError.Type;

/** The tables a client may sync, each scoped by the cloud to the caller. */
const WORKSPACE_SHAPES = [
  "workspaces",
  "members",
  "people",
  "teams",
  "team_members",
  "team_owners",
  "invitations",
] as const;
export type WorkspaceShape = (typeof WORKSPACE_SHAPES)[number];

export const isWorkspaceShape = (value: string | null): value is WorkspaceShape =>
  (WORKSPACE_SHAPES as ReadonlyArray<string | null>).includes(value);

// Rows as Electric delivers them: Postgres column names, timestamps as text.

export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly created_at: string;
  readonly invite_policy: WorkspacePolicy | null;
  readonly team_creation_policy: WorkspacePolicy | null;
}

export interface MemberRow {
  readonly id: string;
  readonly organization_id: string;
  readonly user_id: string;
  readonly role: WorkspaceRole;
  readonly created_at: string;
}

export interface PersonRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

export interface TeamRow {
  readonly id: string;
  readonly name: string;
  readonly organization_id: string;
  readonly created_at: string;
}

export interface TeamMemberRow {
  readonly id: string;
  readonly team_id: string;
  readonly user_id: string;
}

export interface TeamOwnerRow {
  readonly id: string;
  readonly team_member_id: string;
  readonly team_id: string;
  readonly user_id: string;
}

export interface InvitationRow {
  readonly id: string;
  readonly organization_id: string;
  readonly email: string;
  readonly role: WorkspaceRole;
  readonly status: "pending" | "accepted" | "rejected" | "canceled";
  readonly team_id: string | null;
  readonly inviter_id: string;
  readonly expires_at: string;
  readonly created_at: string;
}

/** A workspace's policy as stored; a missing value is the default. */
export const invitePolicyOf = (workspace: WorkspaceRow): WorkspacePolicy =>
  workspace.invite_policy ?? "admins";
export const teamCreationPolicyOf = (workspace: WorkspaceRow): WorkspacePolicy =>
  workspace.team_creation_policy ?? "members";

/** What a role may do, mirroring the cloud's rules so controls only offer what will succeed. */
export const administers = (role: WorkspaceRole | undefined) =>
  role === "owner" || role === "admin";
export const canInvite = (role: WorkspaceRole | undefined, workspace: WorkspaceRow) =>
  administers(role) || (role === "member" && invitePolicyOf(workspace) === "members");
export const canCreateTeam = (role: WorkspaceRole | undefined, workspace: WorkspaceRow) =>
  administers(role) || (role === "member" && teamCreationPolicyOf(workspace) === "members");
