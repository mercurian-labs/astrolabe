/**
 * The commit DAG's domain schemas.
 *
 * Everything in a planning space is a commit in one branching, merging
 * history. Commits are heterogeneous along two axes — what they are
 * ({@link CommitKind}) and who made them ({@link CommitAuthorKind}) — and a
 * commit's `parents` list is unbounded: zero for a root, one for an ordinary
 * continuation, two or more for a merge.
 *
 * These stay server-side until something crosses the wire; `packages/contracts`
 * is the wire boundary and the planning surface has not landed yet.
 *
 * @module CommitTreeSchema
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "@t3tools/contracts";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const HistoryId = makeEntityId("HistoryId");
export type HistoryId = typeof HistoryId.Type;

export const CommitId = makeEntityId("CommitId");
export type CommitId = typeof CommitId.Type;

/**
 * What a commit is. `message` is the only kind anything writes today; the
 * other three are representable now so the features that write them land
 * without schema surgery.
 */
export const CommitKind = Schema.Literals([
  "message",
  "plan-revision",
  "issue-revision",
  "coding-session",
]);
export type CommitKind = typeof CommitKind.Type;

/** Who made a commit. Forks and merges are human-driven only. */
export const CommitAuthorKind = Schema.Literals(["human", "assistant"]);
export type CommitAuthorKind = typeof CommitAuthorKind.Type;

/**
 * Read filter. `published` is what a shared workspace would ever see;
 * `all` is the author's own workspace, which sees its drafts too.
 */
export const CommitVisibility = Schema.Literals(["published", "all"]);
export type CommitVisibility = typeof CommitVisibility.Type;

/** A planning space's history — the anchor its commits hang from. */
export const CommitHistory = Schema.Struct({
  historyId: HistoryId,
  createdAt: Schema.DateTimeUtcFromString,
});
export type CommitHistory = typeof CommitHistory.Type;

export const Commit = Schema.Struct({
  commitId: CommitId,
  historyId: HistoryId,
  kind: CommitKind,
  authorKind: CommitAuthorKind,
  /** Ordered and unbounded. Empty for the root. */
  parents: Schema.Array(CommitId),
  published: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromString,
  /**
   * Opaque to the store. Kind-specific content schemas arrive with the
   * features that write them; the store only guarantees it round-trips.
   */
  payload: Schema.Unknown,
});
export type Commit = typeof Commit.Type;

/** A commit before it has a place in the graph. */
export const NewCommit = Schema.Struct({
  commitId: CommitId,
  kind: CommitKind,
  authorKind: CommitAuthorKind,
  createdAt: Schema.DateTimeUtcFromString,
  payload: Schema.Unknown,
});
export type NewCommit = typeof NewCommit.Type;
