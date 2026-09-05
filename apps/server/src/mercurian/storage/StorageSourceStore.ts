import * as DateTime from "effect/DateTime";
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
import { ProjectStorageKind } from "@t3tools/contracts";
import type { StorageSource, ResolvedStorageSource } from "./schema.ts";

export type StorageSourceStoreError =
  | MemorySourceInvalidError
  | PersistenceSqlError
  | PersistenceDecodeError;

export interface DesignateStorageSourceInput {
  readonly projectId: MercurianProjectId;
  readonly kind: ProjectStorageKind;
  readonly repositoryId: MercurianRepositoryId;
  readonly subpath?: string | undefined;
  readonly now: typeof Schema.DateTimeUtcFromString.Type;
}

export class StorageSourceStore extends Context.Service<
  StorageSourceStore,
  {
    readonly designate: (
      input: DesignateStorageSourceInput,
    ) => Effect.Effect<void, StorageSourceStoreError>;
    readonly remove: (
      projectId: MercurianProjectId,
      kind: ProjectStorageKind,
    ) => Effect.Effect<void, StorageSourceStoreError>;
    readonly getDocumentLocations: Effect.Effect<
      ReadonlyArray<StorageSource>,
      StorageSourceStoreError
    >;
    readonly getSnapshot: Effect.Effect<ReadonlyArray<StorageSource>, StorageSourceStoreError>;
    readonly getSource: (
      projectId: MercurianProjectId,
      kind: ProjectStorageKind,
    ) => Effect.Effect<Option.Option<StorageSource>, StorageSourceStoreError>;
    readonly getResolvedSource: (
      projectId: MercurianProjectId,
      kind: ProjectStorageKind,
    ) => Effect.Effect<Option.Option<ResolvedStorageSource>, StorageSourceStoreError>;
    readonly changes: Stream.Stream<{
      readonly projectId: MercurianProjectId;
      readonly kind: ProjectStorageKind;
    }>;
  }
>()("t3/mercurian/storage/StorageSourceStore") {}

