import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isMemorySourceInvalidError,
  MemorySourceInvalidError,
  MercurianProjectId,
  MercurianRepositoryId,
} from "@t3tools/contracts";

import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";
import type { MemorySource, ResolvedMemorySource } from "./schema.ts";

export type MemorySourceStoreError =
  | MemorySourceInvalidError
  | PersistenceSqlError
  | PersistenceDecodeError;

export interface DesignateMemorySourceInput {
  readonly projectId: MercurianProjectId;
  readonly repositoryId: MercurianRepositoryId;
  readonly subpath?: string | undefined;
  readonly now: typeof Schema.DateTimeUtcFromString.Type;
}

export class MemorySourceStore extends Context.Service<
  MemorySourceStore,
  {
    readonly designate: (
      input: DesignateMemorySourceInput,
    ) => Effect.Effect<void, MemorySourceStoreError>;
    readonly remove: (projectId: MercurianProjectId) => Effect.Effect<void, MemorySourceStoreError>;
    readonly getSnapshot: Effect.Effect<ReadonlyArray<MemorySource>, MemorySourceStoreError>;
    readonly getSource: (
      projectId: MercurianProjectId,
    ) => Effect.Effect<Option.Option<MemorySource>, MemorySourceStoreError>;
    readonly getResolvedSource: (
      projectId: MercurianProjectId,
    ) => Effect.Effect<Option.Option<ResolvedMemorySource>, MemorySourceStoreError>;
    readonly changes: Stream.Stream<void>;
  }
>()("t3/mercurian/memory/MemorySourceStore") {}

const MemorySourceRow = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
  subpath: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
const RepositoryRow = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  name: Schema.String,
  path: Schema.String,
});
const ProjectRequest = Schema.Struct({ projectId: MercurianProjectId });
const RepositoryRequest = Schema.Struct({ repositoryId: MercurianRepositoryId });
const NoRequest = Schema.Struct({});

