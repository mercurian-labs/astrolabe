import * as Schema from "effect/Schema";
import { SpecDocument, MercurianProjectId, MercurianCommitId } from "./mercurian.ts";
import { MercurianRepositoryId } from "./mercurianRepositories.ts";
import { ThreadId } from "./baseSchemas.ts";
export const ProjectDocument = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  cwd: Schema.String,
  relativePath: Schema.String,
  kind: Schema.Literals(["plan", "spec"]),
  title: Schema.String,
  snapshotOid: Schema.NullOr(Schema.String),
  lastCheckpoint: Schema.NullOr(Schema.Number),
  changedAt: Schema.NullOr(Schema.String),
  id: Schema.NullOr(Schema.String),
  counterparts: Schema.Array(Schema.String),
  originUrl: Schema.NullOr(Schema.String),
  problem: Schema.NullOr(Schema.String),
});
export type ProjectDocument = typeof ProjectDocument.Type;
export const ListProjectDocumentsInput = Schema.Struct({
  projectId: MercurianProjectId,
  threadId: ThreadId,
  positionCommitId: Schema.optional(MercurianCommitId),
  turnCount: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
});
export type ListProjectDocumentsInput = typeof ListProjectDocumentsInput.Type;
export const ListProjectDocumentsResult = Schema.Struct({
  documents: Schema.Array(ProjectDocument),
  problems: Schema.Array(Schema.String),
});
export type ListProjectDocumentsResult = typeof ListProjectDocumentsResult.Type;
export const MERCURIAN_DOCUMENT_WS_METHODS = {
  listProjectDocuments: "mercurian.listProjectDocuments",
  refreshProjectSpec: "mercurian.refreshProjectSpec",
} as const;

export const RefreshProjectSpecInput = Schema.Struct({
  threadId: ThreadId,
  documentId: Schema.String,
  repositoryId: MercurianRepositoryId,
  relativePath: Schema.String,
  expectedHash: Schema.optional(Schema.String),
  reviewedUpstream: Schema.optional(SpecDocument),
  resolvedDocument: Schema.optional(SpecDocument),
});
export const RefreshProjectSpecResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unchanged") }),
  Schema.Struct({ kind: Schema.Literal("saved"), snapshotOid: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("reconciliation-required"),
    base: SpecDocument,
    local: SpecDocument,
    upstream: SpecDocument,
    expectedHash: Schema.String,
  }),
]);
export type RefreshProjectSpecResult = typeof RefreshProjectSpecResult.Type;
export type RefreshProjectSpecInput = typeof RefreshProjectSpecInput.Type;
