import { createWorkspaceSync, type WorkspaceSync } from "@t3tools/client-runtime/workspaces";

import { cloudConnection, useCloudAccountState } from "./account";

let current: WorkspaceSync | null = null;

/**
 * The workspace collections for one person, created on first use. Another
 * person, or nobody, closes the previous set so no shape outlives the
 * session it was scoped to; a set that stopped while nobody read it is
 * replaced rather than restarted.
 */
function workspaceSyncFor(userId: string | null): WorkspaceSync | null {
  if (current !== null && (current.userId !== userId || current.stopped)) {
    void current.close();
    current = null;
  }
  if (current === null && userId !== null) {
    const connection = cloudConnection();
    if (connection !== null) current = createWorkspaceSync({ connection, userId });
  }
  return current;
}

/** The signed-in person's workspace collections, shared by every surface. */
export function useWorkspaceSync(): WorkspaceSync | null {
  const account = useCloudAccountState();
  return workspaceSyncFor(account.status === "signedIn" ? account.user.id : null);
}
