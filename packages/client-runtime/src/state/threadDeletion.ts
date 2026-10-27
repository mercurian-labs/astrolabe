/**
 * What deleting threads removes, for every client's delete confirmation, so
 * the copy says what the server erases. Subagent threads go with their
 * parent; a fork still shows its parent's history, so that waits for it.
 */
export function threadDeletionDetail(count: number): string {
  return count === 1
    ? "Its conversation, attachments, checkpoints, terminal history, and subagent threads are permanently deleted. Forks of it keep that history until they are deleted too."
    : "Their conversations, attachments, checkpoints, terminal history, and subagent threads are permanently deleted. Forks of them keep that history until they are deleted too.";
}
