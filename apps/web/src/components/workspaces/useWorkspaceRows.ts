import type { WorkspaceSync } from "@t3tools/client-runtime/workspaces";
import { WorkspaceWriteRefused } from "@t3tools/client-runtime/workspaces";
import { useLiveQuery } from "@tanstack/react-db";
import { useCallback, useState } from "react";

import { toastManager } from "../ui/toast";
import type { WorkspaceRows } from "@t3tools/client-runtime/workspaces";

const NONE: ReadonlyArray<never> = [];

/**
 * Every workspace row synced to this device. Each collection syncs only while
 * a surface reads it, so the shapes stop soon after the page closes.
 */
export function useWorkspaceRows(sync: WorkspaceSync | null): {
  readonly rows: WorkspaceRows;
  readonly ready: boolean;
} {
  const c = sync?.collections;
  const workspaces = useLiveQuery((q) => (c ? q.from({ row: c.workspaces }) : null), [c]);
  const members = useLiveQuery((q) => (c ? q.from({ row: c.members }) : null), [c]);
  const people = useLiveQuery((q) => (c ? q.from({ row: c.people }) : null), [c]);
  const teams = useLiveQuery((q) => (c ? q.from({ row: c.teams }) : null), [c]);
  const teamMembers = useLiveQuery((q) => (c ? q.from({ row: c.teamMembers }) : null), [c]);
  const teamOwners = useLiveQuery((q) => (c ? q.from({ row: c.teamOwners }) : null), [c]);
  const invitations = useLiveQuery((q) => (c ? q.from({ row: c.invitations }) : null), [c]);
  return {
    rows: {
      workspaces: workspaces.data ?? NONE,
      members: members.data ?? NONE,
      people: people.data ?? NONE,
      teams: teams.data ?? NONE,
      teamMembers: teamMembers.data ?? NONE,
      teamOwners: teamOwners.data ?? NONE,
      invitations: invitations.data ?? NONE,
    },
    // The page waits for the rows that decide what it shows.
    ready: workspaces.isReady === true && members.isReady === true,
  };
}

/**
 * Runs a workspace write with a pending state, and tells the person why the
 * cloud refused it. Resolves true once the change is on this device.
 */
export function useWorkspaceAction() {
  const [pending, setPending] = useState(false);
  const run = useCallback(async (title: string, action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title,
        description:
          error instanceof WorkspaceWriteRefused
            ? error.message
            : "Astrolabe couldn't reach the cloud. Try again.",
      });
      return false;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, run };
}
