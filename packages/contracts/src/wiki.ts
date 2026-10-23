import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** Astrolabe: local wikis. A wiki is a git repository of linked markdown notes. */
export const WikiId = TrimmedNonEmptyString.pipe(Schema.brand("WikiId"));
export type WikiId = typeof WikiId.Type;
export const WikiChangeRequestId = TrimmedNonEmptyString.pipe(Schema.brand("WikiChangeRequestId"));
export type WikiChangeRequestId = typeof WikiChangeRequestId.Type;

export const WikiErrorReason = Schema.Literals([
  "not-found",
  "invalid",
  "conflict",
  "stale",
  "checkout-busy",
  "git-unavailable",
  "git-failed",
]);
export type WikiErrorReason = typeof WikiErrorReason.Type;

export class WikiError extends Schema.TaggedError<WikiError>()("WikiError", {
  message: Schema.String,
  reason: WikiErrorReason,
  wikiId: Schema.optional(WikiId),
  changeRequestId: Schema.optional(WikiChangeRequestId),
  cause: Schema.optional(Schema.Defect()),
}) {}

export const WikiMirrorStatus = Schema.Struct({
  url: TrimmedNonEmptyString,
  lastPushedAt: Schema.NullOr(IsoDateTime),
  lastPushedCommit: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  /** When a push last replaced commits that were made on the mirror directly. */
  overwroteRemoteAt: Schema.NullOr(IsoDateTime),
});
export type WikiMirrorStatus = typeof WikiMirrorStatus.Type;

export const WikiSummary = Schema.Struct({
  wikiId: WikiId,
  name: TrimmedNonEmptyString,
  /** Absolute path of the checkout of the main line. */
  root: TrimmedNonEmptyString,
  mainBranch: TrimmedNonEmptyString,
  /** The T3 project standing in the same folder, when one exists. */
  projectId: Schema.NullOr(ProjectId),
  mirror: Schema.NullOr(WikiMirrorStatus),
  openChangeRequests: NonNegativeInt,
  createdAt: IsoDateTime,
});
export type WikiSummary = typeof WikiSummary.Type;

export const WikiListResult = Schema.Struct({ wikis: Schema.Array(WikiSummary) });
export type WikiListResult = typeof WikiListResult.Type;

export const WikiRegisterInput = Schema.Struct({
  /** An existing git repository's top-level folder. */
  root: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
});
export type WikiRegisterInput = typeof WikiRegisterInput.Type;

export const WikiCreateInput = Schema.Struct({ name: TrimmedNonEmptyString });
export type WikiCreateInput = typeof WikiCreateInput.Type;

export const WikiTarget = Schema.Struct({ wikiId: WikiId });
export type WikiTarget = typeof WikiTarget.Type;

export const WikiEdgeRef = Schema.Struct({
  from: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
});
export const WikiEdge = Schema.Struct({
  from: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
  rationale: TrimmedNonEmptyString,
});

export const WikiIndexError = Schema.Struct({
  file: Schema.String,
  error: Schema.String,
  edge: Schema.optional(WikiEdgeRef),
});
export type WikiIndexError = typeof WikiIndexError.Type;

export const WikiNoteSummary = Schema.Struct({
  name: Schema.String,
  file: Schema.String,
  outgoing: NonNegativeInt,
  incoming: NonNegativeInt,
  /** When the last commit touching the note's file was made, on the line read. */
  editedAt: Schema.optional(IsoDateTime),
});
export const WikiMapSummary = Schema.Struct({
  file: Schema.String,
  name: Schema.String,
  purpose: Schema.String,
  edgeCount: NonNegativeInt,
  openWarnings: NonNegativeInt,
});
export const WikiUnresolved = Schema.Struct({
  name: Schema.String,
  sources: Schema.Array(Schema.String),
});

/** Reads come from a change request's head when one is named, else from the main line. */
export const WikiReadScope = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: Schema.optional(WikiChangeRequestId),
});
export type WikiReadScope = typeof WikiReadScope.Type;

