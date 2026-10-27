// @effect-diagnostics globalFetch:off globalTimers:off - Collections sync through Electric's fetch client, outside an Effect runtime.
import type { CloudConnection } from "@t3tools/shared/mercurianAccount";
import {
  WORKSPACE_PATHS,
  type InvitationRow,
  type MemberRow,
  type PersonRow,
  type TeamMemberRow,
  type TeamOwnerRow,
  type TeamRow,
  type WorkspaceRow,
  type WorkspaceShape,
  type WorkspaceWrite,
  type WorkspaceWriteInput,
} from "@t3tools/shared/mercurianWorkspaces";
import type { RuntimeVisibilityAdapter } from "@electric-sql/client";
import { createCollection, createOptimisticAction } from "@tanstack/db";
import {
  persistedCollectionOptions,
  type PersistedCollectionPersistence,
} from "@tanstack/db-sqlite-persistence-core";
import {
  electricCollectionOptions,
  type ElectricCollectionUtils,
} from "@tanstack/electric-db-collection";

export * from "./model.ts";
export {
  administers,
  canCreateTeam,
  canInvite,
  invitePolicyOf,
  teamCreationPolicyOf,
  type WorkspacePolicy,
  type WorkspaceRole,
} from "@t3tools/shared/mercurianWorkspaces";
// Mobile pauses shapes while the app is in the background.
export { createReactNativeRuntimeVisibilityAdapter } from "@electric-sql/client";

/** The cloud refused a write; `code` is its rule, e.g. `NOT_TEAM_OWNER`. */
export class WorkspaceWriteRefused extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkspaceWriteRefused";
    this.code = code;
  }
}

// How long a collection nobody reads keeps its shape open.
const IDLE_MS = 5_000;
// A write has landed once the cloud answers; waiting for it to arrive only
// keeps the screen honest, so a slow stream doesn't fail the write.
const ARRIVAL_TIMEOUT_MS = 10_000;

/**
 * Workspaces and teams on this device: one Electric-synced collection per shape, scoped by the
 * cloud to the signed-in person, syncing only while read. A write resolves once the cloud's
 * transaction id reaches the collection it changes, so the screen is never behind what was done.
 */
