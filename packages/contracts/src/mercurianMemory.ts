/** Project-memory designation and the fresh, disk-derived read model. */
import * as Schema from "effect/Schema";

import { EnvironmentId, IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { MercurianCommitId, MercurianProjectId, PlanId } from "./mercurian.ts";
import { MercurianRepositoryId } from "./mercurianRepositories.ts";

export const MERCURIAN_MEMORY_WS_METHODS = {
  subscribeMemorySources: "mercurian.subscribeMemorySources",
  designateMemorySource: "mercurian.designateMemorySource",
  removeMemorySource: "mercurian.removeMemorySource",
  readMemoryCatalog: "mercurian.readMemoryCatalog",
  readMemoryDashboard: "mercurian.readMemoryDashboard",
  readMemoryDocument: "mercurian.readMemoryDocument",
  readMemoryComparison: "mercurian.readMemoryComparison",
  subscribeMemoryInvalidations: "mercurian.subscribeMemoryInvalidations",
  readMemoryIndex: "mercurian.readMemoryIndex",
  readMemoryNote: "mercurian.readMemoryNote",
  readLineMemoryChanges: "mercurian.readLineMemoryChanges",
  markMemoryChangeReviewed: "mercurian.markMemoryChangeReviewed",
  revertMemoryChange: "mercurian.revertMemoryChange",
  mergeMemoryHome: "mercurian.mergeMemoryHome",
  generateProductMap: "mercurian.generateProductMap",
} as const;

export const ProjectMemorySource = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
  subpath: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectMemorySource = typeof ProjectMemorySource.Type;

export const MemorySourcesSnapshot = Schema.Struct({ sources: Schema.Array(ProjectMemorySource) });
export type MemorySourcesSnapshot = typeof MemorySourcesSnapshot.Type;

export const MemorySourcesStreamItem = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  snapshot: MemorySourcesSnapshot,
});
export type MemorySourcesStreamItem = typeof MemorySourcesStreamItem.Type;

export const MemoryMapEdge = Schema.Struct({
  from: Schema.String,
  type: Schema.String,
  to: Schema.String,
});
export type MemoryMapEdge = typeof MemoryMapEdge.Type;

export const MemoryMap = Schema.Struct({
  file: TrimmedNonEmptyString,
  name: Schema.String,
  purpose: Schema.String,
  types: Schema.Array(Schema.Struct({ name: Schema.String, meaning: Schema.String })),
  edges: Schema.Array(MemoryMapEdge),
  view: Schema.optional(Schema.Literals(["tree", "flow", "web"])),
  body: Schema.String,
});
export type MemoryMap = typeof MemoryMap.Type;

export const MemoryMapRefusal = Schema.Struct({
  file: TrimmedNonEmptyString,
  refusal: TrimmedNonEmptyString,
});
export type MemoryMapRefusal = typeof MemoryMapRefusal.Type;

export const MemoryIndex = Schema.Struct({
  notes: Schema.Array(Schema.Struct({ name: TrimmedNonEmptyString, path: TrimmedNonEmptyString })),
  maps: Schema.Array(Schema.Union([MemoryMap, MemoryMapRefusal])),
  unresolved: Schema.Array(
    Schema.Struct({
      name: TrimmedNonEmptyString,
      referencedBy: Schema.Array(TrimmedNonEmptyString),
    }),
  ),
  problems: Schema.Array(Schema.String),
  productMapOffer: Schema.NullOr(Schema.Struct({ declarationCount: Schema.Number })),
});
export type MemoryIndex = typeof MemoryIndex.Type;

export const MemoryNote = Schema.Struct({
  name: TrimmedNonEmptyString,
  exists: Schema.Boolean,
  path: Schema.optional(TrimmedNonEmptyString),
  markdown: Schema.optional(Schema.String),
  links: Schema.Array(Schema.Struct({ name: TrimmedNonEmptyString, exists: Schema.Boolean })),
  backlinks: Schema.Array(TrimmedNonEmptyString),
});
export type MemoryNote = typeof MemoryNote.Type;

