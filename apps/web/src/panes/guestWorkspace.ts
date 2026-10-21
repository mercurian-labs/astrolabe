import { create } from "zustand";

import { addGuests, guestThreads, type Arrangement } from "./arrangement";
import { loadArrangement, writeArrangement, type StorageLike } from "./persistence";

/**
 * Going to a guest's own workspace, where it is the host. The threads it was with can come
 * along: the workspace's host and its other guests are offered, all chosen at first, and those
 * kept join the guest's workspace as guests. The workspace left behind does not change; the
 * guest stays a guest there.
 */

/** The threads offered to come along to `guest`'s workspace, by scoped key, host first. */
export function companionsOf(
  hostKey: string,
  arrangement: Arrangement,
  guest: string,
): readonly string[] {
  return [hostKey, ...guestThreads(arrangement)].filter(
    (key, index, all) => key !== guest && all.indexOf(key) === index,
  );
}

/**
 * Adds the threads kept to the destination's arrangement on this device, as guests beside its
 * conversation, so they are there when its panes load.
 */
export function bringAlong(
  storage: StorageLike | null,
  destination: string,
  companions: readonly string[],
) {
  const kept = companions.filter((key) => key !== destination);
  if (kept.length === 0) return;
  const arrangement = loadArrangement(storage, destination);
  writeArrangement(storage, destination, addGuests(arrangement, kept));
}

/** Where a thread works: its machine, worktree and branch. */
export interface ThreadPlace {
  readonly environmentId: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
}

/**
 * What a guest's tab says about where it works, when that differs from the host's: its branch
 * (or worktree, or the main checkout) on another worktree, and the machine too on another
 * machine. Null when the two share a workspace, which is when they share files and terminals.
 */
export function workspaceNote(
  guest: ThreadPlace,
  host: ThreadPlace,
  machineLabel: string | null,
): string | null {
  const sameMachine = guest.environmentId === host.environmentId;
  if (sameMachine && guest.worktreePath === host.worktreePath) return null;
  const place =
    guest.branch ??
    (guest.worktreePath
      ? guest.worktreePath.split(/[\\/]/).findLast((part) => part.length > 0)
      : null) ??
    "main checkout";
  return sameMachine ? place : `${place} · ${machineLabel ?? "another machine"}`;
}

/**
 * The threads a pane's New tab menu offers as guests: those the sidebar lists (not archived,
 * not an agent's subagent), other than the host and the guests already here, most recently
 * active first.
 */
export function guestCandidates<
  T extends {
    readonly key: string;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
    readonly lineage: { readonly relationshipToParent: string | null };
  },
>(threads: readonly T[], present: ReadonlySet<string>, limit: number): T[] {
  return threads
    .filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.lineage.relationshipToParent !== "subagent" &&
        !present.has(thread.key),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
}

/** The guest whose workspace the user asked to go to, while its dialog is open. */
export const useGuestWorkspaceRequest = create<{
  readonly guest: string | null;
  readonly open: (guest: string) => void;
  readonly close: () => void;
}>((set) => ({
  guest: null,
  open: (guest) => set({ guest }),
  close: () => set({ guest: null }),
}));
