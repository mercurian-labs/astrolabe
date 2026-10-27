import { getCurrentDBAdapterAsyncLocalStorage } from "@better-auth/core/context";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as Schema from "effect/Schema";
import {
  WorkspaceWriteRequest,
  WorkspaceWrites,
  type WorkspaceWrite,
  type WorkspaceWriteError,
  type WorkspaceWriteInput,
  type WorkspaceWriteResult,
} from "@t3tools/shared/mercurianWorkspaces";

import * as schema from "../auth/schema.ts";

type Endpoint = (call: { body: object; headers: Headers }) => Promise<unknown>;

/** The Better Auth endpoints writes call; the organization plugin's and ours. */
export interface WorkspaceApi {
  readonly createOrganization: Endpoint;
  readonly updateOrganization: Endpoint;
  readonly deleteOrganization: Endpoint;
  readonly leaveOrganization: Endpoint;
  readonly transferOwnership: Endpoint;
  readonly createInvitation: Endpoint;
  readonly cancelInvitation: Endpoint;
  readonly acceptInvitation: Endpoint;
  readonly rejectInvitation: Endpoint;
  readonly updateMemberRole: Endpoint;
  readonly removeMember: Endpoint;
  readonly createTeam: Endpoint;
  readonly updateTeam: Endpoint;
  readonly removeTeam: Endpoint;
  readonly joinTeam: Endpoint;
  readonly leaveTeam: Endpoint;
  readonly setTeamOwner: Endpoint;
}

const defined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

/** Each write is one Better Auth call, so its rules are the ones the plugin's own endpoints keep. */
const calls: {
  readonly [W in WorkspaceWrite]: (
    api: WorkspaceApi,
    input: WorkspaceWriteInput<W>,
    headers: Headers,
  ) => Promise<unknown>;
} = {
  createWorkspace: (api, input, headers) => api.createOrganization({ body: input, headers }),
  updateWorkspace: (api, { organizationId, ...data }, headers) =>
    api.updateOrganization({ body: { organizationId, data: defined(data) }, headers }),
  deleteWorkspace: (api, input, headers) => api.deleteOrganization({ body: input, headers }),
  leaveWorkspace: (api, input, headers) => api.leaveOrganization({ body: input, headers }),
  transferOwnership: (api, input, headers) => api.transferOwnership({ body: input, headers }),
  invite: (api, input, headers) => api.createInvitation({ body: defined(input), headers }),
  revokeInvitation: (api, input, headers) => api.cancelInvitation({ body: input, headers }),
  acceptInvitation: (api, input, headers) => api.acceptInvitation({ body: input, headers }),
  declineInvitation: (api, input, headers) => api.rejectInvitation({ body: input, headers }),
  setMemberRole: (api, input, headers) => api.updateMemberRole({ body: input, headers }),
  removeMember: (api, { memberId, organizationId }, headers) =>
    api.removeMember({ body: { memberIdOrEmail: memberId, organizationId }, headers }),
  createTeam: (api, input, headers) => api.createTeam({ body: input, headers }),
  // Without data.organizationId the plugin falls back to the session's
  // active organization, which may be unset or another workspace.
  renameTeam: (api, { organizationId, teamId, name }, headers) =>
    api.updateTeam({ body: { teamId, data: { name, organizationId } }, headers }),
  deleteTeam: (api, input, headers) => api.removeTeam({ body: input, headers }),
  joinTeam: (api, input, headers) => api.joinTeam({ body: input, headers }),
  leaveTeam: (api, input, headers) => api.leaveTeam({ body: input, headers }),
  setTeamOwner: (api, input, headers) => api.setTeamOwner({ body: input, headers }),
};

export type WorkspaceWriteResponse =
  | { readonly status: 200; readonly body: WorkspaceWriteResult }
  | { readonly status: number; readonly body: WorkspaceWriteError };

const refused = (status: number, code: string, message: string): WorkspaceWriteResponse => ({
  status,
  body: { code, message },
});

const decodeRequest = Schema.decodeUnknownExit(WorkspaceWriteRequest);
const decodeInput = Object.fromEntries(
  Object.entries(WorkspaceWrites).map(([write, schema]) => [
    write,
    Schema.decodeUnknownExit(schema),
  ]),
) as {
  readonly [W in WorkspaceWrite]: (
    input: unknown,
  ) => ReturnType<ReturnType<typeof Schema.decodeUnknownExit<(typeof WorkspaceWrites)[W]>>>;
};

/**
 * Runs one write in a cloud-owned transaction and returns its txid, the id Electric reports when
 * the change reaches a client's shapes. Better Auth joins it through its adapter context, so its
 * writes, our hooks' writes and the rules' reads share one transaction, and after-commit work
 * (such as an invitation email) waits for it. A write that changed nothing has no txid.
 */
export const makeWorkspaceWriter = (deps: {
  readonly db: NodePgDatabase<typeof schema.authRelations>;
  readonly api: WorkspaceApi;
  readonly authOptions: BetterAuthOptions;
}) => {
  const transact = async <A>(run: () => Promise<A>) => {
    const storage = await getCurrentDBAdapterAsyncLocalStorage();
    const pendingHooks: Array<() => Promise<void>> = [];
    const outcome = await deps.db.transaction(async (tx) => {
      const adapter = drizzleAdapter(tx, { provider: "pg", schema, transaction: false })(
        deps.authOptions,
      );
      const result = await storage.run({ adapter, pendingHooks, isTransactionActive: true }, run);
      const { rows } = await tx.execute<{ txid: string | null }>(
        sql`SELECT pg_current_xact_id_if_assigned()::xid::text AS txid`,
      );
      const txid = rows[0]?.txid ?? null;
      return { result, txid: txid === null ? null : Number(txid) };
    });
    for (const hook of pendingHooks) await hook();
    return outcome;
  };

  return async (headers: Headers, request: unknown): Promise<WorkspaceWriteResponse> => {
    const decoded = decodeRequest(request);
    if (decoded._tag === "Failure") return refused(400, "BAD_REQUEST", "Unknown write.");
    const { write, input } = decoded.value;
    const parsed = decodeInput[write](input);
    if (parsed._tag === "Failure") return refused(400, "BAD_REQUEST", "That input isn't valid.");
    const call = calls[write] as (
      api: WorkspaceApi,
      input: unknown,
      headers: Headers,
    ) => Promise<unknown>;
    try {
      const outcome = await transact(() => call(deps.api, parsed.value, headers));
      return { status: 200, body: outcome };
    } catch (error) {
      if (!(error instanceof APIError)) throw error;
      const body = error.body as { code?: string; message?: string } | undefined;
      return refused(
        error.statusCode,
        body?.code ?? error.status.toString(),
        body?.message ?? error.message,
      );
    }
  };
};