export const MemoryLineRef = Schema.Union([
  Schema.Struct({ threadId: ThreadId }),
  Schema.Struct({ planId: PlanId, commitId: MercurianCommitId }),
]);
export type MemoryLineRef = typeof MemoryLineRef.Type;

export const MercurianSubscribeMemorySourcesInput = Schema.Struct({});
export type MercurianSubscribeMemorySourcesInput = typeof MercurianSubscribeMemorySourcesInput.Type;
export const MercurianDesignateMemorySourceInput = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
  subpath: Schema.optional(Schema.String),
});
export type MercurianDesignateMemorySourceInput = typeof MercurianDesignateMemorySourceInput.Type;
export const MercurianRemoveMemorySourceInput = Schema.Struct({ projectId: MercurianProjectId });
export type MercurianRemoveMemorySourceInput = typeof MercurianRemoveMemorySourceInput.Type;
export const MemoryReadingPosition = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("latest") }),
  Schema.Struct({ kind: Schema.Literal("checkpoint"), commitId: MercurianCommitId }),
  Schema.Struct({
    kind: Schema.Literal("turn"),
    threadId: ThreadId,
    turnCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
]);
export type MemoryReadingPosition = typeof MemoryReadingPosition.Type;

export const MercurianReadMemoryIndexInput = Schema.Struct({
  projectId: MercurianProjectId,
  line: Schema.optional(MemoryLineRef),
  position: Schema.optional(MemoryReadingPosition),
});
export type MercurianReadMemoryIndexInput = typeof MercurianReadMemoryIndexInput.Type;
export const MercurianReadMemoryNoteInput = Schema.Struct({
  projectId: MercurianProjectId,
  name: TrimmedNonEmptyString,
  line: Schema.optional(MemoryLineRef),
  position: Schema.optional(MemoryReadingPosition),
});
export type MercurianReadMemoryNoteInput = typeof MercurianReadMemoryNoteInput.Type;
export const MemoryLineChange = Schema.Struct({
  oid: TrimmedNonEmptyString,
  title: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  authoredAt: IsoDateTime,
  diff: Schema.String,
  reviewed: Schema.Boolean,
});
export type MemoryLineChange = typeof MemoryLineChange.Type;
export const MercurianLineMemoryChanges = Schema.Struct({
  marked: Schema.Array(MemoryLineChange),
  hand: Schema.Array(
    Schema.Struct({
      oid: TrimmedNonEmptyString,
      title: Schema.String,
      authoredAt: IsoDateTime,
      diff: Schema.String,
      reviewed: Schema.Boolean,
    }),
  ),
  unmarked: Schema.NullOr(Schema.Struct({ diff: Schema.String })),
  unreviewedCount: Schema.Number,
});
export type MercurianLineMemoryChanges = typeof MercurianLineMemoryChanges.Type;
export const MercurianReadLineMemoryChangesInput = Schema.Struct({
  line: MemoryLineRef,
  position: Schema.optional(MemoryReadingPosition),
});
export type MercurianReadLineMemoryChangesInput = typeof MercurianReadLineMemoryChangesInput.Type;
export const MercurianMarkMemoryChangeReviewedInput = Schema.Struct({
  line: MemoryLineRef,
  commitOid: TrimmedNonEmptyString,
});
export type MercurianMarkMemoryChangeReviewedInput =
  typeof MercurianMarkMemoryChangeReviewedInput.Type;
export const MercurianRevertMemoryChangeInput = Schema.Struct({
  line: MemoryLineRef,
  target: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("commit"), commitOid: TrimmedNonEmptyString }),
    Schema.Struct({ kind: Schema.Literal("unmarked") }),
  ]),
});
export type MercurianRevertMemoryChangeInput = typeof MercurianRevertMemoryChangeInput.Type;
export const MercurianMergeMemoryHomeInput = Schema.Struct({ line: MemoryLineRef });
export type MercurianMergeMemoryHomeInput = typeof MercurianMergeMemoryHomeInput.Type;
export const MemoryMergeHomeConflict = Schema.Struct({ path: TrimmedNonEmptyString });
export type MemoryMergeHomeConflict = typeof MemoryMergeHomeConflict.Type;
export const MercurianMergeMemoryHomeResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("merged"), commitOid: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("deferred-to-push") }),
  Schema.Struct({
    kind: Schema.Literal("conflict"),
    conflicts: Schema.Array(MemoryMergeHomeConflict),
  }),
]);
export type MercurianMergeMemoryHomeResult = typeof MercurianMergeMemoryHomeResult.Type;
export const MercurianGenerateProductMapInput = Schema.Struct({ projectId: MercurianProjectId });
export type MercurianGenerateProductMapInput = typeof MercurianGenerateProductMapInput.Type;

