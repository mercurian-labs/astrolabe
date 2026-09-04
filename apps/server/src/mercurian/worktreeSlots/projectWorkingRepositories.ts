import type { MercurianProjectId } from "@t3tools/contracts";

import type { MemorySource } from "../memory/schema.ts";
import type { RepositoriesSnapshot } from "../repositories/RepositoryStore.ts";
import type { RepositoryView } from "../repositories/schema.ts";

/** The repositories that participate in a project's line branches and slots. */
export function projectWorkingRepositories(
  snapshot: RepositoriesSnapshot,
  projectId: MercurianProjectId,
  memorySource: MemorySource | null,
): ReadonlyArray<RepositoryView> {
  const repositoryIds = snapshot.projectRepositories
    .filter((link) => link.projectId === projectId)
    .map((link) => link.repositoryId);
  if (memorySource?.projectId === projectId && !repositoryIds.includes(memorySource.repositoryId)) {
    repositoryIds.push(memorySource.repositoryId);
  }
  return repositoryIds.flatMap((repositoryId) => {
    const repository = snapshot.repositories.find(
      (candidate) => candidate.repositoryId === repositoryId,
    );
    return repository === undefined ? [] : [repository];
  });
}
