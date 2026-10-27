import {
  getCurrentAdapter,
  getCurrentAuthEndpointContext,
  runWithTransaction,
} from "@better-auth/core/context";
import type { BetterAuthPlugin } from "better-auth";
import type { DBFieldAttribute } from "better-auth/db";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, ownerAc } from "better-auth/plugins/organization/access";
import * as Schema from "effect/Schema";

/**
 * Workspaces are Better Auth organizations with one owner, admins and members (no guests).
 * Members get the team and invitation permissions so the plugin lets them through; the hooks
 * below then apply workspace policies and team ownership, so the plugin's endpoints and ours
 * enforce one set of rules.
 */
export const workspaceAccess = createAccessControl(defaultStatements);

export const workspaceRoles = {
  owner: workspaceAccess.newRole(ownerAc.statements),
  admin: workspaceAccess.newRole(adminAc.statements),
  member: workspaceAccess.newRole({
    invitation: ["create"],
    team: ["create", "update", "delete"],
  }),
};

/** Who may invite people, and who may create teams: everyone, or only the owner and admins. */
export type WorkspacePolicy = "members" | "admins";

/** The workspace's two policies, with Linear's defaults. */
export const workspaceFields = {
  invitePolicy: {
    type: ["members", "admins"] as Array<WorkspacePolicy>,
    // Optional on create, so a new workspace takes the default.
    required: false,
    defaultValue: "admins",
    input: true,
  },
  teamCreationPolicy: {
    type: ["members", "admins"] as Array<WorkspacePolicy>,
    required: false,
    defaultValue: "members",
    input: true,
  },
} satisfies Record<string, DBFieldAttribute>;

const forbidden = (code: string, message: string) => APIError.from("FORBIDDEN", { code, message });

const hasRole = (roles: string | undefined, role: string) =>
  roles !== undefined && roles.split(",").includes(role);

const administers = (roles: string | undefined) =>
  hasRole(roles, "owner") || hasRole(roles, "admin");

// Inside the cloud's write transaction this is the transaction's adapter, so
// hooks read and write with the change they guard.
const adapter = () => getCurrentAdapter(getCurrentAuthEndpointContext().context.adapter);

const roleIn = async (organizationId: string, userId: string) =>
  (
    await (
      await adapter()
    ).findOne<{ role: string }>({
      model: "member",
      where: [
        { field: "organizationId", value: organizationId },
        { field: "userId", value: userId },
      ],
    })
  )?.role;

const teamMembership = async (teamId: string, userId: string) =>
  (await adapter()).findOne<{ id: string }>({
    model: "teamMember",
    where: [
      { field: "teamId", value: teamId },
      { field: "userId", value: userId },
    ],
  });

const ownsTeam = async (teamId: string, userId: string) =>
  (await (
    await adapter()
  ).findOne({
    model: "teamOwner",
    where: [
      { field: "teamId", value: teamId },
      { field: "userId", value: userId },
    ],
  })) !== null;

/** The workspace's owner and admins own every team; anyone else must be named. */
const canManageTeam = async (team: { id: string; organizationId: string }, userId: string) =>
  administers(await roleIn(team.organizationId, userId)) || (await ownsTeam(team.id, userId));

const makeTeamOwner = async (teamId: string, userId: string) => {
  const db = await adapter();
  const membership =
    (await teamMembership(teamId, userId)) ??
    (await db.create<{ id: string }>({
      model: "teamMember",
      // Better Auth's adapter stores a Date.
      // @effect-diagnostics-next-line globalDate:off
      data: { teamId, userId, createdAt: new Date() },
    }));
  if (await ownsTeam(teamId, userId)) return;
  await db.create({
    model: "teamOwner",
    // @effect-diagnostics-next-line globalDate:off
    data: { teamMemberId: membership.id, teamId, userId, createdAt: new Date() },
  });
};

