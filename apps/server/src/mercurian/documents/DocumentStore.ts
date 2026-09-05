import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import {
  ThreadId,
  MercurianProjectId,
  MercurianRepositoryId,
  MercurianStorageError,
} from "@t3tools/contracts";

export const DocumentOrigin = Schema.Struct({
  documentId: Schema.String,
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
  relativePath: Schema.String,
  connectionId: Schema.String,
  issueId: Schema.String,
  issueUrl: Schema.String,
  imported: Schema.Boolean,
  goal: Schema.String,
  acceptanceCriteria: Schema.String,
});
export type DocumentOrigin = typeof DocumentOrigin.Type;
export const DocumentOperation = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  relativePath: Schema.String,
  beforeHash: Schema.String,
  contents: Schema.String,
});
export type DocumentOperation = typeof DocumentOperation.Type;
const baselineSchema = Schema.Struct({ goal: Schema.String, acceptanceCriteria: Schema.String });
const decodeOperation = Schema.decodeUnknownEffect(Schema.fromJsonString(DocumentOperation));
const encodeOperation = Schema.encodeEffect(Schema.fromJsonString(DocumentOperation));
const encodeOrigin = Schema.encodeEffect(Schema.fromJsonString(DocumentOrigin));
const decodeOrigin = Schema.decodeUnknownEffect(Schema.fromJsonString(DocumentOrigin));
const decodeBaseline = Schema.decodeUnknownEffect(Schema.fromJsonString(baselineSchema));
const encodeBaseline = Schema.encodeSync(Schema.fromJsonString(baselineSchema));

export class DocumentStore extends Context.Service<
  DocumentStore,
  {
    readonly pending: (
      threadId: ThreadId,
      documentId: string,
    ) => Effect.Effect<Option.Option<DocumentOperation>, MercurianStorageError>;
    readonly stage: (
      threadId: ThreadId,
      documentId: string,
      operation: DocumentOperation,
    ) => Effect.Effect<void, MercurianStorageError>;
    readonly complete: (
      threadId: ThreadId,
      documentId: string,
    ) => Effect.Effect<void, MercurianStorageError>;
    readonly baseline: (
      documentId: string,
      revision: string,
    ) => Effect.Effect<
      Option.Option<{ goal: string; acceptanceCriteria: string }>,
      MercurianStorageError
    >;
    readonly saveBaseline: (
      documentId: string,
      revision: string,
      baseline: { goal: string; acceptanceCriteria: string },
    ) => Effect.Effect<void, MercurianStorageError>;
    readonly get: (
      documentId: string,
    ) => Effect.Effect<Option.Option<DocumentOrigin>, MercurianStorageError>;
    readonly reserve: (
      input: DocumentOrigin,
    ) => Effect.Effect<DocumentOrigin, MercurianStorageError>;
    readonly markImported: (documentId: string) => Effect.Effect<void, MercurianStorageError>;
  }
>()("t3/mercurian/documents/DocumentStore") {}
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ documentId: Schema.String }),
    Result: Schema.Struct({ payload: Schema.String }),
    execute: ({ documentId }) =>
      sql`SELECT payload FROM project_document_origins WHERE document_id = ${documentId}`,
  });
  const decode = decodeOrigin;
  const error = (cause: unknown) =>
    new MercurianStorageError({ operation: "document-origin", cause });
  const get = (documentId: string) =>
    find({ documentId }).pipe(
      Effect.flatMap((row) =>
        Option.isSome(row)
          ? decode(row.value.payload).pipe(Effect.map(Option.some))
          : Effect.succeed(Option.none<DocumentOrigin>()),
      ),
      Effect.mapError(error),
    );
  return DocumentStore.of({
    pending: (threadId, documentId) =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          payload: string;
        }>`SELECT payload FROM project_document_operations WHERE thread_id = ${threadId} AND document_id = ${documentId}`;
        return rows[0] ? Option.some(yield* decodeOperation(rows[0].payload)) : Option.none();
      }).pipe(Effect.mapError(error)),
    stage: (threadId, documentId, operation) =>
      Effect.gen(function* () {
        const payload = yield* encodeOperation(operation);
        yield* sql`INSERT INTO project_document_operations(thread_id, document_id, payload) VALUES (${threadId}, ${documentId}, ${payload}) ON CONFLICT(thread_id, document_id) DO UPDATE SET payload = excluded.payload`;
      }).pipe(Effect.mapError(error)),
    complete: (threadId, documentId) =>
      sql`DELETE FROM project_document_operations WHERE thread_id = ${threadId} AND document_id = ${documentId}`.pipe(
        Effect.asVoid,
        Effect.mapError(error),
      ),
    baseline: (documentId, revision) =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          payload: string;
        }>`SELECT payload FROM project_spec_baselines WHERE document_id = ${documentId} AND revision = ${revision}`;
        return rows[0] ? Option.some(yield* decodeBaseline(rows[0].payload)) : Option.none();
      }).pipe(Effect.mapError(error)),
    saveBaseline: (documentId, revision, baseline) =>
      sql`INSERT INTO project_spec_baselines(document_id, revision, payload) VALUES (${documentId}, ${revision}, ${encodeBaseline(baseline)}) ON CONFLICT(document_id, revision) DO NOTHING`.pipe(
        Effect.asVoid,
        Effect.mapError(error),
      ),
    get,
    reserve: (input) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO project_document_origins(document_id, payload) VALUES (${input.documentId}, ${yield* encodeOrigin(input)}) ON CONFLICT(document_id) DO NOTHING`;
        return Option.getOrThrow(yield* get(input.documentId));
      }).pipe(Effect.mapError(error)),
    markImported: (documentId) =>
      Effect.gen(function* () {
        const current = Option.getOrThrow(yield* get(documentId));
        yield* sql`UPDATE project_document_origins SET payload = ${yield* encodeOrigin({ ...current, imported: true })} WHERE document_id = ${documentId}`;
      }).pipe(Effect.mapError(error)),
  });
});
export const layer = Layer.effect(DocumentStore, make);
