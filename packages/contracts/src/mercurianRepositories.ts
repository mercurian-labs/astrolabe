/**
 * Mercurian's repository surface on the wire: the registry of codebases the
 * app can reach, the scripts declared on each, and the project sets they
 * belong to.
 *
 * A repository is a registered codebase — a third thing beside t3code's
 * {@link RepositoryIdentity} (a git-remote-derived fact about a workspace) and
 * `SourceControlRepositoryInfo` (a provider's view of a remote), so it carries
 * the `Mercurian` prefix the fork's seam rule gives every Mercurian-side name.
 *
 * Three facts are deliberately derived rather than stored, and so travel on the
 * snapshot without a column behind them:
 *
 * - `hasGit`, probed live. Git is expected but not demanded at add time —
 *   grounding reads files regardless, and everything working-tree-shaped
 *   lights up when the directory actually becomes a repository;
 * - `hosting`, derived from the repository's fetch remotes. Hosting is detected,
 *   never configured or assigned;
 * - a repository's *environment*, which is a fact about which server answered,
 *   not data. Environments are plumbing and never navigational.
 *
 * Project sets ride this snapshot rather than the planning tree's: a set
 * changes when a repository is added, removed, or reassigned, which is this
 * surface's signal. The set is context and never a stamp — no plan is filed
 * under a repository, and there is no column anywhere that could file one.
 *
 * @module MercurianRepositoryContracts
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { MercurianProjectId } from "./mercurian.ts";
import { SourceControlProviderKind } from "./sourceControl.ts";

export const MERCURIAN_REPOSITORY_WS_METHODS = {
  subscribeRepositories: "mercurian.subscribeRepositories",
  refreshRepositories: "mercurian.refreshRepositories",
  addRepository: "mercurian.addRepository",
  removeRepository: "mercurian.removeRepository",
  saveRepositoryScripts: "mercurian.saveRepositoryScripts",
  setProjectRepositories: "mercurian.setProjectRepositories",
} as const;

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const MercurianRepositoryId = makeEntityId("MercurianRepositoryId");
export type MercurianRepositoryId = typeof MercurianRepositoryId.Type;

/** Slug-shaped and minted by the server from the script's name. */
export const MercurianRepositoryScriptId = makeEntityId("MercurianRepositoryScriptId");
export type MercurianRepositoryScriptId = typeof MercurianRepositoryScriptId.Type;

/**
 * A script as it is declared on a repository: app-owned and per-machine, so
 * nothing is ever written into the repository itself.
 *
 * `previewUrl` is the address the script serves at when it serves one, and
 * `isSetup` marks the ones a fresh worktree runs before anything else.
 * Execution is the session view's — this surface only declares.
 */
export const MercurianRepositoryScript = Schema.Struct({
  scriptId: MercurianRepositoryScriptId,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  isSetup: Schema.Boolean,
});
export type MercurianRepositoryScript = typeof MercurianRepositoryScript.Type;

/**
 * A script on its way in. `scriptId` is absent for a newly declared script and
 * present for an edited one — the server mints ids, and carrying an existing
 * one is what keeps an edit stable rather than making a second script.
 */
export const MercurianRepositoryScriptInput = Schema.Struct({
  scriptId: Schema.optional(MercurianRepositoryScriptId),
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  isSetup: Schema.Boolean,
});
export type MercurianRepositoryScriptInput = typeof MercurianRepositoryScriptInput.Type;

/** A hosting fact derived from the repository's primary fetch remote. */
export const MercurianRepositoryHosting = Schema.Struct({
  provider: SourceControlProviderKind,
  providerName: TrimmedNonEmptyString,
  remoteName: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
});
export type MercurianRepositoryHosting = typeof MercurianRepositoryHosting.Type;

/**
 * A registered codebase. `path` is where its files are on the environment that
 * holds it; `hasGit` is probed live at read time, so it flips on its own once
 * someone runs `git init` and nothing has to be rescanned by hand.
 */
export const MercurianRepository = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  hasGit: Schema.Boolean,
  hosting: Schema.NullOr(MercurianRepositoryHosting),
  scripts: Schema.Array(MercurianRepositoryScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MercurianRepository = typeof MercurianRepository.Type;

/** A project's repository set, one pair per membership. */
export const ProjectRepositoryLink = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
});
export type ProjectRepositoryLink = typeof ProjectRepositoryLink.Type;

/**
 * Everything the Repositories page and every project-set consumer read, in one
 * value. Repositories are few and move only on discrete human acts, so the
 * subscription re-sends the whole snapshot rather than carrying deltas.
 */
export const MercurianRepositoriesSnapshot = Schema.Struct({
  repositories: Schema.Array(MercurianRepository),
  projectRepositories: Schema.Array(ProjectRepositoryLink),
});
export type MercurianRepositoriesSnapshot = typeof MercurianRepositoriesSnapshot.Type;

export const MercurianRepositoriesStreamItem = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  snapshot: MercurianRepositoriesSnapshot,
});
export type MercurianRepositoriesStreamItem = typeof MercurianRepositoriesStreamItem.Type;

