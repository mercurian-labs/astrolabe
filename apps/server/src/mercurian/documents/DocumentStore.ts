import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import {
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
export class DocumentStore extends Context.Service<
  DocumentStore,
  {
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
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(DocumentOrigin));
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
  const baselineSchema = Schema.Struct({ goal: Schema.String, acceptanceCriteria: Schema.String });
  return DocumentStore.of({
    baseline: (documentId, revision) =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          payload: string;
        }>`SELECT payload FROM project_spec_baselines WHERE document_id = ${documentId} AND revision = ${revision}`;
        return rows[0]
          ? Option.some(
              yield* Schema.decodeUnknownEffect(Schema.fromJsonString(baselineSchema))(
                rows[0].payload,
              ),
            )
          : Option.none();
      }).pipe(Effect.mapError(error)),
    saveBaseline: (documentId, revision, baseline) =>
      sql`INSERT INTO project_spec_baselines(document_id, revision, payload) VALUES (${documentId}, ${revision}, ${Schema.encodeSync(Schema.fromJsonString(baselineSchema))(baseline)}) ON CONFLICT(document_id, revision) DO NOTHING`.pipe(
        Effect.asVoid,
        Effect.mapError(error),
      ),
    get,
    reserve: (input) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO project_document_origins(document_id, payload) VALUES (${input.documentId}, ${yield* Schema.encodeEffect(Schema.fromJsonString(DocumentOrigin))(input)}) ON CONFLICT(document_id) DO NOTHING`;
        return Option.getOrThrow(yield* get(input.documentId));
      }).pipe(Effect.mapError(error)),
    markImported: (documentId) =>
      Effect.gen(function* () {
        const current = Option.getOrThrow(yield* get(documentId));
        yield* sql`UPDATE project_document_origins SET payload = ${yield* Schema.encodeEffect(Schema.fromJsonString(DocumentOrigin))({ ...current, imported: true })} WHERE document_id = ${documentId}`;
      }).pipe(Effect.mapError(error)),
  });
});
export const layer = Layer.effect(DocumentStore, make);
