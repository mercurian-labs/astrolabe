import type { ThreadId, WorktreeSetupSnapshot } from "@t3tools/contracts";

/** A subscription can close or replay an older value during the setup handoff. */
export function resolveWorktreeSetupSnapshot(
  threadId: ThreadId | null,
  latest: WorktreeSetupSnapshot | null | undefined,
  held: WorktreeSetupSnapshot | null,
): WorktreeSetupSnapshot | null {
  const current = latest?.threadId === threadId ? latest : null;
  // The server answers null only after a setup ends, so a held running snapshot missed its finish.
  const previous =
    held?.threadId === threadId && !(latest === null && held.phase === "running") ? held : null;
  return current && (!previous || current.sequence >= previous.sequence) ? current : previous;
}
