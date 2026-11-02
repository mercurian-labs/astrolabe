import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { WikiId } from "./wiki.ts";

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

/** Which tool made a linked worktree, told by the folder it is in; null for the main checkout. */
export const ProjectWorktreeMaker = Schema.Literals([
  "astrolabe",
  "claude-code",
  "t3-code",
  "codex",
  "other",
]);
export type ProjectWorktreeMaker = typeof ProjectWorktreeMaker.Type;

export const ProjectWorktree = Schema.Struct({
  path: TrimmedNonEmptyString,
  /** The repository's own checkout, never reused or deleted here. */
  isMain: Schema.Boolean,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  head: Schema.NullOr(TrimmedNonEmptyString),
  /** What to call it: its branch, or its commit when detached. */
  alias: TrimmedNonEmptyString,
  /**
   * Its number among the repository's worktrees, given the first time something is opened in it
   * and kept while it exists; null for the main checkout and for worktrees never opened.
   */
  number: Schema.NullOr(PositiveInt),
  madeBy: Schema.NullOr(ProjectWorktreeMaker),
  /** When its branch last moved or its top folder last changed; null when unreadable. */
  lastActiveAt: Schema.NullOr(IsoDateTime),
  kept: Schema.Boolean,
  holds: Schema.Array(ProjectWorktreeHold),
  /**
   * Its uncommitted files; null in a list, where counting every worktree would run git status in
   * each (`worktrees.status` counts one).
   */
  changedFiles: Schema.NullOr(NonNegativeInt),
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

/**
 * Whose repository the worktrees are in: a project's, or a wiki's own folder (a wiki is no
 * project). Exactly one is given.
 */
const OwnerFields = {
  projectId: Schema.optionalKey(ProjectId),
  wikiId: Schema.optionalKey(WikiId),
};

/** The owner as clients name it, with exactly one of the two. */
export type ProjectWorktreeOwner = { readonly projectId: ProjectId } | { readonly wikiId: WikiId };

export const ProjectWorktreeListInput = Schema.Struct(OwnerFields);
export type ProjectWorktreeListInput = typeof ProjectWorktreeListInput.Type;

export const ProjectWorktreeListResult = Schema.Struct({
  worktrees: Schema.Array(ProjectWorktree),
  setAside: Schema.Array(ProjectWorktreeSetAside),
});
export type ProjectWorktreeListResult = typeof ProjectWorktreeListResult.Type;

export const ProjectWorktreeOpenInput = Schema.Struct({
  ...OwnerFields,
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
  ...OwnerFields,
  branch: TrimmedNonEmptyString,
  base: TrimmedNonEmptyString,
  newWorktree: Schema.optional(Schema.Boolean),
});
export type ProjectWorktreeCreateInput = typeof ProjectWorktreeCreateInput.Type;

export const ProjectWorktreeRemoveInput = Schema.Struct({
  ...OwnerFields,
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
  ...OwnerFields,
  path: TrimmedNonEmptyString,
  kept: Schema.Boolean,
});
export type ProjectWorktreeSetKeptInput = typeof ProjectWorktreeSetKeptInput.Type;

export const ProjectWorktreeDiscardSetAsideInput = Schema.Struct({
  ...OwnerFields,
  branch: TrimmedNonEmptyString,
});
export type ProjectWorktreeDiscardSetAsideInput = typeof ProjectWorktreeDiscardSetAsideInput.Type;

/** One of a repository's worktrees, by its folder. */
export const ProjectWorktreeTargetInput = Schema.Struct({
  ...OwnerFields,
  path: TrimmedNonEmptyString,
});
export type ProjectWorktreeTargetInput = typeof ProjectWorktreeTargetInput.Type;

export const ProjectWorktreeStatusResult = Schema.Struct({ changedFiles: NonNegativeInt });
export type ProjectWorktreeStatusResult = typeof ProjectWorktreeStatusResult.Type;

/** One of a project's worktrees, by its folder, to follow changes on disk in. */
export const ProjectWorktreeChangesInput = Schema.Struct({
  ...OwnerFields,
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
