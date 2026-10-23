import { getCurrentAdapter, getCurrentAuthEndpointContext } from "@better-auth/core/context";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from "better-auth/api";

/**
 * Who may use the cloud. Sign-up puts everyone on the waitlist; approval
 * lets you create an organization; accepting an invitation makes you a
 * member, who can use the orgs they join but not create one, until they ask
 * for their own and are approved. Declined accounts keep seeing the waitlist.
 */
export type Access = "waitlisted" | "member" | "approved" | "declined";

export const hasAccess = (access: unknown) => access === "approved" || access === "member";

/** Owner plus four. Pending invitations hold a seat, so the invite form stops at the limit. */
export const ORGANIZATION_SEATS = 5;

// The current transaction's adapter when there is one, so a rule reads what
// the write it guards can see, on the same connection.
const adapter = () => getCurrentAdapter(getCurrentAuthEndpointContext().context.adapter);

const ownedOrganizations = async (userId: string) =>
  (await adapter()).count({
    model: "member",
    where: [
      { field: "userId", value: userId },
      { field: "role", value: "owner" },
    ],
  });

const isOwnerRole = (role: string) => role.split(",").includes("owner");

export const organizationRules = {
  allowUserToCreateOrganization: async (user: { id: string; access?: unknown }) =>
    user.access === "approved" && (await ownedOrganizations(user.id)) === 0,
  organizationHooks: {
    beforeCreateInvitation: async ({ organization }: { organization: { id: string } }) => {
      const db = await adapter();
      const members = await db.count({
        model: "member",
        where: [{ field: "organizationId", value: organization.id }],
      });
      const pending = await db.count({
        model: "invitation",
        where: [
          { field: "organizationId", value: organization.id },
          { field: "status", value: "pending" },
          // Better Auth's adapter compares against a Date.
          // @effect-diagnostics-next-line globalDate:off
          { field: "expiresAt", operator: "gt", value: new Date() },
        ],
      });
      if (members + pending >= ORGANIZATION_SEATS) {
        throw APIError.from("FORBIDDEN", {
          code: "ORGANIZATION_FULL",
          message: `A workspace holds ${ORGANIZATION_SEATS} people, counting pending invitations.`,
        });
      }
    },
    // Ownership can move, but nobody ends up owning two organizations.
    beforeUpdateMemberRole: async ({
      member,
      newRole,
    }: {
      member: { userId: string; role: string };
      newRole: string;
    }) => {
      if (!isOwnerRole(newRole) || isOwnerRole(member.role)) return;
      if ((await ownedOrganizations(member.userId)) > 0) {
        throw APIError.from("FORBIDDEN", {
          code: "ALREADY_OWNS_ORGANIZATION",
          message: "That person already owns a workspace.",
        });
      }
    },
    afterAcceptInvitation: async ({ user }: { user: { id: string; access?: unknown } }) => {
      if (user.access !== "waitlisted") return;
      const { internalAdapter } = getCurrentAuthEndpointContext().context;
      await internalAdapter.updateUser(user.id, { access: "member" });
    },
  },
};

/** Relay tokens go only to people who are off the waitlist. */
export const accessGate = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/token") return;
  const session = await getSessionFromCtx(ctx);
  if (session && !hasAccess((session.user as { access?: unknown }).access)) {
    throw APIError.from("FORBIDDEN", {
      code: "WAITLISTED",
      message: "Your account is still on the waitlist.",
    });
  }
});

/**
 * A member asks to own an organization, which puts them in the approval
 * queue (`scripts/waitlist.ts`). `orgRequestedAt` on the session shows the
 * request; cancelling clears it.
 */
export const accessPlugin = () =>
  ({
    id: "astrolabe-access",
    endpoints: {
      requestOrganization: createAuthEndpoint(
        "/access/request-organization",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const { user } = ctx.context.session;
          if ((user as { access?: unknown }).access !== "member") {
            throw APIError.from("BAD_REQUEST", {
              code: "NOT_A_MEMBER",
              message: "Only members waiting to own a workspace can ask for one.",
            });
          }
          await ctx.context.internalAdapter.updateUser(user.id, {
            // Better Auth's adapter stores a Date.
            // @effect-diagnostics-next-line globalDate:off
            orgRequestedAt: new Date(),
          });
          return ctx.json({ requested: true });
        },
      ),
      cancelOrganizationRequest: createAuthEndpoint(
        "/access/cancel-organization-request",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          await ctx.context.internalAdapter.updateUser(ctx.context.session.user.id, {
            orgRequestedAt: null,
          });
          return ctx.json({ requested: false });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