export const workspaceHooks = {
  beforeCreateInvitation: async ({
    invitation,
    organization,
  }: {
    invitation: { role: string; inviterId: string };
    organization: { id: string; invitePolicy?: WorkspacePolicy };
  }) => {
    if (hasRole(invitation.role, "owner")) {
      throw forbidden("OWNER_NOT_INVITED", "A workspace has one owner, who hands it over.");
    }
    const inviter = await roleIn(organization.id, invitation.inviterId);
    if (administers(inviter)) return;
    if (organization.invitePolicy !== "members") {
      throw forbidden("INVITES_ADMINS_ONLY", "Only the owner and admins invite people here.");
    }
    if (!hasRole(invitation.role, "member") || invitation.role.includes(",")) {
      throw forbidden("MEMBERS_INVITE_MEMBERS", "Members can invite members, not admins.");
    }
  },

  beforeCreateTeam: async ({
    user,
    organization,
  }: {
    user?: { id: string };
    organization: { id: string; teamCreationPolicy?: WorkspacePolicy };
  }) => {
    if (user === undefined || organization.teamCreationPolicy !== "admins") return;
    // A new workspace's first team comes before its owner can be looked up as one.
    const role = await roleIn(organization.id, user.id);
    if (role !== undefined && !administers(role)) {
      throw forbidden("TEAMS_ADMINS_ONLY", "Only the owner and admins create teams here.");
    }
  },

  // Whoever creates a team joins and owns it.
  afterCreateTeam: async ({ team, user }: { team: { id: string }; user?: { id: string } }) => {
    if (user !== undefined) await makeTeamOwner(team.id, user.id);
  },

  beforeUpdateTeam: async ({
    team,
    user,
  }: {
    team: { id: string; organizationId: string };
    user: { id: string };
  }) => {
    if (!(await canManageTeam(team, user.id))) {
      throw forbidden("NOT_TEAM_OWNER", "Only the team's owners can change it.");
    }
  },

  beforeDeleteTeam: async ({
    team,
    user,
  }: {
    team: { id: string; organizationId: string };
    user?: { id: string };
  }) => {
    if (user === undefined || !(await canManageTeam(team, user.id))) {
      throw forbidden("NOT_TEAM_OWNER", "Only the team's owners can delete it.");
    }
  },

  // Ownership moves only through transferOwnership, so the owner is never
  // demoted without a successor and nobody else becomes one.
  beforeUpdateMemberRole: async ({
    member,
    newRole,
  }: {
    member: { role: string };
    newRole: string;
  }) => {
    if (hasRole(newRole, "owner") || hasRole(member.role, "owner")) {
      throw forbidden("TRANSFER_OWNERSHIP", "Hand the workspace over to change its owner.");
    }
  },

  beforeRemoveMember: async ({ member }: { member: { role: string } }) => {
    if (hasRole(member.role, "owner")) {
      throw forbidden("OWNER_STAYS", "The owner hands the workspace over before leaving it.");
    }
  },
};

const TeamBody = Schema.toStandardSchemaV1(Schema.Struct({ teamId: Schema.String }));
const TeamOwnerBody = Schema.toStandardSchemaV1(
  Schema.Struct({ teamId: Schema.String, userId: Schema.String, owner: Schema.Boolean }),
);
const TransferBody = Schema.toStandardSchemaV1(
  Schema.Struct({ organizationId: Schema.String, userId: Schema.String }),
);

const findTeam = async (teamId: string) => {
  const team = await (
    await adapter()
  ).findOne<{ id: string; organizationId: string }>({
    model: "team",
    where: [{ field: "id", value: teamId }],
  });
  if (team === null)
    throw APIError.from("NOT_FOUND", { code: "TEAM_NOT_FOUND", message: "No such team." });
  return team;
};

/**
 * What the organization plugin has no endpoint for: joining and leaving teams
 * yourself, naming team owners, and handing a workspace to a new owner.
 */
