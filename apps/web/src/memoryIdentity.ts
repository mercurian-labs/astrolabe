/**
 * Identity for an immutable memory document as the reader saw it: the
 * environment, repository, line, reading position, path, and blob. Two
 * readings of the same bytes from different checkpoints or lines are two
 * identities, so tabs and comments never fold one origin into another. Only
 * the resolved target is used; nothing here consults current header state.
 */
import type {
  EnvironmentId,
  MemoryDocumentTarget,
  MemoryReadingPosition,
} from "@t3tools/contracts";

export function memoryReadingKey(reading: MemoryReadingPosition): string {
  switch (reading.kind) {
    case "latest":
      return "latest";
    case "checkpoint":
      return `checkpoint:${reading.commitId}`;
    case "turn":
      return `turn:${reading.threadId}:${reading.turnCount}`;
  }
}

/** Where a read-only document came from, said plainly and only from its immutable target. */
export function memoryReadingLabel(reading: MemoryReadingPosition): string {
  switch (reading.kind) {
    case "latest":
      return "latest captured";
    case "checkpoint":
      return `checkpoint ${reading.commitId.slice(0, 8)}`;
    case "turn":
      return `turn ${reading.turnCount}`;
  }
}

export function memoryDocumentIdentity(
  environmentId: EnvironmentId | string,
  target: MemoryDocumentTarget,
): string {
  const { position } = target;
  return [
    environmentId,
    position.repositoryId,
    position.lineRootCommitId,
    memoryReadingKey(position.reading),
    target.treeOid,
    target.blobOid,
    target.deleted ? "former" : "current",
    target.path,
  ]
    .map(encodeURIComponent)
    .join(":");
}