export class MemoryNotDesignatedError extends Schema.TaggedErrorClass<MemoryNotDesignatedError>()(
  "MemoryNotDesignatedError",
  { projectId: MercurianProjectId },
) {
  override get message(): string {
    return `Project ${this.projectId} has no designated memory`;
  }
}

export class MemorySourceInvalidError extends Schema.TaggedErrorClass<MemorySourceInvalidError>()(
  "MemorySourceInvalidError",
  {
    repositoryId: MercurianRepositoryId,
    subpath: Schema.optional(Schema.String),
    reason: Schema.Literals([
      "repository-not-found",
      "missing",
      "not-a-directory",
      "nested-repository",
    ]),
  },
) {
  override get message(): string {
    return `Memory source ${this.repositoryId}${this.subpath ? `/${this.subpath}` : ""} is invalid: ${this.reason}`;
  }
}

export class ProductMapAlreadyExistsError extends Schema.TaggedErrorClass<ProductMapAlreadyExistsError>()(
  "ProductMapAlreadyExistsError",
  { projectId: MercurianProjectId },
) {
  override get message(): string {
    return "Product.skillmap.md already exists";
  }
}

export class ProductMapCycleError extends Schema.TaggedErrorClass<ProductMapCycleError>()(
  "ProductMapCycleError",
  { cycle: Schema.Array(TrimmedNonEmptyString) },
) {
  override get message(): string {
    return `Containment cycle: ${this.cycle.join(" -> ")}`;
  }
}

export const isMemoryNotDesignatedError = Schema.is(MemoryNotDesignatedError);
export const isMemorySourceInvalidError = Schema.is(MemorySourceInvalidError);
export const isProductMapAlreadyExistsError = Schema.is(ProductMapAlreadyExistsError);
export const isProductMapCycleError = Schema.is(ProductMapCycleError);

