/**
 * The repository store's values as the wire carries them.
 *
 * One thing changes at this boundary: rows hold `DateTime.Utc`, contracts hold
 * ISO strings. `hasGit` and `hosting` cross as probed facts about the machine
 * at read time, which is the only kind of fact they are.
 *
 * @module RepositoryWire
 */
import * as DateTime from "effect/DateTime";

import type * as Contracts from "@t3tools/contracts";

import type { RepositoriesSnapshot } from "./RepositoryStore.ts";
import type { ProjectRepositoryLink, RepositoryScript, RepositoryView } from "./schema.ts";

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

export const toWireScript = (script: RepositoryScript): Contracts.MercurianRepositoryScript => ({
  scriptId: script.scriptId,
  name: script.name,
  command: script.command,
  ...(script.previewUrl === undefined ? {} : { previewUrl: script.previewUrl }),
  isSetup: script.isSetup,
});

export const toWireRepository = (repository: RepositoryView): Contracts.MercurianRepository => ({
  repositoryId: repository.repositoryId,
  name: repository.name,
  path: repository.path,
  hasGit: repository.hasGit,
  hosting: repository.hosting,
  scripts: repository.scripts.map(toWireScript),
  createdAt: iso(repository.createdAt),
  updatedAt: iso(repository.updatedAt),
});

export const toWireProjectRepositoryLink = (
  link: ProjectRepositoryLink,
): Contracts.ProjectRepositoryLink => ({
  projectId: link.projectId,
  repositoryId: link.repositoryId,
});

export const toWireRepositoriesSnapshot = (
  snapshot: RepositoriesSnapshot,
): Contracts.MercurianRepositoriesSnapshot => ({
  repositories: snapshot.repositories.map(toWireRepository),
  projectRepositories: snapshot.projectRepositories.map(toWireProjectRepositoryLink),
});