export function createWorkspaceSync(options: {
  readonly connection: CloudConnection;
  /** Separates one person's collections from the next on a shared device. */
  readonly userId: string;
  /** Pauses live shapes while the app isn't visible (mobile). */
  readonly runtimeVisibility?: RuntimeVisibilityAdapter;
  /**
   * Keeps the rows, and each shape's place in its stream, in a local SQLite
   * database, so the app opens with them and resumes instead of re-reading.
   * The database must belong to this person alone.
   */
  readonly persistence?: PersistedCollectionPersistence;
}) {
  const { connection, userId } = options;

  const fetchClient: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const authorization = await connection.authorization();
    if (authorization) headers.set("authorization", authorization);
    return fetch(input, { ...init, headers, credentials: connection.credentials });
  };

  const collectionOf = <Row extends { readonly id: string }>(shape: WorkspaceShape) => {
    const electric = electricCollectionOptions<Row>({
      id: `workspaces.${shape}:${userId}`,
      gcTime: IDLE_MS,
      getKey: (row) => row.id,
      shapeOptions: {
        url: `${connection.origin}${WORKSPACE_PATHS.shape}`,
        params: { shape },
        fetchClient,
        ...(options.runtimeVisibility ? { runtimeVisibility: options.runtimeVisibility } : {}),
      },
    });
    return options.persistence
      ? createCollection(
          persistedCollectionOptions<Row, string | number, never, ElectricCollectionUtils<Row>>({
            ...electric,
            persistence: options.persistence,
            // Bump when a shape's columns change, so old saved rows are dropped.
            schemaVersion: 1,
          }),
        )
      : createCollection(electric);
  };

  const collections = {
    workspaces: collectionOf<WorkspaceRow>("workspaces"),
    members: collectionOf<MemberRow>("members"),
    people: collectionOf<PersonRow>("people"),
    teams: collectionOf<TeamRow>("teams"),
    teamMembers: collectionOf<TeamMemberRow>("team_members"),
    teamOwners: collectionOf<TeamOwnerRow>("team_owners"),
    invitations: collectionOf<InvitationRow>("invitations"),
  };
  type Collections = typeof collections;

  // Where each write's change arrives.
  const arrivesIn: { readonly [W in WorkspaceWrite]: keyof Collections } = {
    createWorkspace: "workspaces",
    updateWorkspace: "workspaces",
    deleteWorkspace: "workspaces",
    leaveWorkspace: "workspaces",
    transferOwnership: "members",
    invite: "invitations",
    revokeInvitation: "invitations",
    acceptInvitation: "invitations",
    declineInvitation: "invitations",
    setMemberRole: "members",
    removeMember: "members",
    createTeam: "teams",
    renameTeam: "teams",
    deleteTeam: "teams",
    joinTeam: "teamMembers",
    leaveTeam: "teamMembers",
    setTeamOwner: "teamOwners",
  };

  /** Makes a write and waits until its change is on this device. Returns what the cloud returned. */
  const write = async <W extends WorkspaceWrite>(
    name: W,
    input: WorkspaceWriteInput<W>,
  ): Promise<unknown> => {
    const response = await fetchClient(`${connection.origin}${WORKSPACE_PATHS.write}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ write: name, input }),
    });
    const body = (await response.json().catch(() => null)) as {
      txid?: number | null;
      result?: unknown;
      code?: string;
      message?: string;
    } | null;
    if (!response.ok) {
      throw new WorkspaceWriteRefused(
        body?.code ?? String(response.status),
        body?.message ?? "That didn't work. Try again.",
      );
    }
    const collection = collections[arrivesIn[name]];
    // A collection nobody reads isn't syncing, and nothing on screen is waiting.
    if (typeof body?.txid === "number" && collection.status !== "idle") {
      await collection.utils.awaitTxId(body.txid, ARRIVAL_TIMEOUT_MS).catch(() => undefined);
    }
    return body?.result;
  };

  // Writes whose outcome is certain show at once and settle when the cloud's
  // transaction arrives; a refusal rolls them back.
  const optimistic = {
    updateWorkspace: createOptimisticAction<WorkspaceWriteInput<"updateWorkspace">>({
      onMutate: ({ organizationId, name, invitePolicy, teamCreationPolicy }) => {
        if (!collections.workspaces.has(organizationId)) return;
        collections.workspaces.update(organizationId, (draft) => {
          Object.assign(draft, {
            ...(name === undefined ? {} : { name }),
            ...(invitePolicy === undefined ? {} : { invite_policy: invitePolicy }),
            ...(teamCreationPolicy === undefined
              ? {}
              : { team_creation_policy: teamCreationPolicy }),
          });
        });
      },
      mutationFn: (input) => write("updateWorkspace", input),
    }),
    renameTeam: createOptimisticAction<WorkspaceWriteInput<"renameTeam">>({
      onMutate: ({ teamId, name }) => {
        if (!collections.teams.has(teamId)) return;
        collections.teams.update(teamId, (draft) => {
          Object.assign(draft, { name });
        });
      },
      mutationFn: (input) => write("renameTeam", input),
    }),
    setMemberRole: createOptimisticAction<WorkspaceWriteInput<"setMemberRole">>({
      onMutate: ({ memberId, role }) => {
        if (!collections.members.has(memberId)) return;
        collections.members.update(memberId, (draft) => {
          Object.assign(draft, { role });
        });
      },
      mutationFn: (input) => write("setMemberRole", input),
    }),
    removeMember: createOptimisticAction<WorkspaceWriteInput<"removeMember">>({
      onMutate: ({ memberId }) => {
        if (collections.members.has(memberId)) collections.members.delete(memberId);
      },
      mutationFn: (input) => write("removeMember", input),
    }),
    revokeInvitation: createOptimisticAction<WorkspaceWriteInput<"revokeInvitation">>({
      onMutate: ({ invitationId }) => {
        if (!collections.invitations.has(invitationId)) return;
        collections.invitations.update(invitationId, (draft) => {
          Object.assign(draft, { status: "canceled" });
        });
      },
      mutationFn: (input) => write("revokeInvitation", input),
    }),
    leaveTeam: createOptimisticAction<WorkspaceWriteInput<"leaveTeam">>({
      onMutate: ({ teamId }) => {
        for (const row of collections.teamMembers.values()) {
          if (row.team_id === teamId && row.user_id === userId) {
            collections.teamMembers.delete(row.id);
          }
        }
      },
      mutationFn: (input) => write("leaveTeam", input),
    }),
  };

  /** Runs an optimistic write and resolves once it has settled, rejecting with the cloud's refusal. */
  const settle = async <V>(
    action: (variables: V) => { isPersisted: { promise: Promise<unknown> } },
    variables: V,
  ) => {
    await action(variables).isPersisted.promise;
  };

  return {
    userId,
    collections,
    /**
     * True once a collection nobody read for `IDLE_MS` has stopped. Build a
     * fresh sync instead of reading this one again: a stopped collection
     * restarts when read, but a live query that subscribes while it restarts
     * never becomes ready (TanStack DB 0.15).
     */
    get stopped() {
      return Object.values(collections).some((collection) => collection.status === "cleaned-up");
    },
    write,
    updateWorkspace: (input: WorkspaceWriteInput<"updateWorkspace">) =>
      settle(optimistic.updateWorkspace, input),
    renameTeam: (input: WorkspaceWriteInput<"renameTeam">) => settle(optimistic.renameTeam, input),
    setMemberRole: (input: WorkspaceWriteInput<"setMemberRole">) =>
      settle(optimistic.setMemberRole, input),
    removeMember: (input: WorkspaceWriteInput<"removeMember">) =>
      settle(optimistic.removeMember, input),
    revokeInvitation: (input: WorkspaceWriteInput<"revokeInvitation">) =>
      settle(optimistic.revokeInvitation, input),
    leaveTeam: (input: WorkspaceWriteInput<"leaveTeam">) => settle(optimistic.leaveTeam, input),
    /**
     * Stops every shape, e.g. on sign-out. A collection a live query still
     * reads stops once the query lets go (a closing screen's queries outlive
     * it briefly); stopping it under the query fails the query.
     */
    close: async () => {
      await Promise.all(
        Object.values(collections).map(async (collection) => {
          if (collection.subscriberCount > 0) {
            await new Promise<void>((released) => {
              const stop = collection.on("subscribers:change", (event) => {
                if (event.subscriberCount > 0) return;
                stop();
                released();
              });
            });
          }
          await collection.cleanup();
        }),
      );
    },
  };
}

export type WorkspaceSync = ReturnType<typeof createWorkspaceSync>;