export class MercurianMemoryError extends Schema.TaggedErrorClass<MercurianMemoryError>()(
  "MercurianMemoryError",
  {
    operation: Schema.Literals([
      "subscribeMemorySources",
      "designateMemorySource",
      "removeMemorySource",
      "readMemoryCatalog",
      "readMemoryDashboard",
      "readMemoryDocument",
      "readMemoryComparison",
      "subscribeMemoryInvalidations",
      "readMemoryIndex",
      "readMemoryNote",
      "readLineMemoryChanges",
      "markMemoryChangeReviewed",
      "revertMemoryChange",
      "mergeMemoryHome",
      "generateProductMap",
      "prepareMemoryAmendment",
      "applyMemoryAmendment",
      "landMemoryAmendment",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian memory operation ${this.operation} failed`;
  }
}

export class MemoryReviewBlockedError extends Schema.TaggedErrorClass<MemoryReviewBlockedError>()(
  "MemoryReviewBlockedError",
  { reason: Schema.Literals(["turn-active", "not-on-line"]) },
) {
  override get message(): string {
    return this.reason === "turn-active"
      ? "Memory changes cannot be reverted while a turn is active on this line"
      : "The selected commit is not part of this line's memory changes";
  }
}

export class MergeMemoryHomeBlockedError extends Schema.TaggedErrorClass<MergeMemoryHomeBlockedError>()(
  "MergeMemoryHomeBlockedError",
  { reason: Schema.Literals(["git-too-old", "checkout-dirty", "main-missing"]) },
) {
  override get message(): string {
    if (this.reason === "git-too-old") {
      return "Merging a standalone memory home requires Git 2.38 or newer";
    }
    return this.reason === "checkout-dirty"
      ? "The memory checkout has uncommitted changes"
      : "The local memory home branch does not exist";
  }
}

/** Resolved once; all subsequent reads use object IDs, never mutable refs. */
export const MemoryObjectId = Schema.String.check(
  Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
);
export const MemoryPosition = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
  memoryRoot: Schema.String,
  lineRootCommitId: MercurianCommitId,
  reading: MemoryReadingPosition,
  baselineTreeOid: MemoryObjectId,
  baselineSnapshotOid: Schema.NullOr(MemoryObjectId),
  baseCommitOid: MemoryObjectId,
  snapshotOid: Schema.NullOr(MemoryObjectId),
  treeOid: MemoryObjectId,
  recordedHeadOid: MemoryObjectId,
  headOid: MemoryObjectId,
  captureKind: Schema.NullOr(Schema.String),
});
export type MemoryPosition = typeof MemoryPosition.Type;
export const MemoryUnavailable = Schema.Struct({
  kind: Schema.Literal("unavailable"),
  reason: Schema.Literals([
    "not-designated",
    "line-missing",
    "checkpoint-missing",
    "baseline-missing",
    "object-missing",
    "effective-tree-conflict",
    "git-too-old",
  ]),
});
export type MemoryUnavailable = typeof MemoryUnavailable.Type;
/** The environment is the RPC envelope; UI tabs retain it alongside this target. */
export const MemoryDocumentTarget = Schema.Struct({
  position: MemoryPosition,
  path: TrimmedNonEmptyString,
  treeOid: MemoryObjectId,
  blobOid: MemoryObjectId,
  deleted: Schema.Boolean,
});
export type MemoryDocumentTarget = typeof MemoryDocumentTarget.Type;
export const MemoryComparisonTarget = Schema.Struct({
  position: MemoryPosition,
  beforeTreeOid: MemoryObjectId,
  afterTreeOid: MemoryObjectId,
  paths: Schema.Array(TrimmedNonEmptyString),
});
export type MemoryComparisonTarget = typeof MemoryComparisonTarget.Type;
export const MemoryDocumentKind = Schema.Literals(["note", "skill-map", "document"]);
export type MemoryDocumentKind = typeof MemoryDocumentKind.Type;
export const MemoryChangedDocument = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  previousPaths: Schema.Array(Schema.String),
  kind: MemoryDocumentKind,
  status: Schema.Literals(["added", "modified", "deleted", "renamed", "restored"]),
  latestCheckpoint: Schema.NullOr(Schema.String),
  amendmentIds: Schema.Array(Schema.String),
  document: Schema.NullOr(MemoryDocumentTarget),
  comparison: MemoryComparisonTarget,
});
export type MemoryChangedDocument = typeof MemoryChangedDocument.Type;
export const MemoryAmendmentSummary = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["marked", "hand", "unmarked"]),
  title: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  reviewed: Schema.Boolean,
  documentIds: Schema.Array(Schema.String),
  comparison: MemoryComparisonTarget,
});
export type MemoryAmendmentSummary = typeof MemoryAmendmentSummary.Type;
export const MemoryLocalGraph = Schema.Struct({
  nodes: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  edges: Schema.Array(
    Schema.Struct({
      from: Schema.String,
      to: Schema.String,
      status: Schema.Literals(["added", "removed", "unchanged"]),
    }),
  ),
  outsideReferences: Schema.Array(
    Schema.Struct({
      from: Schema.String,
      name: Schema.String,
      side: Schema.Literals(["baseline", "selected"]),
    }),
  ),
});
export type MemoryLocalGraph = typeof MemoryLocalGraph.Type;
export const MemoryDashboard = Schema.Union([
  MemoryUnavailable,
  Schema.Struct({
    kind: Schema.Literal("available"),
    position: MemoryPosition,
    documents: Schema.Array(MemoryChangedDocument),
    amendments: Schema.Array(MemoryAmendmentSummary),
    graph: MemoryLocalGraph,
    unreviewedCount: Schema.Number,
    limitations: Schema.Array(Schema.String),
  }),
]);
export type MemoryDashboard = typeof MemoryDashboard.Type;
export const MercurianReadMemoryDashboardInput = Schema.Struct({
  projectId: MercurianProjectId,
  line: MemoryLineRef,
  position: MemoryReadingPosition,
});
export type MercurianReadMemoryDashboardInput = typeof MercurianReadMemoryDashboardInput.Type;
export const MercurianReadMemoryDocumentInput = Schema.Struct({ target: MemoryDocumentTarget });
export type MercurianReadMemoryDocumentInput = typeof MercurianReadMemoryDocumentInput.Type;
export const MercurianReadMemoryComparisonInput = Schema.Struct({ target: MemoryComparisonTarget });
export type MercurianReadMemoryComparisonInput = typeof MercurianReadMemoryComparisonInput.Type;
export const MemoryDocumentResult = Schema.Union([
  MemoryUnavailable,
  Schema.Struct({
    kind: Schema.Literal("available"),
    target: MemoryDocumentTarget,
    markdown: Schema.String,
    links: Schema.Array(
      Schema.Struct({ name: Schema.String, target: Schema.NullOr(MemoryDocumentTarget) }),
    ),
    map: Schema.NullOr(Schema.Union([MemoryMap, MemoryMapRefusal])),
  }),
]);
export type MemoryDocumentResult = typeof MemoryDocumentResult.Type;
export const MemoryComparisonResult = Schema.Union([
  MemoryUnavailable,
  Schema.Struct({
    kind: Schema.Literal("available"),
    target: MemoryComparisonTarget,
    patch: Schema.String,
    maps: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        before: Schema.NullOr(Schema.Union([MemoryMap, MemoryMapRefusal])),
        after: Schema.NullOr(Schema.Union([MemoryMap, MemoryMapRefusal])),
        structureChanged: Schema.Boolean,
        bodyChanged: Schema.Boolean,
      }),
    ),
  }),
]);
export type MemoryComparisonResult = typeof MemoryComparisonResult.Type;
export const MemoryInvalidation = Schema.Struct({ kind: Schema.Literal("invalidate") });
export const MercurianSubscribeMemoryInvalidationsInput = Schema.Struct({});
export const MemoryDocumentSelection = Schema.Struct({
  environmentId: EnvironmentId,
  target: MemoryDocumentTarget,
});
export type MemoryDocumentSelection = typeof MemoryDocumentSelection.Type;
export const MemoryComparisonSelection = Schema.Struct({
  environmentId: EnvironmentId,
  target: MemoryComparisonTarget,
});
export type MemoryComparisonSelection = typeof MemoryComparisonSelection.Type;
/** Retain this exact target in the composer's pending review context; never send automatically. */
export const MemoryDocumentComment = Schema.Struct({
  environmentId: EnvironmentId,
  target: MemoryDocumentTarget,
  startLine: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  endLine: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  text: Schema.String,
});
export type MemoryDocumentComment = typeof MemoryDocumentComment.Type;

/** Legacy successful read shapes are unchanged; unavailable line positions use a typed error. */
export class MemoryReadUnavailableError extends Schema.TaggedErrorClass<MemoryReadUnavailableError>()(
  "MemoryReadUnavailableError",
  { reason: MemoryUnavailable.fields.reason },
) {
  override get message(): string {
    return `Memory content is unavailable: ${this.reason}`;
  }
}
export const isMemoryReadUnavailableError = Schema.is(MemoryReadUnavailableError);
export const MercurianReadMemoryCatalogInput = Schema.Struct({ position: MemoryPosition });
export type MercurianReadMemoryCatalogInput = typeof MercurianReadMemoryCatalogInput.Type;
/** Browse metadata shares one immutable position rather than repeating it for every file. */
export const MemoryCatalog = Schema.Union([
  MemoryUnavailable,
  Schema.Struct({
    kind: Schema.Literal("available"),
    position: MemoryPosition,
    entries: Schema.Array(
      Schema.Struct({ path: Schema.String, blobOid: MemoryObjectId, kind: MemoryDocumentKind }),
    ),
  }),
]);
export type MemoryCatalog = typeof MemoryCatalog.Type;