/** One wikilink between two notes (or toward a red link); one entry per linked pair. */
export const WikiLinkEdge = Schema.Struct({ from: Schema.String, to: Schema.String });

export const WikiIndexResult = Schema.Struct({
  wikiId: WikiId,
  commit: Schema.String,
  notes: Schema.Array(WikiNoteSummary),
  /** Every note-to-note link, by note name, so a client can draw the wiki's graph. */
  links: Schema.Array(WikiLinkEdge),
  maps: Schema.Array(WikiMapSummary),
  unresolved: Schema.Array(WikiUnresolved),
  errors: Schema.Array(WikiIndexError),
});
export type WikiIndexResult = typeof WikiIndexResult.Type;

export const WikiNoteInput = Schema.Struct({
  wikiId: WikiId,
  name: TrimmedNonEmptyString,
  changeRequestId: Schema.optional(WikiChangeRequestId),
});
export type WikiNoteInput = typeof WikiNoteInput.Type;

export const WikiNoteResult = Schema.Struct({
  wikiId: WikiId,
  commit: Schema.String,
  name: Schema.String,
  file: Schema.String,
  /** False for a red link: the note is named but not written. */
  exists: Schema.Boolean,
  source: Schema.String,
  outgoing: Schema.Array(Schema.String),
  incoming: Schema.Array(Schema.String),
});
export type WikiNoteResult = typeof WikiNoteResult.Type;

export const WikiChangeRequestStatus = Schema.Literals(["open", "merged", "closed"]);
export type WikiChangeRequestStatus = typeof WikiChangeRequestStatus.Type;

export const WikiAmendmentSummary = Schema.Struct({
  commit: Schema.String,
  amendment: Schema.String,
  actor: Schema.String,
  subject: Schema.String,
  at: IsoDateTime,
  files: Schema.Array(Schema.String),
  /** The commit this amendment reverts, when it is a revert. */
  reverts: Schema.NullOr(Schema.String),
});
export type WikiAmendmentSummary = typeof WikiAmendmentSummary.Type;

export const WikiChangeRequest = Schema.Struct({
  changeRequestId: WikiChangeRequestId,
  wikiId: WikiId,
  title: TrimmedNonEmptyString,
  status: WikiChangeRequestStatus,
  branch: Schema.String,
  /** The main-line commit the change request started from. */
  base: Schema.String,
  head: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  createdBy: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  mergedCommit: Schema.NullOr(Schema.String),
  amendments: Schema.Array(WikiAmendmentSummary),
});
export type WikiChangeRequest = typeof WikiChangeRequest.Type;

export const WikiChangeRequestListInput = Schema.Struct({
  wikiId: Schema.optional(WikiId),
  threadId: Schema.optional(ThreadId),
  status: Schema.optional(WikiChangeRequestStatus),
});
export type WikiChangeRequestListInput = typeof WikiChangeRequestListInput.Type;

export const WikiChangeRequestListResult = Schema.Struct({
  changeRequests: Schema.Array(WikiChangeRequest),
});
export type WikiChangeRequestListResult = typeof WikiChangeRequestListResult.Type;

export const WikiChangeRequestTarget = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId,
});
export type WikiChangeRequestTarget = typeof WikiChangeRequestTarget.Type;

export const WikiFileChange = Schema.Struct({
  file: Schema.String,
  /** The file on the change request's base; null when the change request adds it. */
  before: Schema.NullOr(Schema.String),
  /** The file at the change request's head; null when the change request deletes it. */
  after: Schema.NullOr(Schema.String),
});
export type WikiFileChange = typeof WikiFileChange.Type;

export const WikiMergePreview = Schema.Struct({
  status: Schema.Literals(["clean", "conflict", "up-to-date"]),
  conflicts: Schema.Array(Schema.String),
  /** Index errors standing on the merged result. */
  errors: Schema.Array(WikiIndexError),
});
export type WikiMergePreview = typeof WikiMergePreview.Type;

