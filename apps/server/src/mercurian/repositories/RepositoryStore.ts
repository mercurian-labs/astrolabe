/**
 * RepositoryStore — the registry of codebases Mercurian can reach.
 *
 * Three rules shape the surface:
 *
 * - git is expected but not demanded. Adding a plain directory succeeds,
 *   because grounding reads files either way; `hasGit` is probed live on every
 *   read, so everything working-tree-shaped lights up on its own the moment
 *   someone runs `git init` and goes dark again if the directory stops being a
 *   repository. Nothing about it is stored, so nothing about it can go stale;
 * - removal disconnects rather than erases. The row, its scripts, and its
 *   project memberships go; the files stay, and grounding references already
 *   written into plan histories stay with them — they are content, not foreign
 *   keys, so there is nothing here that could dangle them;
 * - a repository the app is holding live worktrees on cannot be removed. There
 *   is no force flag: the way out is to end the sessions.
 *
 * Scripts are app-owned and per-machine by construction. They live in this
 * database, and nothing here ever writes into a repository.
 *
 * @module RepositoryStore
 */
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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
  MercurianProjectId,
  MercurianProjectNotFoundError,
  MercurianRepositoryId,
  MercurianRepositoryNotFoundError,
  MercurianRepositoryScriptId,
  RepositoryAlreadyRegisteredError,
  RepositoryHasLiveWorktreesError,
  RepositoryPathInvalidError,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";
import * as ProcessRunner from "../../processRunner.ts";
import type { ProjectRepositoryLink, Repository, RepositoryView } from "./schema.ts";

// ===============================
// Domain
// ===============================

export interface RepositoriesSnapshot {
  readonly repositories: ReadonlyArray<RepositoryView>;
  readonly projectRepositories: ReadonlyArray<ProjectRepositoryLink>;
}

export type RepositoryStoreRefusal =
  | MercurianProjectNotFoundError
  | MercurianRepositoryNotFoundError
  | RepositoryAlreadyRegisteredError
  | RepositoryPathInvalidError
  | RepositoryHasLiveWorktreesError;

export type RepositoryStoreError =
  | RepositoryStoreRefusal
  | PersistenceSqlError
  | PersistenceDecodeError;

// ===============================
// Inputs
// ===============================

export const AddRepositoryInput = Schema.Struct({
  path: Schema.String,
  name: Schema.optional(TrimmedNonEmptyString),
  createdAt: Schema.DateTimeUtcFromString,
});
export type AddRepositoryInput = typeof AddRepositoryInput.Type;

export const RemoveRepositoryInput = Schema.Struct({ repositoryId: MercurianRepositoryId });
export type RemoveRepositoryInput = typeof RemoveRepositoryInput.Type;

/** A script on its way in: no id for a new one, the existing id for an edit. */
export const SaveScriptInput = Schema.Struct({
  scriptId: Schema.optional(MercurianRepositoryScriptId),
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  isSetup: Schema.Boolean,
});
export type SaveScriptInput = typeof SaveScriptInput.Type;

export const SaveScriptsInput = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  scripts: Schema.Array(SaveScriptInput),
  updatedAt: Schema.DateTimeUtcFromString,
});
export type SaveScriptsInput = typeof SaveScriptsInput.Type;

export const SetProjectRepositoriesInput = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryIds: Schema.Array(MercurianRepositoryId),
  addedAt: Schema.DateTimeUtcFromString,
});
export type SetProjectRepositoriesInput = typeof SetProjectRepositoriesInput.Type;

// ===============================
// Service
// ===============================