// ===============================
// Inputs
// ===============================

export const MercurianSubscribeRepositoriesInput = Schema.Struct({});
export type MercurianSubscribeRepositoriesInput = typeof MercurianSubscribeRepositoriesInput.Type;

export const MercurianRefreshRepositoriesInput = Schema.Struct({});
export type MercurianRefreshRepositoriesInput = typeof MercurianRefreshRepositoriesInput.Type;

/**
 * Register a directory. Git is deliberately not required: a directory that is
 * not a repository is still something grounding can read, and the working-tree
 * features simply stay absent until it becomes one.
 *
 * `name` is optional — the path's last segment is what a person would call it
 * when they do not say otherwise.
 */
export const MercurianAddRepositoryInput = Schema.Struct({
  path: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
});
export type MercurianAddRepositoryInput = typeof MercurianAddRepositoryInput.Type;

/**
 * Removal is disconnection: the row, its scripts, and its project memberships
 * go; the files on disk stay, and grounding references already written into
 * plan histories stay as record. It is refused while live worktrees exist.
 */
export const MercurianRemoveRepositoryInput = Schema.Struct({
  repositoryId: MercurianRepositoryId,
});
export type MercurianRemoveRepositoryInput = typeof MercurianRemoveRepositoryInput.Type;

/**
 * The repository's whole script list after the edit. Scripts are few and
 * human-edited, so a list replace is the shape the editor already has —
 * per-script choreography would buy nothing.
 */
export const MercurianSaveRepositoryScriptsInput = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  scripts: Schema.Array(MercurianRepositoryScriptInput),
});
export type MercurianSaveRepositoryScriptsInput = typeof MercurianSaveRepositoryScriptsInput.Type;

/** The project's whole set after the edit — the checkbox list's own shape. */
export const MercurianSetProjectRepositoriesInput = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryIds: Schema.Array(MercurianRepositoryId),
});
export type MercurianSetProjectRepositoriesInput = typeof MercurianSetProjectRepositoriesInput.Type;

// ===============================
// Refusals
// ===============================

export class MercurianRepositoryNotFoundError extends Schema.TaggedErrorClass<MercurianRepositoryNotFoundError>()(
  "MercurianRepositoryNotFoundError",
  { repositoryId: MercurianRepositoryId },
) {
  override get message(): string {
    return `Repository ${this.repositoryId} does not exist`;
  }
}

/**
 * The path is already registered. The existing row rides along so the add
 * dialog can name it rather than making the person go looking.
 */
export class RepositoryAlreadyRegisteredError extends Schema.TaggedErrorClass<RepositoryAlreadyRegisteredError>()(
  "RepositoryAlreadyRegisteredError",
  {
    repositoryId: MercurianRepositoryId,
    name: TrimmedNonEmptyString,
    path: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `${this.path} is already registered as ${this.name}`;
  }
}

/** The path does not exist, or is not a directory. */
export class RepositoryPathInvalidError extends Schema.TaggedErrorClass<RepositoryPathInvalidError>()(
  "RepositoryPathInvalidError",
  { path: TrimmedNonEmptyString, reason: Schema.Literals(["missing", "not-a-directory"]) },
) {
  override get message(): string {
    return this.reason === "missing"
      ? `${this.path} does not exist`
      : `${this.path} is not a directory`;
  }
}

/**
 * The teardown floor: a repository the app is holding open workspaces on
 * cannot be disconnected. There is no force flag by design — the way out is
 * to end the sessions.
 */
export class RepositoryHasLiveWorktreesError extends Schema.TaggedErrorClass<RepositoryHasLiveWorktreesError>()(
  "RepositoryHasLiveWorktreesError",
  { repositoryId: MercurianRepositoryId, worktreeCount: Schema.Number },
) {
  override get message(): string {
    return this.worktreeCount === 1
      ? "This repository has a live worktree"
      : `This repository has ${this.worktreeCount} live worktrees`;
  }
}

export const isMercurianRepositoryNotFoundError = Schema.is(MercurianRepositoryNotFoundError);
export const isRepositoryAlreadyRegisteredError = Schema.is(RepositoryAlreadyRegisteredError);
export const isRepositoryPathInvalidError = Schema.is(RepositoryPathInvalidError);
export const isRepositoryHasLiveWorktreesError = Schema.is(RepositoryHasLiveWorktreesError);

/**
 * Everything below the repository surface a client cannot act on: storage
 * failures, decode failures, and probe failures. The underlying failure rides
 * as `cause` so the server log keeps the chain.
 */
export class MercurianRepositoryError extends Schema.TaggedErrorClass<MercurianRepositoryError>()(
  "MercurianRepositoryError",
  {
    operation: Schema.Literals([
      "subscribeRepositories",
      "refreshRepositories",
      "addRepository",
      "removeRepository",
      "saveRepositoryScripts",
      "setProjectRepositories",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian repository operation ${this.operation} failed`;
  }
}
