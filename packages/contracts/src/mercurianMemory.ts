/** Project-memory designation and the fresh, disk-derived read model. */
import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { MercurianCommitId, MercurianProjectId, PlanId } from "./mercurian.ts";
import { MercurianRepositoryId } from "./mercurianRepositories.ts";

export const MERCURIAN_MEMORY_WS_METHODS = {
  subscribeMemorySources: "mercurian.subscribeMemorySources",
  designateMemorySource: "mercurian.designateMemorySource",
  removeMemorySource: "mercurian.removeMemorySource",
  readMemoryIndex: "mercurian.readMemoryIndex",
  readMemoryNote: "mercurian.readMemoryNote",
  readLineMemoryChanges: "mercurian.readLineMemoryChanges",
  markMemoryChangeReviewed: "mercurian.markMemoryChangeReviewed",
  revertMemoryChange: "mercurian.revertMemoryChange",
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
export const MercurianReadMemoryIndexInput = Schema.Struct({
  projectId: MercurianProjectId,
  line: Schema.optional(MemoryLineRef),
});
export type MercurianReadMemoryIndexInput = typeof MercurianReadMemoryIndexInput.Type;
export const MercurianReadMemoryNoteInput = Schema.Struct({
  projectId: MercurianProjectId,
  name: TrimmedNonEmptyString,
  line: Schema.optional(MemoryLineRef),
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
      "readMemoryIndex",
      "readMemoryNote",
      "readLineMemoryChanges",
      "markMemoryChangeReviewed",
      "revertMemoryChange",
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