const StorageSourceRow = Schema.Struct({
  kind: ProjectStorageKind,
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
const ProjectRequest = Schema.Struct({ projectId: MercurianProjectId, kind: ProjectStorageKind });
const RepositoryRequest = Schema.Struct({ repositoryId: MercurianRepositoryId });
const NoRequest = Schema.Struct({});

function toStoreError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): StorageSourceStoreError =>
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
  const changesPubSub = yield* PubSub.unbounded<{
    readonly projectId: MercurianProjectId;
    readonly kind: ProjectStorageKind;
  }>();
  const announceChange = (projectId: MercurianProjectId, kind: ProjectStorageKind) =>
    PubSub.publish(changesPubSub, { projectId, kind }).pipe(Effect.asVoid);

  const columns = sql`
    kind AS "kind",
    project_id AS "projectId",
    repository_id AS "repositoryId",
    subpath AS "subpath",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;
  const listRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: StorageSourceRow,
    execute: () => sql`
      SELECT ${columns} FROM project_storage_sources
      ORDER BY created_at ASC, project_id ASC
    `,
  });
  const findRow = SqlSchema.findOneOption({
    Request: ProjectRequest,
    Result: StorageSourceRow,
    execute: ({ projectId, kind }) => sql`
      SELECT ${columns} FROM project_storage_sources WHERE project_id = ${projectId} AND kind = ${kind}
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
    Request: StorageSourceRow,
    execute: (row) => sql`
      INSERT INTO project_storage_sources
        (project_id, kind, repository_id, subpath, created_at, updated_at)
      VALUES (${row.projectId}, ${row.kind}, ${row.repositoryId}, ${row.subpath}, ${row.createdAt}, ${row.updatedAt})
      ON CONFLICT(project_id, kind) DO UPDATE SET
        repository_id = excluded.repository_id,
        subpath = excluded.subpath,
        updated_at = excluded.updated_at
    `,
  });
  const deleteRow = SqlSchema.void({
    Request: ProjectRequest,
    execute: ({ projectId, kind }) => sql`
      DELETE FROM project_storage_sources WHERE project_id = ${projectId} AND kind = ${kind}
    `,
  });

  const resolveRoot = Effect.fn("StorageSourceStore.resolveRoot")(function* (
    repository: typeof RepositoryRow.Type,
    subpath: string | null,
    allowMissing = false,
  ) {
    const candidate = path.resolve(repository.path, subpath ?? ".");
    const invalid = (
      reason: "missing" | "not-a-directory" | "outside-repository" | "nested-repository",
    ) =>
      new MemorySourceInvalidError({
        repositoryId: repository.repositoryId,
        ...(subpath === null ? {} : { subpath }),
        reason,
      });
    const canonicalRepository = yield* fs
      .realPath(repository.path)
      .pipe(Effect.mapError(() => invalid("missing")));
    let existing = candidate;
    if (allowMissing) {
      while (!(yield* fs.exists(existing)) && existing !== path.dirname(existing))
        existing = path.dirname(existing);
    }
    const canonicalCandidate = yield* fs
      .realPath(existing)
      .pipe(Effect.mapError(() => invalid("missing")));
    const relative = path.relative(canonicalRepository, canonicalCandidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return yield* invalid("outside-repository");
    }
    const info = yield* fs.stat(canonicalCandidate).pipe(Effect.mapError(() => invalid("missing")));
    if (info.type !== "Directory") {
      return yield* invalid("not-a-directory");
    }
    let ancestor = canonicalCandidate;
    while (ancestor !== canonicalRepository && ancestor !== path.dirname(ancestor)) {
      if (yield* fs.exists(path.join(ancestor, ".git"))) return yield* invalid("nested-repository");
      ancestor = path.dirname(ancestor);
    }
    return path.resolve(canonicalCandidate, path.relative(existing, candidate));
  });

  const getSource: StorageSourceStore["Service"]["getSource"] = (projectId, kind) =>
    findRow({ projectId, kind }).pipe(
      Effect.mapError(
        toStoreError("StorageSourceStore.getSource:query", "StorageSourceStore.getSource:decode"),
      ),
    );

  const getResolvedSource: StorageSourceStore["Service"]["getResolvedSource"] = (projectId, kind) =>
    Effect.gen(function* () {
      const source = yield* findRow({ projectId, kind });
      if (Option.isNone(source)) return Option.none<ResolvedStorageSource>();
      const repository = yield* findRepository({ repositoryId: source.value.repositoryId });
      if (Option.isNone(repository)) {
        return yield* new MemorySourceInvalidError({
          repositoryId: source.value.repositoryId,
          ...(source.value.subpath === null ? {} : { subpath: source.value.subpath }),
          reason: "repository-not-found",
        });
      }
      const rootPath = yield* resolveRoot(
        repository.value,
        source.value.subpath,
        source.value.kind !== "memory",
      );
      return Option.some({
        ...source.value,
        repositoryName: repository.value.name,
        repositoryPath: repository.value.path,
        rootPath,
      });
    }).pipe(
      Effect.mapError(
        toStoreError(
          "StorageSourceStore.getResolvedSource:query",
          "StorageSourceStore.getResolvedSource:decode",
        ),
      ),
    );

  const designate: StorageSourceStore["Service"]["designate"] = (input) =>
    Effect.gen(function* () {
      const repository = yield* findRepository({ repositoryId: input.repositoryId });
      const requested = input.subpath?.trim() ?? "";
      if (path.isAbsolute(requested) || /^[A-Za-z]:/u.test(requested))
        return yield* new MemorySourceInvalidError({
          repositoryId: input.repositoryId,
          subpath: requested,
          reason: "outside-repository",
        });
      const normalized = path.normalize(requested || ".").replace(/[/\\]+$/gu, "") || ".";
      const subpath = normalized === "." ? null : normalized;
      if (normalized === ".." || normalized.startsWith(`..${path.sep}`))
        return yield* new MemorySourceInvalidError({
          repositoryId: input.repositoryId,
          subpath: requested,
          reason: "outside-repository",
        });
      if (Option.isNone(repository)) {
        return yield* new MemorySourceInvalidError({
          repositoryId: input.repositoryId,
          ...(subpath === null ? {} : { subpath }),
          reason: "repository-not-found",
        });
      }
      const root = yield* resolveRoot(repository.value, subpath, input.kind !== "memory");
      for (const other of yield* listRows({})) {
        if (
          other.projectId !== input.projectId ||
          other.repositoryId !== input.repositoryId ||
          other.kind === input.kind
        )
          continue;
        const otherRoot = yield* resolveRoot(repository.value, other.subpath, true);
        const inside = (parent: string, child: string) => {
          const relative = path.relative(parent, child);
          return (
            relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
          );
        };
        if (inside(root, otherRoot) || inside(otherRoot, root))
          return yield* new MemorySourceInvalidError({
            repositoryId: input.repositoryId,
            ...(subpath ? { subpath } : {}),
            reason: "overlapping-location",
          });
      }
      yield* upsertRow({
        projectId: input.projectId,
        kind: input.kind,
        repositoryId: input.repositoryId,
        subpath,
        createdAt: input.now,
        updatedAt: input.now,
      });
      if (input.kind !== "memory")
        yield* sql`INSERT INTO project_document_locations(project_id, kind, repository_id, subpath, created_at, updated_at) VALUES (${input.projectId}, ${input.kind}, ${input.repositoryId}, ${subpath ?? ""}, ${DateTime.formatIso(input.now)}, ${DateTime.formatIso(input.now)}) ON CONFLICT(project_id, kind, repository_id, subpath) DO NOTHING`;
      yield* announceChange(input.projectId, input.kind);
    }).pipe(
      Effect.mapError(
        toStoreError("StorageSourceStore.designate:query", "StorageSourceStore.designate:decode"),
      ),
    );

  const remove: StorageSourceStore["Service"]["remove"] = (projectId, kind) =>
    Effect.gen(function* () {
      yield* deleteRow({ projectId, kind });
      yield* announceChange(projectId, kind);
    }).pipe(
      Effect.mapError(
        toStoreError("StorageSourceStore.remove:query", "StorageSourceStore.remove:decode"),
      ),
    );

  const getSnapshot = listRows({}).pipe(
    Effect.mapError(
      toStoreError("StorageSourceStore.getSnapshot:query", "StorageSourceStore.getSnapshot:decode"),
    ),
  );

  return {
    designate,
    remove,
    getSnapshot,
    getDocumentLocations: SqlSchema.findAll({
      Request: NoRequest,
      Result: StorageSourceRow,
      execute: () => sql`SELECT ${columns} FROM project_document_locations ORDER BY created_at ASC`,
    })({}).pipe(
      Effect.mapError(
        toStoreError("StorageSourceStore.locations:query", "StorageSourceStore.locations:decode"),
      ),
    ),
    getSource,
    getResolvedSource,
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies StorageSourceStore["Service"];
});

export const layer = Layer.effect(StorageSourceStore, make);