export const WikiChangeRequestDetail = Schema.Struct({
  changeRequest: WikiChangeRequest,
  files: Schema.Array(WikiFileChange),
  mergePreview: WikiMergePreview,
  errors: Schema.Array(WikiIndexError),
});
export type WikiChangeRequestDetail = typeof WikiChangeRequestDetail.Type;

export const WikiChangeRequestOpenInput = Schema.Struct({
  wikiId: WikiId,
  title: TrimmedNonEmptyString,
});
export type WikiChangeRequestOpenInput = typeof WikiChangeRequestOpenInput.Type;

/** Where an amendment lands: a named change request, or a new one opened with `title`. */
const WikiWriteTarget = {
  wikiId: WikiId,
  changeRequestId: Schema.optional(WikiChangeRequestId),
  title: Schema.optional(TrimmedNonEmptyString),
  message: TrimmedNonEmptyString,
};

export const WikiAmendInput = Schema.Struct({
  ...WikiWriteTarget,
  /** Whole new content per changed note; null deletes the note. */
  changes: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
});
export type WikiAmendInput = typeof WikiAmendInput.Type;

export const WikiTransform = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("rename"),
    from: TrimmedNonEmptyString,
    to: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("edge-add"),
    map: TrimmedNonEmptyString,
    edge: WikiEdge,
    meaning: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("edge-remove"),
    map: TrimmedNonEmptyString,
    edge: WikiEdgeRef,
  }),
  Schema.Struct({
    kind: Schema.Literal("fill"),
    map: TrimmedNonEmptyString,
    name: TrimmedNonEmptyString,
    content: Schema.String,
    edge: WikiEdge,
    meaning: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("resolve-warning"),
    map: TrimmedNonEmptyString,
    id: TrimmedNonEmptyString,
    text: TrimmedNonEmptyString,
  }),
]);
export type WikiTransform = typeof WikiTransform.Type;

export const WikiTransformInput = Schema.Struct({ ...WikiWriteTarget, transform: WikiTransform });
export type WikiTransformInput = typeof WikiTransformInput.Type;

export const WikiAmendResult = Schema.Struct({
  changeRequest: WikiChangeRequest,
  commit: Schema.String,
  amendment: Schema.String,
  /** Index errors standing after the amendment, stale map edges included. */
  errors: Schema.Array(WikiIndexError),
});
export type WikiAmendResult = typeof WikiAmendResult.Type;

export const WikiRevertInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId,
  commit: TrimmedNonEmptyString,
});
export type WikiRevertInput = typeof WikiRevertInput.Type;

export const WikiMergeResult = Schema.Struct({
  changeRequest: WikiChangeRequest,
  commit: Schema.String,
});
export type WikiMergeResult = typeof WikiMergeResult.Type;

/** Close a change request, or reopen a closed one. */
export const WikiSetChangeRequestStatusInput = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: WikiChangeRequestId,
  status: Schema.Literals(["open", "closed"]),
});
export type WikiSetChangeRequestStatusInput = typeof WikiSetChangeRequestStatusInput.Type;

export const WikiSetMirrorInput = Schema.Struct({
  wikiId: WikiId,
  /** A git remote URL the main line is pushed to after every merge; null stops mirroring. */
  url: Schema.NullOr(TrimmedNonEmptyString),
});
export type WikiSetMirrorInput = typeof WikiSetMirrorInput.Type;

export const WikiEventKind = Schema.Literals([
  "registered",
  "removed",
  "amended",
  "merged",
  "status",
  "mirror",
  "main-moved",
]);

/** Pushed to subscribers after any change, so open views know to read again. */
export const WikiEvent = Schema.Struct({
  wikiId: WikiId,
  changeRequestId: Schema.NullOr(WikiChangeRequestId),
  kind: WikiEventKind,
  at: IsoDateTime,
});
export type WikiEvent = typeof WikiEvent.Type;
