import type { WorkspaceShape } from "@t3tools/shared/mercurianWorkspaces";

/** Who is reading: their id, and their address once they have proved it is theirs. */
export interface ShapeReader {
  readonly userId: string;
  readonly verifiedEmail: string | null;
}

/** What the cloud asks Electric for. The client never chooses any of it. */
export interface ShapeDefinition {
  readonly table: string;
  readonly columns: ReadonlyArray<string>;
  readonly where: string;
  readonly params: ReadonlyArray<string>;
}

const MY_WORKSPACES = `SELECT organization_id FROM auth.member WHERE user_id = $1`;
const MY_TEAMS = `SELECT id FROM auth.team WHERE organization_id IN (${MY_WORKSPACES})`;
// $2 is the reader's verified address; an unverified reader gets no second param.
const INVITED_TO = `SELECT organization_id FROM auth.invitation WHERE email = $2 AND status = 'pending'`;
const INVITED_BY = `SELECT inviter_id FROM auth.invitation WHERE email = $2 AND status = 'pending'`;

/**
 * Scopes each shape to its reader with subqueries, so one definition per
 * person holds across membership changes: Electric moves rows in and out as
 * people join, leave and are invited. Someone invited sees the workspace and
 * the inviter of a pending invitation before joining, once their address is
 * verified.
 */
export function defineShape(shape: WorkspaceShape, reader: ShapeReader): ShapeDefinition {
  const invited = reader.verifiedEmail !== null;
  const params = invited ? [reader.userId, reader.verifiedEmail!.toLowerCase()] : [reader.userId];
  const orInvited = (clause: string) => (invited ? ` OR ${clause}` : "");
  switch (shape) {
    case "workspaces":
      return {
        table: "auth.organization",
        columns: [
          "id",
          "name",
          "slug",
          "logo",
          "created_at",
          "invite_policy",
          "team_creation_policy",
        ],
        where: `id IN (${MY_WORKSPACES})${orInvited(`id IN (${INVITED_TO})`)}`,
        params,
      };
    case "members":
      return {
        table: "auth.member",
        columns: ["id", "organization_id", "user_id", "role", "created_at"],
        where: `organization_id IN (${MY_WORKSPACES})`,
        params: [reader.userId],
      };
    case "people":
      // Only what a teammate needs to recognize someone: never access,
      // verification or two-factor state.
      return {
        table: "auth.user",
        columns: ["id", "name", "email", "image"],
        where: `id IN (SELECT user_id FROM auth.member WHERE organization_id IN (${MY_WORKSPACES}))${orInvited(`id IN (${INVITED_BY})`)}`,
        params,
      };
    case "teams":
      return {
        table: "auth.team",
        columns: ["id", "name", "organization_id", "created_at"],
        where: `organization_id IN (${MY_WORKSPACES})`,
        params: [reader.userId],
      };
    case "team_members":
      return {
        table: "auth.team_member",
        columns: ["id", "team_id", "user_id"],
        where: `team_id IN (${MY_TEAMS})`,
        params: [reader.userId],
      };
    case "team_owners":
      return {
        table: "auth.team_owner",
        columns: ["id", "team_member_id", "team_id", "user_id"],
        where: `team_id IN (${MY_TEAMS})`,
        params: [reader.userId],
      };
    case "invitations":
      return {
        table: "auth.invitation",
        columns: [
          "id",
          "organization_id",
          "email",
          "role",
          "status",
          "team_id",
          "inviter_id",
          "expires_at",
          "created_at",
        ],
        where: `organization_id IN (${MY_WORKSPACES})${orInvited(`email = $2`)}`,
        params,
      };
  }
}

// What the client may steer: where it is in the stream, never what it selects.
const PASSED_THROUGH = new Set(["offset", "handle", "live", "cursor", "replica"]);

/** The upstream Electric URL for a client's request, with the cloud's definition. */
export function electricShapeUrl(
  electricUrl: string,
  clientParams: URLSearchParams,
  definition: ShapeDefinition,
): string {
  const url = new URL("/v1/shape", electricUrl);
  for (const [key, value] of clientParams) {
    if (PASSED_THROUGH.has(key)) url.searchParams.set(key, value);
  }
  url.searchParams.set("table", definition.table);
  url.searchParams.set("columns", definition.columns.join(","));
  url.searchParams.set("where", definition.where);
  definition.params.forEach((value, index) => url.searchParams.set(`params[${index + 1}]`, value));
  return url.toString();
}

/**
 * Keeps shape responses out of shared caches. Electric marks them public
 * because it knows nothing of users; through the cloud the same URL returns
 * different rows for different people.
 */
export function privateShapeHeaders(upstream: Headers): Headers {
  const headers = new Headers(upstream);
  // fetch has already decoded the body, so its encoding headers no longer apply.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("cache-control", "private, no-store");
  headers.set("vary", [headers.get("vary"), "authorization", "cookie"].filter(Boolean).join(", "));
  return headers;
}
