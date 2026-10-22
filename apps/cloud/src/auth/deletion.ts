import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import { APIError } from "better-auth/api";
import { signJWT, type JwtOptions } from "better-auth/plugins/jwt";

/**
 * Runs before Better Auth deletes an account (which cascades its sessions,
 * sign-in methods, passkeys and memberships). An organization you own with
 * other people in it must be handed over first; one you're alone in goes
 * with you. Linked machines are unlinked through the relay so their tunnels
 * are torn down; if the relay can't be reached the deletion stops and can
 * be retried.
 */
export const beforeDeleteAccount =
  (input: {
    readonly jwtOptions: JwtOptions;
    readonly removeRelayData: (userId: string, relayToken: string) => Promise<void>;
  }) =>
  async (user: { id: string }) => {
    const ctx = getCurrentAuthEndpointContext();
    const { adapter } = ctx.context;
    const owned = await adapter.findMany<{ organizationId: string }>({
      model: "member",
      where: [
        { field: "userId", value: user.id },
        { field: "role", value: "owner" },
      ],
    });
    const soloOrganizations: Array<string> = [];
    for (const { organizationId } of owned) {
      const members = await adapter.count({
        model: "member",
        where: [{ field: "organizationId", value: organizationId }],
      });
      if (members > 1) {
        throw APIError.from("BAD_REQUEST", {
          code: "OWNS_SHARED_ORGANIZATION",
          message: "Hand over or empty the workspaces you own before deleting your account.",
        });
      }
      soloOrganizations.push(organizationId);
    }

    // A relay token for the departing user, so the relay unlinks their machines.
    const relayToken = await signJWT(ctx as Parameters<typeof signJWT>[0], {
      options: input.jwtOptions,
      payload: { sub: user.id },
    });
    await input.removeRelayData(user.id, relayToken);

    for (const id of soloOrganizations) {
      await adapter.delete({ model: "organization", where: [{ field: "id", value: id }] });
    }
  };