export class RepositoryStore extends Context.Service<
  RepositoryStore,
  {
    /**
     * Register a directory. The path is resolved before it is stored, so two
     * spellings of the same place are one registration; git is deliberately
     * not checked — a directory that is not a repository is still readable.
     */
    readonly addRepository: (
      input: AddRepositoryInput,
    ) => Effect.Effect<RepositoryView, RepositoryStoreError>;
    /** Every repository and every project membership, in one value. */
    readonly getSnapshot: Effect.Effect<RepositoriesSnapshot, RepositoryStoreError>;
    /**
     * Disconnect a repository: its row, its scripts, and its project
     * memberships. Refused while the app holds live worktrees on it.
     */
    readonly removeRepository: (
      input: RemoveRepositoryInput,
    ) => Effect.Effect<void, RepositoryStoreError>;
    /**
     * Replace the repository's whole script list. Ids are minted from names;
     * a script that carries one keeps it, which is what makes an edit an edit.
     */
    readonly saveScripts: (
      input: SaveScriptsInput,
    ) => Effect.Effect<RepositoryView, RepositoryStoreError>;
    /** Replace a project's repository set. Context, never a stamp. */
    readonly setProjectRepositories: (
      input: SetProjectRepositoriesInput,
    ) => Effect.Effect<void, RepositoryStoreError>;
    /** Fires once per mutation. What keeps a subscribed registry fresh. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/mercurian/repositories/RepositoryStore") {}

// ===============================
// Rows
// ===============================

const RepositoryRow = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  name: Schema.String,
  path: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

const ScriptRow = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  scriptId: MercurianRepositoryScriptId,
  name: Schema.String,
  command: Schema.String,
  previewUrl: Schema.NullOr(Schema.String),
  isSetup: Schema.Number,
  position: Schema.Number,
});

const LinkRow = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
});

const LinkInsertRow = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
  addedAt: Schema.DateTimeUtcFromString,
});

const RepositoryIdRequest = Schema.Struct({ repositoryId: MercurianRepositoryId });
const ProjectIdRequest = Schema.Struct({ projectId: MercurianProjectId });
const PathRequest = Schema.Struct({ path: Schema.String });
const TouchRepositoryRequest = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  updatedAt: Schema.DateTimeUtcFromString,
});
const NoRequest = Schema.Struct({});

// ===============================
// Helpers
// ===============================

const SCRIPT_ID_MAX_LENGTH = 48;

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= SCRIPT_ID_MAX_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, SCRIPT_ID_MAX_LENGTH).replace(/-+$/g, "") || "script";
}

/**
 * A stable, legible id from the script's name — the t3code project-script
 * normalization, moved to where the minting now happens. Two scripts named the
 * same get a numeric suffix rather than one overwriting the other.
 */
export function nextScriptId(name: string, taken: ReadonlySet<string>): string {
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${baseId}-${taken.size + 1}`;
}

/** `worktree <path>` lines, in the order `--porcelain` reports them. */
export function parseWorktreePaths(stdout: string): ReadonlyArray<string> {
  const paths: Array<string> = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("worktree ")) continue;
    const worktreePath = trimmed.slice("worktree ".length).trim();
    if (worktreePath.length > 0) paths.push(worktreePath);
  }
  return paths;
}

/**
 * Whether a path sits inside a directory the app owns.
 *
 * A user's own hand-made worktree somewhere else on disk is theirs and never
 * blocks removal — the floor is about the workspaces this runtime holds open,
 * not about git trivia.
 */
export function isUnderDirectory(candidate: string, directory: string, separator: string): boolean {
  const normalizedDirectory = directory.endsWith(separator)
    ? directory.slice(0, -separator.length)
    : directory;
  return (
    candidate === normalizedDirectory || candidate.startsWith(`${normalizedDirectory}${separator}`)
  );
}

const isRepositoryStoreRefusal = Schema.is(
  Schema.Union([
    MercurianProjectNotFoundError,
    MercurianRepositoryNotFoundError,
    RepositoryAlreadyRegisteredError,
    RepositoryPathInvalidError,
    RepositoryHasLiveWorktreesError,
  ]),
);

function toRepositoryStoreError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): RepositoryStoreError =>
    isRepositoryStoreRefusal(cause)
      ? cause
      : Schema.isSchemaError(cause)
        ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
        : isPersistenceError(cause)
          ? cause
          : new PersistenceSqlError({ operation: sqlOperation, cause });
}

const GIT_PROBE_TTL = Duration.minutes(1);
const GIT_PROBE_CACHE_CAPACITY = 512;

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const { worktreesDir } = yield* ServerConfig;
  const changesPubSub = yield* PubSub.unbounded<void>();

  const announceChange = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);

  // ---------------------------------------------------------------
  // Git, read from the machine rather than from a column
  // ---------------------------------------------------------------

  // git is a real executable on every platform — no shell mode, which would
  // re-tokenize paths containing spaces.
  const runGit = (repositoryPath: string, args: ReadonlyArray<string>) =>
    processRunner
      .run({
        command: "git",
        args: ["-C", repositoryPath, ...args],
        timeoutBehavior: "timedOutResult",
      })
      .pipe(Effect.option);

  const probeGit = Effect.fn("RepositoryStore.probeGit")(function* (repositoryPath: string) {
    const result = yield* runGit(repositoryPath, ["rev-parse", "--show-toplevel"]);
    return Option.isSome(result) && result.value.code === 0;
  });

  // Short-lived so a snapshot re-emit stays cheap, and short enough that a
  // fresh `git init` shows up without anyone pressing anything.
  const gitProbeCache = yield* Cache.makeWith<string, boolean>(probeGit, {
    capacity: GIT_PROBE_CACHE_CAPACITY,
    timeToLive: Exit.match({ onSuccess: () => GIT_PROBE_TTL, onFailure: () => Duration.zero }),
  });

  const hasGit = (repositoryPath: string) => Cache.get(gitProbeCache, repositoryPath);

  /**
   * The teardown floor's live source today. Coding sessions have no table yet,
   * but the workspaces this runtime owns are real on disk: a linked worktree
   * under `worktreesDir` is one, and its existence refuses removal. When
   * sessions land store-side worktree state this check gains that source
   * without the refusal or the RPC moving.
   */
  const countLiveWorktrees = Effect.fn("RepositoryStore.countLiveWorktrees")(function* (
    repositoryPath: string,
  ) {
    if (!(yield* hasGit(repositoryPath))) return 0;
    const result = yield* runGit(repositoryPath, ["worktree", "list", "--porcelain"]);
    if (Option.isNone(result) || result.value.code !== 0) return 0;
    return parseWorktreePaths(result.value.stdout).filter((worktreePath) =>
      isUnderDirectory(worktreePath, worktreesDir, path.sep),
    ).length;
  });

  // ---------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------

  const repositoryColumns = sql`
    repository_id AS "repositoryId",
    name AS "name",
    path AS "path",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;

  const insertRepositoryRow = SqlSchema.void({
    Request: RepositoryRow,
    execute: (row) => sql`
      INSERT INTO repositories (repository_id, name, path, created_at, updated_at)
      VALUES (${row.repositoryId}, ${row.name}, ${row.path}, ${row.createdAt}, ${row.updatedAt})
    `,
  });

  const findRepositoryRow = SqlSchema.findOneOption({
    Request: RepositoryIdRequest,
    Result: RepositoryRow,
    execute: ({ repositoryId }) => sql`
      SELECT ${repositoryColumns}
      FROM repositories
      WHERE repository_id = ${repositoryId}
    `,
  });

  const findRepositoryRowByPath = SqlSchema.findOneOption({
    Request: PathRequest,
    Result: RepositoryRow,
    execute: ({ path: repositoryPath }) => sql`
      SELECT ${repositoryColumns}
      FROM repositories
      WHERE path = ${repositoryPath}
    `,
  });

  const listRepositoryRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: RepositoryRow,
    execute: () => sql`
      SELECT ${repositoryColumns}
      FROM repositories
      ORDER BY created_at ASC, repository_id ASC
    `,
  });

  const deleteRepositoryRow = SqlSchema.void({
    Request: RepositoryIdRequest,
    execute: ({ repositoryId }) => sql`
      DELETE FROM repositories WHERE repository_id = ${repositoryId}
    `,
  });

  const touchRepositoryRow = SqlSchema.void({
    Request: TouchRepositoryRequest,
    execute: ({ repositoryId, updatedAt }) => sql`
      UPDATE repositories SET updated_at = ${updatedAt} WHERE repository_id = ${repositoryId}
    `,
  });

  const listScriptRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: ScriptRow,
    execute: () => sql`
      SELECT
        repository_id AS "repositoryId",
        script_id AS "scriptId",
        name AS "name",
        command AS "command",
        preview_url AS "previewUrl",
        is_setup AS "isSetup",
        position AS "position"
      FROM repository_scripts
      ORDER BY repository_id ASC, position ASC
    `,
  });

  const insertScriptRow = SqlSchema.void({
    Request: ScriptRow,
    execute: (row) => sql`
      INSERT INTO repository_scripts
        (repository_id, script_id, name, command, preview_url, is_setup, position)
      VALUES (
        ${row.repositoryId},
        ${row.scriptId},
        ${row.name},
        ${row.command},
        ${row.previewUrl},
        ${row.isSetup},
        ${row.position}
      )
    `,
  });

  const deleteScriptRows = SqlSchema.void({
    Request: RepositoryIdRequest,
    execute: ({ repositoryId }) => sql`
      DELETE FROM repository_scripts WHERE repository_id = ${repositoryId}
    `,
  });

  const listLinkRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: LinkRow,
    execute: () => sql`
      SELECT
        project_id AS "projectId",
        repository_id AS "repositoryId"
      FROM project_repositories
      ORDER BY project_id ASC, added_at ASC, repository_id ASC
    `,
  });

  const insertLinkRow = SqlSchema.void({
    Request: LinkInsertRow,
    execute: (row) => sql`
      INSERT INTO project_repositories (project_id, repository_id, added_at)
      VALUES (${row.projectId}, ${row.repositoryId}, ${row.addedAt})
    `,
  });

  const deleteLinkRowsForProject = SqlSchema.void({
    Request: ProjectIdRequest,
    execute: ({ projectId }) => sql`
      DELETE FROM project_repositories WHERE project_id = ${projectId}
    `,
  });

  const deleteLinkRowsForRepository = SqlSchema.void({
    Request: RepositoryIdRequest,
    execute: ({ repositoryId }) => sql`
      DELETE FROM project_repositories WHERE repository_id = ${repositoryId}
    `,
  });

  // Project existence is an ordinary same-database query: the join's other
  // parent lives here too, so this store does not need the planning store.
  const countProjectRows = SqlSchema.findAll({
    Request: ProjectIdRequest,
    Result: Schema.Struct({ projectId: MercurianProjectId }),
    execute: ({ projectId }) => sql`
      SELECT project_id AS "projectId" FROM projects WHERE project_id = ${projectId}
    `,
  });

  // ---------------------------------------------------------------
  // Assembly
  // ---------------------------------------------------------------

  const toScript = (row: typeof ScriptRow.Type) => ({
    scriptId: row.scriptId,
    name: row.name,
    command: row.command,
    ...(row.previewUrl === null || row.previewUrl.trim().length === 0
      ? {}
      : { previewUrl: row.previewUrl }),
    isSetup: row.isSetup !== 0,
  });

  const toRepository = (
    row: typeof RepositoryRow.Type,
    scriptRows: ReadonlyArray<typeof ScriptRow.Type>,
  ): Repository => ({
    repositoryId: row.repositoryId,
    name: row.name,
    path: row.path,
    scripts: scriptRows.map(toScript),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const readRepositoryView = Effect.fn("RepositoryStore.readRepositoryView")(function* (
    repositoryId: MercurianRepositoryId,
  ) {
    const row = yield* findRepositoryRow({ repositoryId });
    if (Option.isNone(row)) {
      return yield* new MercurianRepositoryNotFoundError({ repositoryId });
    }
    const scripts = yield* listScriptRows({});
    return {
      ...toRepository(
        row.value,
        scripts.filter((script) => script.repositoryId === repositoryId),
      ),
      hasGit: yield* hasGit(row.value.path),
    } satisfies RepositoryView;
  });

  /**
   * The path as this machine knows it: `~` expanded, symlinks resolved. Doing
   * it before the uniqueness check is what makes two spellings of the same
   * directory one registration rather than two rows.
   */
  const resolvePath = Effect.fn("RepositoryStore.resolvePath")(function* (candidate: string) {
    const requested = candidate.trim();
    const expanded = expandHomePath(requested);
    const resolved = yield* fs
      .realPath(expanded)
      .pipe(
        Effect.mapError(
          () => new RepositoryPathInvalidError({ path: requested, reason: "missing" }),
        ),
      );
    const info = yield* fs
      .stat(resolved)
      .pipe(
        Effect.mapError(
          () => new RepositoryPathInvalidError({ path: requested, reason: "missing" }),
        ),
      );
    if (info.type !== "Directory") {
      return yield* new RepositoryPathInvalidError({ path: requested, reason: "not-a-directory" });
    }
    return resolved;
  });

  // ---------------------------------------------------------------
  // Service
  // ---------------------------------------------------------------

  const addRepository: RepositoryStore["Service"]["addRepository"] = (input) =>
    Effect.gen(function* () {
      const resolved = yield* resolvePath(input.path);

      const existing = yield* findRepositoryRowByPath({ path: resolved });
      if (Option.isSome(existing)) {
        return yield* new RepositoryAlreadyRegisteredError({
          repositoryId: existing.value.repositoryId,
          name: existing.value.name,
          path: existing.value.path,
        });
      }

      // What a person would call it when they do not say otherwise.
      const derivedName = path.basename(resolved).trim();
      const name = input.name ?? (derivedName.length > 0 ? derivedName : resolved);
      const repositoryId = yield* crypto.randomUUIDv4.pipe(Effect.map(MercurianRepositoryId.make));

      yield* sql.withTransaction(
        insertRepositoryRow({
          repositoryId,
          name,
          path: resolved,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        }),
      );
      yield* announceChange;

      return {
        repositoryId,
        name,
        path: resolved,
        scripts: [],
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        hasGit: yield* hasGit(resolved),
      } satisfies RepositoryView;
    }).pipe(
      Effect.mapError(
        toRepositoryStoreError(
          "RepositoryStore.addRepository:query",
          "RepositoryStore.addRepository:encodeRequest",
        ),
      ),
    );

  const getSnapshot: RepositoryStore["Service"]["getSnapshot"] = Effect.gen(function* () {
    const [repositoryRows, scriptRows, linkRows] = yield* Effect.all([
      listRepositoryRows({}),
      listScriptRows({}),
      listLinkRows({}),
    ]);
    const repositories = yield* Effect.forEach(repositoryRows, (row) =>
      hasGit(row.path).pipe(
        Effect.map(
          (rowHasGit) =>
            ({
              ...toRepository(
                row,
                scriptRows.filter((script) => script.repositoryId === row.repositoryId),
              ),
              hasGit: rowHasGit,
            }) satisfies RepositoryView,
        ),
      ),
    );
    return { repositories, projectRepositories: linkRows } satisfies RepositoriesSnapshot;
  }).pipe(
    Effect.mapError(
      toRepositoryStoreError(
        "RepositoryStore.getSnapshot:query",
        "RepositoryStore.getSnapshot:decodeRows",
      ),
    ),
  );

  const removeRepository: RepositoryStore["Service"]["removeRepository"] = (input) =>
    Effect.gen(function* () {
      const row = yield* findRepositoryRow({ repositoryId: input.repositoryId });
      if (Option.isNone(row)) {
        return yield* new MercurianRepositoryNotFoundError({ repositoryId: input.repositoryId });
      }

      const worktreeCount = yield* countLiveWorktrees(row.value.path);
      if (worktreeCount > 0) {
        return yield* new RepositoryHasLiveWorktreesError({
          repositoryId: input.repositoryId,
          worktreeCount,
        });
      }

      // The cascades in the schema would do this; saying it here keeps the act
      // one readable transaction rather than a pragma's side effect.
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* deleteScriptRows({ repositoryId: input.repositoryId });
          yield* deleteLinkRowsForRepository({ repositoryId: input.repositoryId });
          yield* deleteRepositoryRow({ repositoryId: input.repositoryId });
        }),
      );
      yield* announceChange;
    }).pipe(
      Effect.mapError(
        toRepositoryStoreError(
          "RepositoryStore.removeRepository:query",
          "RepositoryStore.removeRepository:encodeRequest",
        ),
      ),
    );

  const saveScripts: RepositoryStore["Service"]["saveScripts"] = (input) =>
    Effect.gen(function* () {
      const row = yield* findRepositoryRow({ repositoryId: input.repositoryId });
      if (Option.isNone(row)) {
        return yield* new MercurianRepositoryNotFoundError({ repositoryId: input.repositoryId });
      }

      // Ids already in the list are reserved before any minting, so a new
      // script never steals the id an edited one is keeping.
      const taken = new Set(
        input.scripts.flatMap((script) => (script.scriptId === undefined ? [] : [script.scriptId])),
      );
      const scripts = input.scripts.map((script, position) => {
        const scriptId =
          script.scriptId ?? MercurianRepositoryScriptId.make(nextScriptId(script.name, taken));
        taken.add(scriptId);
        return {
          repositoryId: input.repositoryId,
          scriptId,
          name: script.name,
          command: script.command,
          previewUrl: script.previewUrl ?? null,
          isSetup: script.isSetup ? 1 : 0,
          position,
        };
      });

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* deleteScriptRows({ repositoryId: input.repositoryId });
          yield* Effect.forEach(scripts, insertScriptRow, { discard: true });
          yield* touchRepositoryRow({
            repositoryId: input.repositoryId,
            updatedAt: input.updatedAt,
          });
        }),
      );
      yield* announceChange;

      return yield* readRepositoryView(input.repositoryId);
    }).pipe(
      Effect.mapError(
        toRepositoryStoreError(
          "RepositoryStore.saveScripts:query",
          "RepositoryStore.saveScripts:encodeRequest",
        ),
      ),
    );

  const setProjectRepositories: RepositoryStore["Service"]["setProjectRepositories"] = (input) =>
    Effect.gen(function* () {
      const projects = yield* countProjectRows({ projectId: input.projectId });
      if (projects.length === 0) {
        return yield* new MercurianProjectNotFoundError({ projectId: input.projectId });
      }

      // Every named repository has to exist before any of the set is written:
      // a half-applied set is not a state anyone asked for.
      const unique = [...new Set(input.repositoryIds)];
      for (const repositoryId of unique) {
        const row = yield* findRepositoryRow({ repositoryId });
        if (Option.isNone(row)) {
          return yield* new MercurianRepositoryNotFoundError({ repositoryId });
        }
      }

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* deleteLinkRowsForProject({ projectId: input.projectId });
          yield* Effect.forEach(
            unique,
            (repositoryId) =>
              insertLinkRow({
                projectId: input.projectId,
                repositoryId,
                addedAt: input.addedAt,
              }),
            { discard: true },
          );
        }),
      );
      yield* announceChange;
    }).pipe(
      Effect.mapError(
        toRepositoryStoreError(
          "RepositoryStore.setProjectRepositories:query",
          "RepositoryStore.setProjectRepositories:encodeRequest",
        ),
      ),
    );

  return {
    addRepository,
    getSnapshot,
    removeRepository,
    saveScripts,
    setProjectRepositories,
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies RepositoryStore["Service"];
});

export const layer = Layer.effect(RepositoryStore, make);
