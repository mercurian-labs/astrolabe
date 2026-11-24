import {
  selectedWorkspace,
  workspaceMemberships,
  type WorkspaceMembership,
} from "@t3tools/client-runtime/workspaces";
import { useLiveQuery } from "@tanstack/react-db";
import * as Schema from "effect/Schema";

import { useCloudAccountState } from "../../cloud/account";
import { useWorkspaceSync } from "../../cloud/workspaces";
import { useLocalStorage } from "../../hooks/useLocalStorage";

const SavedWorkspaceId = Schema.NullOr(Schema.String);
const NONE: ReadonlyArray<never> = [];

type SelectedWorkspaceState =
  | { readonly status: "loading" }
  | { readonly status: "signedOut" }
  | {
      readonly status: "ready";
      readonly memberships: ReadonlyArray<WorkspaceMembership>;
      readonly selected: WorkspaceMembership | null;
      /** Settings › Workspaces offers New workspace on the same terms. */
      readonly canStartWorkspace: boolean;
      readonly select: (workspaceId: string | null) => void;
    };

/**
 * The workspace this device has selected, kept per person in local storage. It is never the
 * cloud's active organization: a server-side "current" one would let writes queued offline land
 * in whichever workspace was current when they finally sent.
 */
export function useSelectedWorkspace(): SelectedWorkspaceState {
  const account = useCloudAccountState();
  const sync = useWorkspaceSync();
  const c = sync?.collections;
  const workspaces = useLiveQuery((q) => (c ? q.from({ row: c.workspaces }) : null), [c]);
  const members = useLiveQuery((q) => (c ? q.from({ row: c.members }) : null), [c]);
  const userId = account.status === "signedIn" ? account.user.id : null;
  const [savedId, setSavedId] = useLocalStorage(
    `astrolabe:selected-workspace:${userId ?? ""}`,
    null,
    SavedWorkspaceId,
  );

  if (account.status === "signedOut") return { status: "signedOut" };
  if (
    account.status === "loading" ||
    sync === null ||
    workspaces.isReady !== true ||
    members.isReady !== true
  ) {
    return { status: "loading" };
  }
  const memberships = workspaceMemberships(
    { workspaces: workspaces.data ?? NONE, members: members.data ?? NONE },
    sync.userId,
  );
  return {
    status: "ready",
    memberships,
    selected: selectedWorkspace(memberships, savedId),
    canStartWorkspace:
      account.user.access === "approved" && !memberships.some((m) => m.myRole === "owner"),
    select: setSavedId,
  };
}
