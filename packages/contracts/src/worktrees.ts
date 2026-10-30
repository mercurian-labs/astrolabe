import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Astrolabe: a repository's worktrees as buckets. A branch is what a person or an agent works on;
 * a worktree is where it happens to be checked out. Opening a branch reuses a free worktree, and
 * uncommitted work on the branch it held is set aside under that branch, not lost.
 */

/** Why a worktree is not free to take another branch. */
export const ProjectWorktreeHold = Schema.Struct({
  kind: Schema.Literals(["main", "external", "kept", "working", "thread", "terminal", "detached"]),
  label: Schema.String,
});
export type ProjectWorktreeHold = typeof ProjectWorktreeHold.Type;

export const ProjectWorktree = Schema.Struct({
  path: TrimmedNonEmptyString,
  /** The repository's own checkout, never reused or deleted here. */
  isMain: Schema.Boolean,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  head: Schema.NullOr(TrimmedNonEmptyString),
  /** What to call it: its branch, or its commit when detached. */
  alias: TrimmedNonEmptyString,
  /** Its number among the repository's worktrees, kept while it exists; null for the main checkout. */
  number: Schema.NullOr(PositiveInt),
  kept: Schema.Boolean,
  holds: Schema.Array(ProjectWorktreeHold),
  changedFiles: NonNegativeInt,
});
export type ProjectWorktree = typeof ProjectWorktree.Type;

/** Uncommitted work a branch left behind when its worktree took another branch. */
export const ProjectWorktreeSetAside = Schema.Struct({
  branch: TrimmedNonEmptyString,
  /** The hidden ref holding it, for an agent asked to look at it. */
  ref: TrimmedNonEmptyString,
  /** The commit it was made on; when the branch has moved on, it is not put back by itself. */
  base: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProjectWorktreeSetAside = typeof ProjectWorktreeSetAside.Type;

export const ProjectWorktreeListInput = Schema.Struct({ projectId: ProjectId });
export type ProjectWorktreeListInput = typeof ProjectWorktreeListInput.Type;

export const ProjectWorktreeListResult = Schema.Struct({
  worktrees: Schema.Array(ProjectWorktree),
  setAside: Schema.Array(ProjectWorktreeSetAside),
});
export type ProjectWorktreeListResult = typeof ProjectWorktreeListResult.Type;

export const ProjectWorktreeOpenInput = Schema.Struct({
  projectId: ProjectId,
  branch: TrimmedNonEmptyString,
  /** A worktree of its own even when one is free; a branch already checked out stays where it is. */
  newWorktree: Schema.optional(Schema.Boolean),
});
export type ProjectWorktreeOpenInput = typeof ProjectWorktreeOpenInput.Type;

export const ProjectWorktreeOpenResult = Schema.Struct({
  worktree: ProjectWorktree,
  /** What happened to work the branch had set aside: none, put back, or left for the person. */
  setAside: Schema.Literals(["none", "restored", "stale"]),
});
export type ProjectWorktreeOpenResult = typeof ProjectWorktreeOpenResult.Type;

/** A new branch, from `base`, in a free worktree, or a new one (always with `newWorktree`). */
export const ProjectWorktreeCreateInput = Schema.Struct({
  projectId: ProjectId,
  branch: TrimmedNonEmptyString,
  base: TrimmedNonEmptyString,
  newWorktree: Schema.optional(Schema.Boolean),
});
export type ProjectWorktreeCreateInput = typeof ProjectWorktreeCreateInput.Type;

export const ProjectWorktreeRemoveInput = Schema.Struct({
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
  /** False asks first: with warnings nothing is removed, and the person decides. */
  confirmed: Schema.Boolean,
});
export type ProjectWorktreeRemoveInput = typeof ProjectWorktreeRemoveInput.Type;

export const ProjectWorktreeRemoveResult = Schema.Struct({
  removed: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
});
export type ProjectWorktreeRemoveResult = typeof ProjectWorktreeRemoveResult.Type;

export const ProjectWorktreeSetKeptInput = Schema.Struct({
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
  kept: Schema.Boolean,
});
export type ProjectWorktreeSetKeptInput = typeof ProjectWorktreeSetKeptInput.Type;

export const ProjectWorktreeDiscardSetAsideInput = Schema.Struct({
  projectId: ProjectId,
  branch: TrimmedNonEmptyString,
});
export type ProjectWorktreeDiscardSetAsideInput = typeof ProjectWorktreeDiscardSetAsideInput.Type;

/** One of a project's worktrees, by its folder, to follow changes on disk in. */
export const ProjectWorktreeChangesInput = Schema.Struct({
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
});
export type ProjectWorktreeChangesInput = typeof ProjectWorktreeChangesInput.Type;

/**
 * Something changed in a worktree. `directories` are the folders whose listing changed, relative
 * to the worktree ("" is its top); empty when only file contents or git state did, null when too
 * many changed to name. `unwatched` says it can't be watched, so nothing more will come.
 */
export const ProjectWorktreeChange = Schema.Union([
  Schema.TaggedStruct("changed", { directories: Schema.NullOr(Schema.Array(Schema.String)) }),
  Schema.TaggedStruct("unwatched", { reason: Schema.String }),
]);
export type ProjectWorktreeChange = typeof ProjectWorktreeChange.Type;

export class ProjectWorktreeError extends Schema.TaggedError<ProjectWorktreeError>()(
  "ProjectWorktreeError",
  { message: Schema.String },
) {}