export const workspacesPlugin = () =>
  ({
    id: "astrolabe-workspaces",
    schema: {
      teamOwner: {
        fields: {
          // Ownership is part of a membership and ends with it.
          teamMemberId: {
            type: "string",
            required: true,
            unique: true,
            references: { model: "teamMember", field: "id", onDelete: "cascade" },
          },
          teamId: {
            type: "string",
            required: true,
            index: true,
            references: { model: "team", field: "id", onDelete: "cascade" },
          },
          userId: {
            type: "string",
            required: true,
            index: true,
            references: { model: "user", field: "id", onDelete: "cascade" },
          },
          createdAt: { type: "date", required: true },
        },
      },
    },
    endpoints: {
      joinTeam: createAuthEndpoint(
        "/workspace/join-team",
        { method: "POST", body: TeamBody, use: [sessionMiddleware] },
        async (ctx) => {
          const userId = ctx.context.session.user.id;
          const team = await findTeam(ctx.body.teamId);
          if ((await roleIn(team.organizationId, userId)) === undefined) {
            throw forbidden("NOT_A_MEMBER", "Join the workspace before its teams.");
          }
          if ((await teamMembership(team.id, userId)) === null) {
            await (
              await adapter()
            ).create({
              model: "teamMember",
              // @effect-diagnostics-next-line globalDate:off
              data: { teamId: team.id, userId, createdAt: new Date() },
            });
          }
          return ctx.json({ teamId: team.id });
        },
      ),
      leaveTeam: createAuthEndpoint(
        "/workspace/leave-team",
        { method: "POST", body: TeamBody, use: [sessionMiddleware] },
        async (ctx) => {
          await (
            await adapter()
          ).deleteMany({
            model: "teamMember",
            where: [
              { field: "teamId", value: ctx.body.teamId },
              { field: "userId", value: ctx.context.session.user.id },
            ],
          });
          return ctx.json({ teamId: ctx.body.teamId });
        },
      ),
      setTeamOwner: createAuthEndpoint(
        "/workspace/set-team-owner",
        { method: "POST", body: TeamOwnerBody, use: [sessionMiddleware] },
        async (ctx) => {
          const team = await findTeam(ctx.body.teamId);
          if (!(await canManageTeam(team, ctx.context.session.user.id))) {
            throw forbidden("NOT_TEAM_OWNER", "Only the team's owners can name its owners.");
          }
          if ((await teamMembership(team.id, ctx.body.userId)) === null) {
            throw forbidden("NOT_ON_TEAM", "Only people on the team can own it.");
          }
          if (ctx.body.owner) await makeTeamOwner(team.id, ctx.body.userId);
          else {
            await (
              await adapter()
            ).deleteMany({
              model: "teamOwner",
              where: [
                { field: "teamId", value: team.id },
                { field: "userId", value: ctx.body.userId },
              ],
            });
          }
          return ctx.json({ teamId: team.id, userId: ctx.body.userId, owner: ctx.body.owner });
        },
      ),
      transferOwnership: createAuthEndpoint(
        "/workspace/transfer-ownership",
        { method: "POST", body: TransferBody, use: [sessionMiddleware] },
        async (ctx) => {
          const { organizationId, userId } = ctx.body;
          const ownerId = ctx.context.session.user.id;
          return runWithTransaction(ctx.context.adapter, async () => {
            const db = await adapter();
            const members = await db.findMany<{ id: string; userId: string; role: string }>({
              model: "member",
              where: [{ field: "organizationId", value: organizationId }],
            });
            const owner = members.find((member) => member.userId === ownerId);
            const successor = members.find((member) => member.userId === userId);
            if (owner === undefined || !hasRole(owner.role, "owner")) {
              throw forbidden("NOT_OWNER", "Only the owner hands the workspace over.");
            }
            if (successor === undefined || successor === owner) {
              throw forbidden("NOT_A_MEMBER", "Hand the workspace to someone already in it.");
            }
            const owned = await db.count({
              model: "member",
              where: [
                { field: "userId", value: userId },
                { field: "role", value: "owner" },
              ],
            });
            if (owned > 0) {
              throw forbidden("ALREADY_OWNS_ORGANIZATION", "That person already owns a workspace.");
            }
            await db.update({
              model: "member",
              where: [{ field: "id", value: successor.id }],
              update: { role: "owner" },
            });
            await db.update({
              model: "member",
              where: [{ field: "id", value: owner.id }],
              update: { role: "admin" },
            });
            return ctx.json({ organizationId, ownerId: userId });
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
