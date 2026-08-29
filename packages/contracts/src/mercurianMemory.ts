/** Project-memory designation and the fresh, disk-derived read model. */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { MercurianProjectId } from "./mercurian.ts";
import { MercurianRepositoryId } from "./mercurianRepositories.ts";

export const MERCURIAN_MEMORY_WS_METHODS = {
  subscribeMemorySources: "mercurian.subscribeMemorySources",
  designateMemorySource: "mercurian.designateMemorySource",
  removeMemorySource: "mercurian.removeMemorySource",
  readMemoryIndex: "mercurian.readMemoryIndex",
  readMemoryNote: "mercurian.readMemoryNote",
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

export interface MemoryArrangementNode {
  readonly note: string;
  readonly children?: ReadonlyArray<MemoryArrangementNode> | undefined;
}
const MemoryArrangementNodeRef = Schema.suspend(
  (): Schema.Codec<MemoryArrangementNode> => MemoryArrangementNode,
);
export const MemoryArrangementNode = Schema.Struct({
  note: Schema.String,
  children: Schema.optional(Schema.Array(MemoryArrangementNodeRef)),
});

export const MemoryMap = Schema.Struct({
  file: TrimmedNonEmptyString,
  name: Schema.String,
  purpose: Schema.String,
  rule: Schema.optional(Schema.String),
  edge: Schema.optional(Schema.String),
  arrangement: Schema.Array(MemoryArrangementNode),
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
  openDecisions: Schema.Array(
    Schema.Struct({ title: TrimmedNonEmptyString, resolved: Schema.Boolean }),
  ),
});
export type MemoryNote = typeof MemoryNote.Type;

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
export const MercurianReadMemoryIndexInput = Schema.Struct({ projectId: MercurianProjectId });
export type MercurianReadMemoryIndexInput = typeof MercurianReadMemoryIndexInput.Type;
export const MercurianReadMemoryNoteInput = Schema.Struct({
  projectId: MercurianProjectId,
  name: TrimmedNonEmptyString,
});
export type MercurianReadMemoryNoteInput = typeof MercurianReadMemoryNoteInput.Type;
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
    reason: Schema.Literals(["repository-not-found", "missing", "not-a-directory"]),
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
    return "maps/product.yaml already exists";
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
      "generateProductMap",
      "prepareMemoryAmendment",
      "applyMemoryAmendment",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Mercurian memory operation ${this.operation} failed`;
  }
}