function toStoreError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): MemorySourceStoreError =>
    isMemorySourceInvalidError(cause)
      ? cause
      : Schema.isSchemaError(cause)
        ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
        : isPersistenceError(cause)
          ? cause
          : new PersistenceSqlError({ operation: sqlOperation, cause });
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const changesPubSub = yield* PubSub.unbounded<void>();
  const announceChange = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);

  const columns = sql`
    project_id AS "projectId",
    repository_id AS "repositoryId",
    subpath AS "subpath",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;
  const listRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: MemorySourceRow,
    execute: () => sql`
      SELECT ${columns} FROM project_memory_sources
      ORDER BY created_at ASC, project_id ASC
    `,
  });
  const findRow = SqlSchema.findOneOption({
    Request: ProjectRequest,
    Result: MemorySourceRow,
    execute: ({ projectId }) => sql`
      SELECT ${columns} FROM project_memory_sources WHERE project_id = ${projectId}
    `,
  });
  const findRepository = SqlSchema.findOneOption({
    Request: RepositoryRequest,
    Result: RepositoryRow,
    execute: ({ repositoryId }) => sql`
      SELECT repository_id AS "repositoryId", name AS "name", path AS "path"
      FROM repositories WHERE repository_id = ${repositoryId}
    `,
  });
  const upsertRow = SqlSchema.void({
    Request: MemorySourceRow,
    execute: (row) => sql`
      INSERT INTO project_memory_sources
        (project_id, repository_id, subpath, created_at, updated_at)
      VALUES (${row.projectId}, ${row.repositoryId}, ${row.subpath}, ${row.createdAt}, ${row.updatedAt})
      ON CONFLICT(project_id) DO UPDATE SET
        repository_id = excluded.repository_id,
        subpath = excluded.subpath,
        updated_at = excluded.updated_at
    `,
  });
  const deleteRow = SqlSchema.void({
    Request: ProjectRequest,
    execute: ({ projectId }) => sql`
      DELETE FROM project_memory_sources WHERE project_id = ${projectId}
    `,
  });

  const resolveRoot = Effect.fn("MemorySourceStore.resolveRoot")(function* (
    repository: typeof RepositoryRow.Type,
    subpath: string | null,
  ) {
    const candidate = path.resolve(repository.path, subpath ?? ".");
    const invalid = (reason: "missing" | "not-a-directory") =>
      new MemorySourceInvalidError({
        repositoryId: repository.repositoryId,
        ...(subpath === null ? {} : { subpath }),
        reason,
      });
    const canonicalRepository = yield* fs
      .realPath(repository.path)
      .pipe(Effect.mapError(() => invalid("missing")));
    const canonicalCandidate = yield* fs
      .realPath(candidate)
      .pipe(Effect.mapError(() => invalid("missing")));
    const relative = path.relative(canonicalRepository, canonicalCandidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return yield* invalid("missing");
    }
    const info = yield* fs.stat(canonicalCandidate).pipe(Effect.mapError(() => invalid("missing")));
    if (info.type !== "Directory") {
      return yield* invalid("not-a-directory");
    }
    return canonicalCandidate;
  });

  const getSource: MemorySourceStore["Service"]["getSource"] = (projectId) =>
    findRow({ projectId }).pipe(
      Effect.mapError(
        toStoreError("MemorySourceStore.getSource:query", "MemorySourceStore.getSource:decode"),
      ),
    );

  const getResolvedSource: MemorySourceStore["Service"]["getResolvedSource"] = (projectId) =>
    Effect.gen(function* () {
      const source = yield* findRow({ projectId });
      if (Option.isNone(source)) return Option.none<ResolvedMemorySource>();
      const repository = yield* findRepository({ repositoryId: source.value.repositoryId });
      if (Option.isNone(repository)) {
        return yield* new MemorySourceInvalidError({
          repositoryId: source.value.repositoryId,
          ...(source.value.subpath === null ? {} : { subpath: source.value.subpath }),
          reason: "repository-not-found",
        });
      }
      const rootPath = yield* resolveRoot(repository.value, source.value.subpath);
      return Option.some({
        ...source.value,
        repositoryName: repository.value.name,
        repositoryPath: repository.value.path,
        rootPath,
      });
    }).pipe(
      Effect.mapError(
        toStoreError(
          "MemorySourceStore.getResolvedSource:query",
          "MemorySourceStore.getResolvedSource:decode",
        ),
      ),
    );

  const designate: MemorySourceStore["Service"]["designate"] = (input) =>
    Effect.gen(function* () {
      const repository = yield* findRepository({ repositoryId: input.repositoryId });
      const subpath = input.subpath?.trim().replace(/^[/\\]+|[/\\]+$/gu, "") || null;
      if (Option.isNone(repository)) {
        return yield* new MemorySourceInvalidError({
          repositoryId: input.repositoryId,
          ...(subpath === null ? {} : { subpath }),
          reason: "repository-not-found",
        });
      }
      yield* resolveRoot(repository.value, subpath);
      yield* upsertRow({
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        subpath,
        createdAt: input.now,
        updatedAt: input.now,
      });
      yield* announceChange;
    }).pipe(
      Effect.mapError(
        toStoreError("MemorySourceStore.designate:query", "MemorySourceStore.designate:decode"),
      ),
    );

  const remove: MemorySourceStore["Service"]["remove"] = (projectId) =>
    Effect.gen(function* () {
      yield* deleteRow({ projectId });
      yield* announceChange;
    }).pipe(
      Effect.mapError(
        toStoreError("MemorySourceStore.remove:query", "MemorySourceStore.remove:decode"),
      ),
    );

  const getSnapshot = listRows({}).pipe(
    Effect.mapError(
      toStoreError("MemorySourceStore.getSnapshot:query", "MemorySourceStore.getSnapshot:decode"),
    ),
  );

  return {
    designate,
    remove,
    getSnapshot,
    getSource,
    getResolvedSource,
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies MemorySourceStore["Service"];
});

export const layer = Layer.effect(MemorySourceStore, make);
