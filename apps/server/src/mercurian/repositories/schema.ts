/**
 * Repositories as the store holds them.
 *
 * The identifiers are the contracts' — a repository id means the same thing on
 * both sides of the wire, so there is one brand, not two. What differs here is
 * time: rows carry `DateTime.Utc`, and the wire boundary formats them.
 *
 * `hasGit` and `hosting` are absent from the row type on purpose. They are
 * probed, not stored, and join the value only where the snapshot is assembled.
 *
 * @module RepositorySchema
 */
import * as Schema from "effect/Schema";

import {
  MercurianProjectId,
  MercurianRepositoryId,
  MercurianRepositoryScriptId,
  type SourceControlProviderKind,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";

export { MercurianProjectId, MercurianRepositoryId, MercurianRepositoryScriptId };

/**
 * A script declared on a repository. App-owned and per-machine: it lives in
 * `mercurian.sqlite` and nothing is ever written into the repository.
 */
export const RepositoryScript = Schema.Struct({
  scriptId: MercurianRepositoryScriptId,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  isSetup: Schema.Boolean,
});
export type RepositoryScript = typeof RepositoryScript.Type;

/** A registered codebase, with the scripts declared on it in declared order. */
export const Repository = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  scripts: Schema.Array(RepositoryScript),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type Repository = typeof Repository.Type;

export interface RepositoryHosting {
  readonly provider: SourceControlProviderKind;
  readonly providerName: string;
  readonly remoteName: string;
  readonly remoteUrl: string;
}

/** A repository as a reader sees it: the row plus its live git and hosting probes. */
export interface RepositoryView extends Repository {
  readonly hasGit: boolean;
  readonly hosting: RepositoryHosting | null;
}

/** One membership in a project's repository set. */
export interface ProjectRepositoryLink {
  readonly projectId: MercurianProjectId;
  readonly repositoryId: MercurianRepositoryId;
}
