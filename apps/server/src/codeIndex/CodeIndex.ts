import { blobSizes, readBlobs } from "@mercurian/code-graph/git";
import { isIndexable, languageOf } from "@mercurian/code-graph/languages";
import {
  CodeIndexError,
  DEFAULT_CODE_INDEX_SETTINGS,
  type CodeChanges,
  type CodeChangesInput,
  type CodeCheckout,
  type CodeFindInput,
  type CodeFindResult,
  type CodeIndexProjectInput,
  type CodeIndexSettings,
  type CodeIndexStatus,
  type CodeIndexStorage,
  type CodeLocalGraph,
  type CodeLocalGraphInput,
  type CodeMap,
  type CodeMapInput,
  type CodeOutline,
  type CodeOutlineInput,
  type ProjectId,
  type ServerSettings,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { makeKeyedCoalescingWorker } from "@t3tools/shared/KeyedCoalescingWorker";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerConfig from "../config.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as WikiService from "../wiki/WikiService.ts";
import {
  applyTreeDiff,
  filterListing,
  gitFailed,
  isManifest,
  parseLsTree,
  parseStatus,
  runGit,
  skipMatcher,
  type Listing,
  type View,
} from "./checkout.ts";
import { decodeJson, type StoredFacts, type StoredImport } from "./facts.ts";
import * as Queries from "./queries.ts";
import {
  CheckoutModules,
  Packages,
  readManifest,
  type FileView,
  type WorkspacePackage,
} from "./resolve.ts";
import {
  openStore,
  SCHEMA_VERSION,
  schemaVersionOf,
  VersionState,
  type WrittenVersion,
} from "./store.ts";
import { WorkerJob, WorkerOutput } from "./workerProtocol.ts";

/**
 * Astrolabe: each repository's code index. People reach it through the WebSocket (status,
 * Settings, the Repositories local graph) and agents through the `astrolabe_code_*` MCP tools; both call
 * these methods, so neither transport holds index logic.
 */
export class CodeIndex extends Context.Service<
  CodeIndex,
  {
    /** Every repository's status now, then each change. */
    readonly subscribe: Stream.Stream<CodeIndexStatus>;
    readonly status: (projectId: ProjectId) => Effect.Effect<CodeIndexStatus, CodeIndexError>;
    /** Drop the repository's index and build it again in the background. */
    readonly rebuild: (input: CodeIndexProjectInput) => Effect.Effect<void, CodeIndexError>;
    readonly storage: Effect.Effect<CodeIndexStorage, CodeIndexError>;
    /** Remove file versions no branch, worktree or checkpoint uses; run by storage cleanup. */
    readonly prune: Effect.Effect<
      { readonly bytesFreed: number; readonly fileVersions: number },
      CodeIndexError
    >;
    /** Delete every index; each enabled repository builds again. */
    readonly clear: Effect.Effect<void, CodeIndexError>;
    readonly localGraph: (
      input: CodeLocalGraphInput,
    ) => Effect.Effect<CodeLocalGraph, CodeIndexError>;
    readonly outline: (input: CodeOutlineInput) => Effect.Effect<CodeOutline, CodeIndexError>;
    readonly find: (input: CodeFindInput) => Effect.Effect<CodeFindResult, CodeIndexError>;
    readonly changes: (input: CodeChangesInput) => Effect.Effect<CodeChanges, CodeIndexError>;
    readonly map: (input: CodeMapInput) => Effect.Effect<CodeMap, CodeIndexError>;
  }
>()("t3/codeIndex/CodeIndex") {}

const notBuilt = Effect.fn("CodeIndex.placeholder")(function* () {
  return yield* new CodeIndexError({
    reason: "unsupported",
    message: "The code index is not available yet.",
  });
});

/** Stands in until the index is built: reads fail as unsupported, maintenance has nothing to do. */
export const layerPlaceholder = Layer.succeed(
  CodeIndex,
  CodeIndex.of({
    subscribe: Stream.empty,
    status: notBuilt,
    rebuild: notBuilt,
    storage: Effect.succeed({ bytes: 0, fileVersions: 0, unusedFileVersions: 0 }),
    prune: Effect.succeed({ bytesFreed: 0, fileVersions: 0 }),
    clear: Effect.void,
    localGraph: notBuilt,
    outline: notBuilt,
    find: notBuilt,
    changes: notBuilt,
    map: notBuilt,
  }),
);

// Workers.

/** Runs one worker job, handing each line it prints to `onOutput`. */
export type WorkerRunner = (
  job: WorkerJob,
  onOutput: (output: WorkerOutput) => Effect.Effect<void>,
) => Effect.Effect<void, CodeIndexError>;

export interface WorkerCommand {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
}

const NO_WORKER =
  "This build of Astrolabe has no code index worker. Run the desktop app or the npm package to index repositories.";

/**
 * The worker beside this module: its source in a checkout, or the bundle's
 * `code-index-worker.mjs` with the grammars and queries copied beside it (`code-graph/`). A single
 * executable carries neither, so it has none.
 */
export const workerCommand = Effect.fn("CodeIndex.workerCommand")(function* () {
  if (yield* HostProcess.IsExecutable) return null;
  const path = yield* Path.Path;
  const executable = yield* HostProcess.ExecutablePath;
  const fromSource = import.meta.url.endsWith(".ts");
  const script = yield* path.fromFileUrl(
    new URL(fromSource ? "./worker.ts" : "./code-index-worker.mjs", import.meta.url),
  );
  const assets = fromSource
    ? []
    : ["--assets", yield* path.fromFileUrl(new URL("./code-graph/", import.meta.url))];
  const strip = fromSource ? ["--experimental-strip-types", "--no-warnings"] : [];
  return { executable, args: [...strip, script, ...assets] } satisfies WorkerCommand;
});

/** A worker job's deadline: far past a chunk's few seconds, short of a wedged process. */
const WORKER_TIMEOUT = "10 minutes";

const encodeJob = Schema.encodeEffect(Schema.fromJsonString(WorkerJob));
const decodeOutput = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkerOutput));

export const makeWorkerRunner = Effect.fn("CodeIndex.makeWorkerRunner")(function* (
  command: WorkerCommand,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const environment = yield* HostProcess.Environment;
  const failed = (message: string) => (cause: unknown) =>
    new CodeIndexError({ reason: "failed", message, cause });
  const run: WorkerRunner = Effect.fn("CodeIndex.runWorker")(
    function* (job, onOutput) {
      const input = yield* encodeJob(job).pipe(Effect.mapError(failed("Could not write the job.")));
      const child = yield* spawner
        .spawn(
          ChildProcess.make(command.executable, command.args, {
            env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
            stdin: { stream: Stream.encodeText(Stream.make(input)) },
            forceKillAfter: "1 second",
          }),
        )
        .pipe(Effect.mapError(failed("Could not start the code index worker.")));
      const [, stderr, exitCode] = yield* Effect.all(
        [
          child.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.filter((line) => line.trim() !== ""),
            Stream.mapEffect((line) => decodeOutput(line)),
            Stream.runForEach(onOutput),
          ),
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          child.exitCode.pipe(Effect.map(Number)),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.mapError(failed("The code index worker stopped.")));
      if (exitCode !== 0) {
        const reason = stderr.trim().split("\n")[0] || `exit ${exitCode}`;
        return yield* new CodeIndexError({
          reason: "failed",
          message: `The code index worker failed: ${reason}`,
        });
      }
    },
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: WORKER_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new CodeIndexError({ reason: "failed", message: "The code index worker timed out." }),
        ),
    }),
  );
  return run;
});

// The index.

const DB_FILE = "code-index.sqlite";
/** Larger files are skipped: generated or data, and slow to parse. */
const MAX_FILE_BYTES = 512 * 1024;
/** Files per worker job: a few seconds of parsing, so pausing and cancelling take effect soon. */
const CHUNK_FILES = 250;
/** A parse job holds one permit, a delete all of them, so nothing parses while facts go. */
const STORE_PERMITS = 64;
const LISTINGS_KEPT = 4;
/** Decoded file versions kept between questions: a file's facts are kilobytes, its imports less. */
const FACTS_CACHED = 1000;
const IMPORTS_CACHED = 5000;
const HEAD_CHECK_INTERVAL = "1 minute";
const IN_CHUNK = 500;
/** Workers a question may start at once to index what its checkout changed. */
const FOREGROUND_WORKERS = Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1));

interface Version {
  readonly id: number;
  readonly path: string;
  readonly blob: string;
  readonly state: VersionState;
  readonly language: string | null;
  readonly lines: number;
}

/** The (path, blob) file versions a repository's index holds. */
class Versions {
  private readonly byKey = new Map<string, Version>();
  readonly byId = new Map<number, Version>();
  private static key = (path: string, blob: string) => `${path}\u0000${blob}`;

  get(path: string, blob: string): Version | undefined {
    return this.byKey.get(Versions.key(path, blob));
  }
  add(version: Version): void {
    this.byKey.set(Versions.key(version.path, version.blob), version);
    this.byId.set(version.id, version);
  }
  delete(id: number): void {
    const version = this.byId.get(id);
    if (version === undefined) return;
    this.byId.delete(id);
    this.byKey.delete(Versions.key(version.path, version.blob));
  }
  clear(): void {
    this.byKey.clear();
    this.byId.clear();
  }
}

interface Repo {
  readonly projectId: ProjectId;
  /** The top level of the project's own checkout. */
  readonly root: string;
  readonly commonDir: string;
  settings: CodeIndexSettings;
  status: CodeIndexStatus;
  readonly versions: Versions;
  loaded: boolean;
  /** The first build has finished: every question can be answered. */
  ready: boolean;
  /** Bumped to stop a running build: rebuilt, cleared, turned off, or removed. */
  generation: number;
  readonly listings: Map<string, Listing>;
  /** The tree of the project's checkout at the last build. */
  builtTree: string | null;
  readonly manifests: Map<string, WorkspacePackage | null>;
  readonly mergeBases: Map<string, string | null>;
  /** The objects the repository's branches, worktrees and checkpoints reached at the last look. */
  reachable: { readonly tips: ReadonlySet<string>; readonly objects: ReadonlySet<string> } | null;
  /** Each checkout's uncommitted blobs when last asked about; cleanup keeps those still there. */
  readonly uncommittedSeen: Map<string, ReadonlySet<string>>;
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  typescript: "TypeScript",
  tsx: "TypeScript",
  python: "Python",
  go: "Go",
  rust: "Rust",
};

/** Display names of a checkout's languages, the most files first. */
function languagesOf(files: ReadonlyMap<string, string>): ReadonlyArray<string> {
  const counts = new Map<string, number>();
  for (const path of files.keys()) {
    const language = languageOf(path);
    const name = language === null ? undefined : LANGUAGE_NAMES[language];
    if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].toSorted((left, right) => right[1] - left[1]).map(([name]) => name);
}

/** How many workers the Background activity profile allows; none while the policy pauses work. */
function workerCount(settings: ServerSettings): number {
  const cores = Math.max(1, navigator.hardwareConcurrency - 1);
  switch (resolveServerBackgroundActivitySettings(settings).profile) {
    case "battery-saver":
      return 1;
    case "balanced":
      return Math.min(2, cores);
    default:
      return Math.min(4, cores);
  }
}

const settingsFor = (settings: ServerSettings, projectId: ProjectId): CodeIndexSettings =>
  resolveProjectSettings(settings, projectId).settings.codeIndex ?? DEFAULT_CODE_INDEX_SETTINGS;

const failedWith = (message: string) => (cause: unknown) =>
  new CodeIndexError({ reason: "failed", message, cause });

export interface CodeIndexOptions {
  /** Null for a build with no worker: every repository reports `failed`. */
  readonly runWorker: WorkerRunner | null;
}

export const make = Effect.fn("CodeIndex.make")(function* (options: CodeIndexOptions) {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const projects = yield* ProjectService.ProjectService;
  const wikis = yield* WikiService.WikiService;
  const serverSettings = yield* ServerSettingsService.ServerSettingsService;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const eventStore = yield* OrchestrationEventStore.OrchestrationEventStore;
  const { runWorker } = options;

  const dbFile = path.join(config.stateDir, DB_FILE);
  yield* fs.makeDirectory(config.stateDir, { recursive: true }).pipe(Effect.orDie);
  // The index is a cache: one of another schema, or unreadable, is deleted and built again.
  if (yield* fs.exists(dbFile).pipe(Effect.orElseSucceed(() => false))) {
    const version = yield* Effect.try({
      try: () => schemaVersionOf(dbFile),
      catch: failedWith("Could not open the code index."),
    }).pipe(Effect.orElseSucceed(() => -1));
    if (version !== null && version !== SCHEMA_VERSION) {
      for (const suffix of ["", "-wal", "-shm"]) {
        yield* fs.remove(`${dbFile}${suffix}`, { force: true }).pipe(Effect.ignore);
      }
    }
  }
  yield* Effect.try({
    try: () => openStore(dbFile).close(),
    catch: failedWith("Could not create the code index."),
  }).pipe(Effect.orDie);
  const sqlContext = yield* Layer.build(
    NodeSqliteClient.layer({
      filename: dbFile,
      readerWorker: true,
      spanAttributes: { "db.name": DB_FILE, "service.name": "t3code-server" },
    }),
  ).pipe(Effect.orDie);
  const sql = Context.get(sqlContext, SqlClient.SqlClient);
  const read = <A, E>(effect: Effect.Effect<A, E>) =>
    NodeSqliteClient.readOnly(effect).pipe(
      Effect.mapError(failedWith("Could not read the code index.")),
    );

  const repos = new Map<ProjectId, Repo>();
  const changes = yield* PubSub.unbounded<CodeIndexStatus>();
  const storeLock = yield* Semaphore.make(STORE_PERMITS);
  const initialSettings = yield* serverSettings.getSettings.pipe(Effect.orDie);
  const workers = yield* Semaphore.make(workerCount(initialSettings));
  let paused = false;

  const setStatus = (repo: Repo, patch: Partial<CodeIndexStatus>) =>
    Effect.suspend(() => {
      const next = { ...repo.status, ...patch };
      if (Equal.equals(next, repo.status)) return Effect.void;
      repo.status = next;
      return PubSub.publish(changes, next).pipe(Effect.asVoid);
    });

  // Facts.

  const factsCache = new Map<number, FileView>();
  const importsCache = new Map<number, ReadonlyArray<StoredImport>>();
  const remember = <A>(cache: Map<number, A>, limit: number, id: number, value: A) => {
    cache.set(id, value);
    if (cache.size > limit) cache.delete(cache.keys().next().value as number);
  };
  const chunks = <A>(items: ReadonlyArray<A>, size: number) => {
    const out: Array<ReadonlyArray<A>> = [];
    for (let start = 0; start < items.length; start += size)
      out.push(items.slice(start, start + size));
    return out;
  };

  const loadVersions = Effect.fn("CodeIndex.loadVersions")(function* (repo: Repo) {
    if (repo.loaded) return;
    const rows = yield* read(
      sql<{
        readonly id: number;
        readonly path: string;
        readonly blob: string;
        readonly state: number;
        readonly language: string | null;
        readonly lines: number;
      }>`
        SELECT versions.id AS id, paths.path AS path, versions.blob AS blob,
          versions.state AS state, versions.language AS language, versions.lines AS lines
        FROM versions
        JOIN repos ON repos.id = versions.repo_id
        JOIN paths ON paths.id = versions.path_id
        WHERE repos.project_id = ${repo.projectId}
      `,
    );
    for (const row of rows) repo.versions.add({ ...row, state: row.state as VersionState });
    repo.loaded = true;
  });

  const loadFiles = Effect.fn("CodeIndex.loadFiles")(function* (versions: ReadonlyArray<Version>) {
    const out = new Map<number, FileView>();
    const missing: Array<number> = [];
    for (const version of versions) {
      const cached = factsCache.get(version.id);
      if (cached === undefined) missing.push(version.id);
      else out.set(version.id, cached);
    }
    const byId = new Map(versions.map((version) => [version.id, version]));
    for (const ids of chunks(missing, IN_CHUNK)) {
      const rows = yield* read(
        sql<{ readonly id: number; readonly facts: Uint8Array; readonly imports: Uint8Array }>`
          SELECT id, facts, imports FROM versions
          WHERE id IN ${sql.in(ids)} AND facts IS NOT NULL
        `,
      );
      for (const row of rows) {
        const version = byId.get(row.id);
        const language = version === undefined ? null : languageOf(version.path);
        if (version === undefined || language === null) continue;
        const file: FileView = {
          path: version.path,
          language,
          facts: decodeJson<StoredFacts>(row.facts),
          imports: decodeJson<ReadonlyArray<StoredImport>>(row.imports),
        };
        remember(factsCache, FACTS_CACHED, row.id, file);
        out.set(row.id, file);
      }
    }
    return out;
  });

  const loadImports = Effect.fn("CodeIndex.loadImports")(function* (ids: ReadonlyArray<number>) {
    const out = new Map<number, ReadonlyArray<StoredImport>>();
    const missing: Array<number> = [];
    for (const id of ids) {
      const cached = factsCache.get(id)?.imports ?? importsCache.get(id);
      if (cached === undefined) missing.push(id);
      else out.set(id, cached);
    }
    for (const chunk of chunks(missing, IN_CHUNK)) {
      const rows = yield* read(
        sql<{ readonly id: number; readonly imports: Uint8Array }>`
          SELECT id, imports FROM versions WHERE id IN ${sql.in(chunk)} AND imports IS NOT NULL
        `,
      );
      for (const row of rows) {
        const imports = decodeJson<ReadonlyArray<StoredImport>>(row.imports);
        remember(importsCache, IMPORTS_CACHED, row.id, imports);
        out.set(row.id, imports);
      }
    }
    return out;
  });

  // Checkouts.

  const listingOf = Effect.fn("CodeIndex.listingOf")(function* (repo: Repo, tree: string) {
    const known = repo.listings.get(tree);
    if (known !== undefined) {
      repo.listings.delete(tree);
      repo.listings.set(tree, known);
      return known;
    }
    // Diffing from a listing already held costs what changed, not the whole tree.
    const base = [...repo.listings.values()].at(-1);
    const listing =
      base === undefined
        ? parseLsTree(
            tree,
            yield* runGit(git, repo.root, "lsTree", ["ls-tree", "-r", "-z", "--full-tree", tree]),
          )
        : applyTreeDiff(
            base,
            tree,
            yield* runGit(git, repo.root, "diffTree", [
              "diff-tree",
              "-r",
              "-z",
              "--no-renames",
              "--no-commit-id",
              base.tree,
              tree,
            ]),
          );
    repo.listings.set(tree, listing);
    if (repo.listings.size > LISTINGS_KEPT) {
      repo.listings.delete(repo.listings.keys().next().value as string);
    }
    return listing;
  });

  /** A ref's commit and tree; null when it names neither. */
  const revision = (cwd: string, ref: string) =>
    // A ref is a client's text: one that reads as an option names nothing.
    (ref.startsWith("-")
      ? Effect.succeed({ exitCode: 1, stdout: "" })
      : git.execute({
          operation: "codeIndex.revParse",
          cwd,
          args: ["rev-parse", `${ref}^{commit}`, `${ref}^{tree}`],
          allowNonZeroExit: true,
        })
    ).pipe(
      Effect.mapError(gitFailed),
      Effect.map((result) => {
        const [commit, tree] = result.stdout.trim().split("\n");
        return result.exitCode === 0 && commit !== undefined && tree !== undefined
          ? { commit, tree }
          : null;
      }),
    );

  /** A checkout of the repository as it is now, uncommitted files hashed from disk. */
  const viewOfCheckout = Effect.fn("CodeIndex.viewOfCheckout")(function* (
    repo: Repo,
    root: string,
  ) {
    const head = yield* revision(root, "HEAD");
    const listing =
      head === null
        ? { tree: "", files: new Map<string, string>(), manifests: new Map<string, string>() }
        : yield* listingOf(repo, head.tree);
    const dirty = parseStatus(
      yield* runGit(git, root, "status", [
        "status",
        "--porcelain=v1",
        "-z",
        "--no-renames",
        "--untracked-files=all",
      ]),
    );
    const files = new Map(listing.files);
    const manifests = new Map(listing.manifests);
    for (const deleted of dirty.deleted) {
      files.delete(deleted);
      manifests.delete(deleted);
    }
    const wanted = dirty.present.filter((file) => isIndexable(file) || isManifest(file));
    // Hashed without filters, as the worker hashes what it reads from disk.
    const hashes =
      wanted.length === 0
        ? []
        : (yield* runGit(
            git,
            root,
            "hashObject",
            ["hash-object", "--no-filters", "--stdin-paths"],
            {
              stdin: `${wanted.join("\n")}\n`,
            },
          ))
            .trim()
            .split("\n");
    const uncommitted = new Set<string>();
    const seen = new Set<string>();
    for (const [index, file] of wanted.entries()) {
      const hash = hashes[index];
      if (hash === undefined) continue;
      (isIndexable(file) ? files : manifests).set(file, hash);
      uncommitted.add(file);
      seen.add(hash);
    }
    repo.uncommittedSeen.set(root, seen);
    const filtered = filterListing(
      { tree: listing.tree, files, manifests },
      skipMatcher(repo.settings.skippedPaths),
    );
    return {
      root,
      commit: head?.commit ?? null,
      tree: head?.tree ?? null,
      files: filtered.files,
      manifests: filtered.manifests,
      uncommitted,
    } satisfies View;
  });

  const viewOfRef = Effect.fn("CodeIndex.viewOfRef")(function* (
    repo: Repo,
    cwd: string,
    ref: string,
  ) {
    const target = yield* revision(cwd, ref);
    if (target === null) {
      return yield* new CodeIndexError({
        reason: "not-found",
        message: `${ref} is not a commit here.`,
      });
    }
    const listing = yield* listingOf(repo, target.tree);
    const filtered = filterListing(listing, skipMatcher(repo.settings.skippedPaths));
    return {
      root: null,
      commit: target.commit,
      tree: target.tree,
      files: filtered.files,
      manifests: filtered.manifests,
      uncommitted: new Set<string>(),
    } satisfies View;
  });

  // Parsing.

  const record = (repo: Repo, written: ReadonlyArray<WrittenVersion>) =>
    Effect.sync(() => {
      for (const version of written) repo.versions.add(version);
    });

  /** The view's file versions the index does not hold yet. */
  const missingOf = (repo: Repo, view: View) => {
    const missing: Array<{ path: string; blob: string; disk: string | null }> = [];
    for (const [file, blob] of view.files) {
      if (repo.versions.get(file, blob) !== undefined) continue;
      missing.push({
        path: file,
        blob,
        disk: view.root !== null && view.uncommitted.has(file) ? path.join(view.root, file) : null,
      });
    }
    return missing;
  };

  /**
   * Parse file versions in worker processes. A background build waits for the Background
   * activity policy and stops when its generation is passed; a question waits for neither.
   */
  const parse = Effect.fn("CodeIndex.parse")(function* (
    repo: Repo,
    cwd: string,
    files: ReadonlyArray<{ path: string; blob: string; disk: string | null }>,
    background: { readonly generation: number; readonly onProgress: Effect.Effect<void> } | null,
  ) {
    if (files.length === 0) return;
    if (runWorker === null) {
      return yield* new CodeIndexError({ reason: "failed", message: NO_WORKER });
    }
    const job = (chunk: ReadonlyArray<{ path: string; blob: string; disk: string | null }>) => {
      // Another question or build may have parsed some of these while this one waited.
      const todo = chunk.filter((file) => repo.versions.get(file.path, file.blob) === undefined);
      if (todo.length === 0) return Effect.void;
      return runWorker(
        {
          op: "parse",
          db: dbFile,
          projectId: repo.projectId,
          repo: cwd,
          maxBytes: MAX_FILE_BYTES,
          files: todo,
        },
        (output) =>
          "written" in output
            ? record(repo, output.written).pipe(
                Effect.andThen(background === null ? Effect.void : background.onProgress),
              )
            : Effect.void,
      ).pipe(storeLock.withPermits(1));
    };
    yield* Effect.forEach(
      chunks(files, CHUNK_FILES),
      (chunk) => {
        if (background === null) return job(chunk);
        return Effect.gen(function* () {
          if (background.generation !== repo.generation) return;
          if (paused) yield* setStatus(repo, { state: "waiting" });
          yield* workers.withPermits(1)(
            Effect.gen(function* () {
              if (background.generation !== repo.generation) return;
              yield* setStatus(repo, { state: "indexing" });
              yield* job(chunk);
            }),
          );
        });
      },
      { concurrency: background === null ? FOREGROUND_WORKERS : STORE_PERMITS, discard: true },
    );
  });

  const countsOf = (repo: Repo, view: View) => {
    let files = 0;
    for (const [file, blob] of view.files)
      if (repo.versions.get(file, blob) !== undefined) files += 1;
    return { files, totalFiles: view.files.size, languages: languagesOf(view.files) };
  };

  const deleteJob = Effect.fn("CodeIndex.deleteJob")(function* (
    job: Omit<Extract<WorkerJob, { op: "delete" }>, "op" | "db">,
  ) {
    if (runWorker === null) return 0;
    let deleted = 0;
    yield* runWorker({ op: "delete", db: dbFile, ...job }, (output) =>
      Effect.sync(() => {
        if ("deleted" in output) deleted += output.deleted;
      }),
    ).pipe(storeLock.withPermits(STORE_PERMITS));
    return deleted;
  });

  const forget = (repo: Repo) =>
    Effect.sync(() => {
      for (const id of repo.versions.byId.keys()) {
        factsCache.delete(id);
        importsCache.delete(id);
      }
      repo.versions.clear();
      repo.ready = false;
      repo.builtTree = null;
    });

  /** Bring the project's own checkout up to date: the whole repository on a first build. */
  const build = Effect.fn("CodeIndex.build")(function* (
    projectId: ProjectId,
    request: { readonly rebuild: boolean },
  ) {
    const repo = repos.get(projectId);
    if (repo === undefined || !repo.settings.enabled) return;
    const generation = repo.generation;
    const work = Effect.gen(function* () {
      if (runWorker === null) {
        return yield* setStatus(repo, { state: "failed", failure: NO_WORKER });
      }
      if (request.rebuild) {
        yield* deleteJob({ projectIds: [repo.projectId] });
        yield* forget(repo);
        repo.loaded = true;
      }
      yield* loadVersions(repo);
      const view = yield* viewOfCheckout(repo, repo.root);
      const missing = missingOf(repo, view);
      const counts = countsOf(repo, view);
      yield* setStatus(repo, {
        ...counts,
        state: paused && missing.length > 0 ? "waiting" : "indexing",
        failure: null,
      });
      let reported = counts.files;
      const onProgress = Effect.suspend(() => {
        const files = countsOf(repo, view).files;
        if (files === reported) return Effect.void;
        reported = files;
        return setStatus(repo, { files });
      });
      yield* parse(repo, repo.root, missing, { generation, onProgress });
      if (generation !== repo.generation) return;
      repo.ready = true;
      repo.builtTree = view.tree;
      yield* setStatus(repo, {
        ...countsOf(repo, view),
        state: "ready",
        updatedAt: DateTime.formatIso(yield* DateTime.now),
        failure: null,
      });
    });
    const failed = (failure: string) =>
      generation === repo.generation ? setStatus(repo, { state: "failed", failure }) : Effect.void;
    yield* work.pipe(
      Effect.catch((error: CodeIndexError) => failed(error.message)),
      Effect.catchDefect((defect) =>
        Effect.logError("code index build failed", { defect }).pipe(
          Effect.andThen(failed("The code index failed unexpectedly.")),
        ),
      ),
    );
  });

  const builds = yield* makeKeyedCoalescingWorker<
    ProjectId,
    { readonly rebuild: boolean },
    never,
    never
  >({
    merge: (current, next) => ({ rebuild: current.rebuild || next.rebuild }),
    process: build,
  });

  // Repositories.

  const offStatus = (projectId: ProjectId): CodeIndexStatus => ({
    projectId,
    state: "off",
    files: 0,
    totalFiles: 0,
    languages: [],
    updatedAt: null,
    failure: null,
  });

  /** The repository a folder is in and where in it (`apps/server`, or ""), or null outside one. */
  const locate = (cwd: string) =>
    git
      .execute({
        operation: "codeIndex.locate",
        cwd,
        args: [
          "rev-parse",
          "--path-format=absolute",
          "--show-toplevel",
          "--git-common-dir",
          "--show-prefix",
        ],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          // The prefix line is empty at the top level, so the output is not trimmed first.
          const [root, commonDir, prefix] = result.stdout.split("\n");
          return result.exitCode === 0 && root && commonDir && prefix !== undefined
            ? { root, commonDir, prefix: prefix.replace(/\/$/, "") }
            : null;
        }),
        Effect.orElseSucceed(() => null),
      );

  /** Every project but the wikis, with its index settings: what the index may hold. */
  const indexedProjects = Effect.fn("CodeIndex.indexedProjects")(function* () {
    const settings = yield* serverSettings.getSettings;
    const shells = yield* projects.listShells();
    const registered = yield* wikis.list.pipe(Effect.orElseSucceed(() => ({ wikis: [] })));
    const wikiProjects = new Set(registered.wikis.flatMap((wiki) => wiki.projectId ?? []));
    const wikiRoots = new Set(registered.wikis.map((wiki) => wiki.root));
    return shells
      .filter((shell) => !wikiProjects.has(shell.id) && !wikiRoots.has(shell.workspaceRoot))
      .map((shell) => ({ shell, wanted: settingsFor(settings, shell.id) }));
  });

  /** Match the repositories to the projects and their settings; start the builds that changed. */
  const reconcile = Effect.fn("CodeIndex.reconcile")(function* () {
    const seen = new Set<ProjectId>();
    for (const { shell, wanted } of yield* indexedProjects()) {
      let repo = repos.get(shell.id);
      if (repo === undefined) {
        const located = yield* locate(shell.workspaceRoot);
        if (located === null) continue;
        repo = {
          projectId: shell.id,
          root: located.root,
          commonDir: located.commonDir,
          settings: wanted,
          status: offStatus(shell.id),
          versions: new Versions(),
          loaded: false,
          ready: false,
          generation: 0,
          listings: new Map(),
          builtTree: null,
          manifests: new Map(),
          mergeBases: new Map(),
          reachable: null,
          uncommittedSeen: new Map(),
        };
        repos.set(shell.id, repo);
        yield* PubSub.publish(changes, repo.status);
        if (wanted.enabled) {
          yield* setStatus(repo, { state: "waiting" });
          yield* builds.enqueue(shell.id, { rebuild: false });
        }
        seen.add(shell.id);
        continue;
      }
      seen.add(shell.id);
      const changed = !Equal.equals(repo.settings, wanted);
      repo.settings = wanted;
      if (!wanted.enabled) {
        if (repo.status.state !== "off") {
          repo.generation += 1;
          repo.ready = false;
          yield* setStatus(repo, offStatus(shell.id));
        }
        continue;
      }
      if (changed || repo.status.state === "off") {
        yield* setStatus(repo, { state: "waiting" });
        yield* builds.enqueue(shell.id, { rebuild: false });
      }
    }
    for (const [projectId, repo] of repos) {
      if (seen.has(projectId)) continue;
      repo.generation += 1;
      repos.delete(projectId);
    }
  });
  const reconcileQuietly = reconcile().pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("code index could not list repositories", { cause }),
    ),
  );

  const applyPolicy = Effect.fn("CodeIndex.applyPolicy")(function* (
    settings: ServerSettings,
    run: boolean,
  ) {
    paused = !run;
    yield* Semaphore.resize(workers, run ? workerCount(settings) : 0);
  });

  /** Keep each ready repository on its checkout's HEAD. */
  const checkHeads = Effect.gen(function* () {
    if (paused) return;
    for (const repo of repos.values()) {
      if (!repo.ready || !repo.settings.enabled) continue;
      const head = yield* revision(repo.root, "HEAD").pipe(Effect.orElseSucceed(() => null));
      if (head !== null && head.tree !== repo.builtTree) {
        yield* builds.enqueue(repo.projectId, { rebuild: false });
      }
    }
  });

  yield* forkParked(
    Effect.gen(function* () {
      const policy = yield* backgroundPolicy.subscribe;
      const settingsChanges = yield* serverSettings.subscribeChanges;
      let settings = yield* serverSettings.getSettings.pipe(Effect.orDie);
      yield* applyPolicy(settings, policy.latest.shouldRunOpportunisticWork);
      yield* policy.changes.pipe(
        Stream.runForEach((snapshot) => applyPolicy(settings, snapshot.shouldRunOpportunisticWork)),
        Effect.forkScoped,
      );
      yield* settingsChanges.pipe(
        Stream.runForEach((next) =>
          Effect.gen(function* () {
            settings = next;
            yield* applyPolicy(next, !paused);
            yield* reconcileQuietly;
          }),
        ),
        Effect.forkScoped,
      );
      const after = yield* eventStore.latestApplicationSequence.pipe(Effect.orElseSucceed(() => 0));
      yield* eventStore
        .streamProjectedApplicationEvents({
          afterSequence: after,
          project: (event) => event,
          filter: (event) => "type" in event && event.type.startsWith("project."),
        })
        .pipe(
          Stream.runForEach(() => reconcileQuietly),
          Effect.catchCause((cause) =>
            Effect.logWarning("code index stopped following projects", { cause }),
          ),
          Effect.forkScoped,
        );
      yield* wikis.subscribe.pipe(
        Stream.filter((event) => event.kind === "registered" || event.kind === "removed"),
        Stream.runForEach(() => reconcileQuietly),
        Effect.forkScoped,
      );
      yield* reconcileQuietly;
      yield* checkHeads.pipe(
        Effect.repeat(Schedule.spaced(HEAD_CHECK_INTERVAL)),
        Effect.forkScoped,
      );
    }),
  );

  // Questions.

  const repoFor = (projectId: ProjectId) =>
    Effect.suspend(() => {
      const repo = repos.get(projectId);
      if (repo === undefined) {
        return Effect.fail(
          new CodeIndexError({
            reason: "unsupported",
            message: "This project is not a git repository, so it has no code index.",
          }),
        );
      }
      if (!repo.settings.enabled) {
        return Effect.fail(
          new CodeIndexError({
            reason: "off",
            message: "The code index is off for this repository.",
          }),
        );
      }
      return Effect.succeed(repo);
    });

  /** A checkout of the repository: its top level, and where the folder asking sits in it. */
  const checkoutOf = Effect.fn("CodeIndex.checkoutOf")(function* (repo: Repo, cwd: string) {
    if (cwd === repo.root) return { root: repo.root, prefix: "" };
    const located = yield* locate(cwd);
    if (located === null || located.commonDir !== repo.commonDir) {
      return yield* new CodeIndexError({
        reason: "not-found",
        message: `${cwd} is not a checkout of this repository.`,
      });
    }
    return { root: located.root, prefix: located.prefix };
  });

  /** The repository's own packages, by the manifests the checkout holds. */
  const packagesOf = Effect.fn("CodeIndex.packagesOf")(function* (repo: Repo, view: View) {
    const unread = [...view.manifests].filter(([, blob]) => !repo.manifests.has(blob));
    const fromGit: Array<[string, string]> = [];
    for (const [file, blob] of unread) {
      if (view.root === null || !view.uncommitted.has(file)) {
        fromGit.push([file, blob]);
        continue;
      }
      const text = yield* fs
        .readFileString(path.join(view.root, file))
        .pipe(Effect.orElseSucceed(() => null));
      repo.manifests.set(blob, text === null ? null : readManifest(file, text));
    }
    if (fromGit.length > 0) {
      const texts = yield* Effect.tryPromise({
        try: async () => {
          const shas = fromGit.map(([, blob]) => blob);
          const sizes = await blobSizes(repo.root, shas);
          return await readBlobs(
            repo.root,
            shas.map((sha, index) => ({ sha, size: sizes[index] ?? 0 })),
          );
        },
        catch: gitFailed,
      });
      for (const [index, [file, blob]] of fromGit.entries()) {
        const text = texts[index];
        repo.manifests.set(blob, text === undefined ? null : readManifest(file, text));
      }
    }
    const found: Array<WorkspacePackage> = [];
    for (const blob of view.manifests.values()) {
      const manifest = repo.manifests.get(blob);
      if (manifest !== null && manifest !== undefined) found.push(manifest);
    }
    return new Packages(found);
  });

  const snapshotOf = Effect.fn("CodeIndex.snapshotOf")(function* (
    repo: Repo,
    view: View,
    prefix: string,
  ) {
    const versionOf = (file: string) => {
      const blob = view.files.get(file);
      return blob === undefined ? undefined : repo.versions.get(file, blob);
    };
    const parsed = (paths: Iterable<string>) => {
      const out: Array<Version> = [];
      for (const file of paths) {
        const version = versionOf(file);
        if (version?.state === VersionState.parsed) out.push(version);
      }
      return out;
    };
    const inView = (id: number) => {
      const version = repo.versions.byId.get(id);
      return version !== undefined && view.files.get(version.path) === version.blob
        ? version
        : null;
    };
    const byName = Effect.fn("CodeIndex.byName")(function* (
      table: "defines" | "uses",
      names: ReadonlyArray<string>,
    ) {
      const out = new Map<string, Array<string>>();
      for (const chunk of chunks(names, IN_CHUNK)) {
        const rows = yield* read(
          sql<{ readonly name: string; readonly id: number }>`
            SELECT names.name AS name, ${sql(table)}.version_id AS id
            FROM ${sql(table)} JOIN names ON names.id = ${sql(table)}.name_id
            WHERE names.name IN ${sql.in(chunk)}
          `,
        );
        for (const row of rows) {
          const version = inView(row.id);
          if (version === null) continue;
          out.set(row.name, [...(out.get(row.name) ?? []), version.path]);
        }
      }
      return out;
    });
    const packages = yield* packagesOf(repo, view);
    return {
      view,
      prefix,
      modules: new CheckoutModules(view.files, packages),
      linesOf: (file) => {
        const version = versionOf(file);
        return version?.state === VersionState.parsed ? version.lines : null;
      },
      files: Effect.fn("CodeIndex.snapshotFiles")(function* (paths) {
        const versions = parsed(paths);
        const loaded = yield* loadFiles(versions);
        const out = new Map<string, FileView>();
        for (const version of versions) {
          const file = loaded.get(version.id);
          if (file !== undefined) out.set(version.path, file);
        }
        return out;
      }),
      imports: Effect.fn("CodeIndex.snapshotImports")(function* (paths) {
        const versions = parsed(paths);
        const loaded = yield* loadImports(versions.map((version) => version.id));
        const out = new Map<string, ReadonlyArray<StoredImport>>();
        for (const version of versions) {
          const imports = loaded.get(version.id);
          if (imports !== undefined) out.set(version.path, imports);
        }
        return out;
      }),
      definers: (names) => byName("defines", names),
      users: (name) => byName("uses", [name]).pipe(Effect.map((found) => found.get(name) ?? [])),
      askers: Effect.fn("CodeIndex.snapshotAskers")(function* (keys) {
        const out = new Set<string>();
        for (const chunk of chunks(keys, IN_CHUNK)) {
          const rows = yield* read(
            sql<{ readonly id: number }>`
              SELECT asks.version_id AS id FROM asks JOIN keys ON keys.id = asks.key_id
              WHERE keys.key IN ${sql.in(chunk)}
            `,
          );
          for (const row of rows) {
            const version = inView(row.id);
            if (version !== null) out.add(version.path);
          }
        }
        return [...out].toSorted();
      }),
    } satisfies Queries.Snapshot;
  });

  /** Index what a checkout holds that the repository's index does not, then read it. */
  const topUp = Effect.fn("CodeIndex.topUp")(function* (repo: Repo, view: View, cwd: string) {
    yield* parse(repo, cwd, missingOf(repo, view), null);
    if (view.root === repo.root) yield* setStatus(repo, countsOf(repo, view));
  });

  const ready = Effect.fn("CodeIndex.ready")(function* (input: CodeCheckout) {
    const repo = yield* repoFor(input.projectId);
    if (!repo.ready) {
      return yield* new CodeIndexError({
        reason: "not-indexed",
        message: "The code index is still building its first index of this repository.",
      });
    }
    return repo;
  });

  const checkoutSnapshot = Effect.fn("CodeIndex.checkoutSnapshot")(function* (
    repo: Repo,
    cwd: string,
  ) {
    const { root, prefix } = yield* checkoutOf(repo, cwd);
    const view = yield* viewOfCheckout(repo, root);
    yield* topUp(repo, view, root);
    return yield* snapshotOf(repo, view, prefix);
  });

  const refSnapshot = Effect.fn("CodeIndex.refSnapshot")(function* (
    repo: Repo,
    cwd: string,
    ref: string,
  ) {
    const { root, prefix } = yield* checkoutOf(repo, cwd);
    const view = yield* viewOfRef(repo, root, ref);
    yield* topUp(repo, view, root);
    return yield* snapshotOf(repo, view, prefix);
  });

  /** Files that differ from the default branch's merge-base, and uncommitted ones. */
  const changesOf = Effect.fn("CodeIndex.changesOf")(function* (repo: Repo, view: View) {
    if (view.commit === null || view.root === null) {
      return { branch: new Set<string>(), uncommitted: view.uncommitted };
    }
    const root = view.root;
    let base = repo.mergeBases.get(view.commit);
    if (base === undefined) {
      const remoteHead = yield* runGit(
        git,
        root,
        "defaultBranch",
        ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        { allowNonZeroExit: true },
      );
      base = null;
      for (const candidate of [remoteHead.trim(), "main", "master"]) {
        if (candidate === "") continue;
        const found = (yield* runGit(
          git,
          root,
          "mergeBase",
          ["merge-base", view.commit, candidate],
          {
            allowNonZeroExit: true,
          },
        )).trim();
        if (found !== "") {
          base = found;
          break;
        }
      }
      repo.mergeBases.set(view.commit, base);
    }
    const branch = new Set<string>();
    if (base !== null && base !== view.commit) {
      const out = yield* runGit(git, root, "branchDiff", [
        "diff-tree",
        "-r",
        "-z",
        "--name-only",
        "--no-renames",
        "--no-commit-id",
        base,
        view.commit,
      ]);
      for (const file of out.split("\0")) if (file !== "") branch.add(file);
    }
    return { branch, uncommitted: view.uncommitted };
  });

  const localGraph: CodeIndex["Service"]["localGraph"] = Effect.fn("CodeIndex.localGraph")(
    function* (input) {
      const repo = yield* repoFor(input.projectId);
      const { root, prefix } = yield* checkoutOf(repo, input.cwd);
      const view = yield* viewOfCheckout(repo, root);
      const pending = !repo.ready;
      if (pending) {
        // Before the first build, only the file itself is parsed: what it imports, not who imports it.
        const center = Queries.repositoryPath(prefix, input.path);
        yield* parse(
          repo,
          root,
          missingOf(repo, view).filter((file) => file.path === center),
          null,
        );
      } else {
        yield* topUp(repo, view, root);
      }
      const snapshot = yield* snapshotOf(repo, view, prefix);
      const fileChanges = yield* changesOf(repo, view);
      const graph = yield* Queries.localGraph(
        snapshot,
        pending ? { ...input, depth: 1 } : input,
        fileChanges,
        pending,
      );
      return { ...graph, usedByPending: pending, status: repo.status };
    },
  );

  const outline: CodeIndex["Service"]["outline"] = Effect.fn("CodeIndex.outline")(
    function* (input) {
      const repo = yield* ready(input);
      return yield* Queries.outline(yield* checkoutSnapshot(repo, input.cwd), input.path);
    },
  );

  const find: CodeIndex["Service"]["find"] = Effect.fn("CodeIndex.find")(function* (input) {
    const repo = yield* ready(input);
    return yield* Queries.find(yield* checkoutSnapshot(repo, input.cwd), input.name, input.path);
  });

  const changesBetween: CodeIndex["Service"]["changes"] = Effect.fn("CodeIndex.changes")(
    function* (input) {
      const repo = yield* ready(input);
      const before = yield* refSnapshot(repo, input.cwd, input.from);
      const after =
        input.to === undefined
          ? yield* checkoutSnapshot(repo, input.cwd)
          : yield* refSnapshot(repo, input.cwd, input.to);
      return yield* Queries.changes(before, after);
    },
  );

  const map: CodeIndex["Service"]["map"] = Effect.fn("CodeIndex.map")(function* (input) {
    const repo = yield* ready(input);
    return yield* Queries.map(yield* checkoutSnapshot(repo, input.cwd), input.paths);
  });

  // Maintenance.

  const fileBytes = Effect.gen(function* () {
    let bytes = 0;
    for (const suffix of ["", "-wal", "-shm"]) {
      const info = yield* fs.stat(`${dbFile}${suffix}`).pipe(Effect.option);
      if (info._tag === "Some") bytes += Number(info.value.size);
    }
    return bytes;
  });

  /** Every blob a branch, worktree (committed or not) or checkpoint of the repository holds. */
  const reachableBlobs = Effect.fn("CodeIndex.reachableBlobs")(function* (repo: Repo) {
    const tips = new Set(
      (yield* runGit(git, repo.root, "refs", [
        "for-each-ref",
        "--format=%(objectname)",
        "refs/heads",
        "refs/t3",
      ]))
        .split("\n")
        .filter((line) => line !== ""),
    );
    const worktrees = new Set<string>();
    for (const line of (yield* runGit(git, repo.root, "worktrees", [
      "worktree",
      "list",
      "--porcelain",
    ])).split("\n")) {
      if (line.startsWith("worktree ")) worktrees.add(line.slice("worktree ".length));
      if (line.startsWith("HEAD ")) tips.add(line.slice("HEAD ".length));
    }
    // Walking every tip's tree takes seconds in a repository with thousands of checkpoints, so
    // tips only added since the last walk are walked alone; a tip gone means walking them all.
    const cached = repo.reachable;
    const kept = cached !== null && [...cached.tips].every((tip) => tips.has(tip));
    const walk = kept ? [...tips].filter((tip) => !cached.tips.has(tip)) : [...tips];
    const objects = new Set(kept ? cached.objects : []);
    if (walk.length > 0) {
      const out = yield* runGit(
        git,
        repo.root,
        "reachable",
        ["rev-list", "--objects", "--no-walk", "--stdin"],
        { stdin: `${walk.join("\n")}\n` },
      );
      for (const line of out.split("\n")) {
        const space = line.indexOf(" ");
        const sha = space < 0 ? line : line.slice(0, space);
        if (sha !== "") objects.add(sha);
      }
    }
    repo.reachable = { tips, objects };
    const blobs = new Set(objects);
    for (const [root, seen] of repo.uncommittedSeen) {
      if (
        !worktrees.has(root) ||
        !(yield* fs.exists(root).pipe(Effect.orElseSucceed(() => false)))
      ) {
        repo.uncommittedSeen.delete(root);
        continue;
      }
      for (const blob of seen) blobs.add(blob);
    }
    return blobs;
  });

  /** What cleanup would delete: repositories gone or turned off, and unreachable versions. */
  const unused = Effect.fn("CodeIndex.unused")(function* () {
    // Decided by the projects, not by `repos`, which is empty until the repositories register.
    const kept = new Set<string>(
      (yield* indexedProjects().pipe(Effect.mapError(failedWith("Could not list the projects."))))
        .filter(({ wanted }) => wanted.enabled)
        .map(({ shell }) => shell.id),
    );
    const stored = yield* read(
      sql<{ readonly projectId: string }>`SELECT project_id AS "projectId" FROM repos`,
    );
    const dropped = stored.map((row) => row.projectId).filter((projectId) => !kept.has(projectId));
    let droppedVersions = 0;
    if (dropped.length > 0) {
      const rows = yield* read(
        sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM versions JOIN repos ON repos.id = versions.repo_id
          WHERE repos.project_id IN ${sql.in(dropped)}
        `,
      );
      droppedVersions = rows[0]?.count ?? 0;
    }
    const versionIds: Array<number> = [];
    const byRepo = new Map<Repo, Array<number>>();
    for (const repo of repos.values()) {
      if (!repo.settings.enabled || !kept.has(repo.projectId)) continue;
      yield* loadVersions(repo);
      const reachable = yield* reachableBlobs(repo);
      const ids: Array<number> = [];
      for (const version of repo.versions.byId.values()) {
        if (!reachable.has(version.blob)) ids.push(version.id);
      }
      byRepo.set(repo, ids);
      versionIds.push(...ids);
    }
    return { dropped, droppedVersions, versionIds, byRepo };
  });

  const storage: CodeIndex["Service"]["storage"] = Effect.gen(function* () {
    const counted = yield* read(
      sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM versions`,
    );
    const found = yield* unused();
    return {
      bytes: yield* fileBytes,
      fileVersions: counted[0]?.count ?? 0,
      unusedFileVersions: found.droppedVersions + found.versionIds.length,
    };
  }).pipe(Effect.withSpan("CodeIndex.storage"));

  const prune: CodeIndex["Service"]["prune"] = Effect.gen(function* () {
    const before = yield* fileBytes;
    const found = yield* unused();
    if (found.dropped.length === 0 && found.versionIds.length === 0) {
      return { bytesFreed: 0, fileVersions: 0 };
    }
    const deleted = yield* deleteJob({ projectIds: found.dropped, versionIds: found.versionIds });
    for (const [repo, ids] of found.byRepo) {
      for (const id of ids) {
        repo.versions.delete(id);
        factsCache.delete(id);
        importsCache.delete(id);
      }
    }
    for (const projectId of found.dropped) {
      const repo = repos.get(projectId as ProjectId);
      if (repo === undefined) continue;
      repo.generation += 1;
      yield* forget(repo);
      repo.loaded = false;
      // An index turned off says so already; one turned back on meanwhile builds again.
      if (repo.settings.enabled) {
        yield* setStatus(repo, { state: "waiting", files: 0 });
        yield* builds.enqueue(repo.projectId, { rebuild: false });
      }
    }
    return { bytesFreed: Math.max(0, before - (yield* fileBytes)), fileVersions: deleted };
  }).pipe(Effect.withSpan("CodeIndex.prune"));

  const clear: CodeIndex["Service"]["clear"] = Effect.gen(function* () {
    for (const repo of repos.values()) repo.generation += 1;
    yield* deleteJob({ all: true });
    factsCache.clear();
    importsCache.clear();
    for (const repo of repos.values()) {
      yield* forget(repo);
      repo.loaded = true;
      if (!repo.settings.enabled) continue;
      yield* setStatus(repo, { state: "waiting", files: 0 });
      yield* builds.enqueue(repo.projectId, { rebuild: false });
    }
  }).pipe(Effect.withSpan("CodeIndex.clear"));

  const rebuild: CodeIndex["Service"]["rebuild"] = Effect.fn("CodeIndex.rebuild")(function* ({
    projectId,
  }) {
    const repo = yield* repoFor(projectId);
    repo.generation += 1;
    yield* setStatus(repo, { state: "waiting", files: 0 });
    yield* builds.enqueue(projectId, { rebuild: true });
  });

  const status: CodeIndex["Service"]["status"] = (projectId) =>
    Effect.suspend(() => {
      const repo = repos.get(projectId);
      return repo === undefined
        ? Effect.fail(
            new CodeIndexError({
              reason: "unsupported",
              message: "This project is not a git repository, so it has no code index.",
            }),
          )
        : Effect.succeed(repo.status);
    });

  const subscribe: CodeIndex["Service"]["subscribe"] = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const current = [...repos.values()].map((repo) => repo.status);
      return Stream.concat(Stream.fromIterable(current), Stream.fromSubscription(subscription));
    }),
  );

  return CodeIndex.of({
    subscribe,
    status,
    rebuild,
    storage,
    prune,
    clear,
    localGraph,
    outline,
    find,
    changes: changesBetween,
    map,
  });
});

export const layer = Layer.effect(
  CodeIndex,
  Effect.gen(function* () {
    const command = yield* workerCommand();
    const runWorker = command === null ? null : yield* makeWorkerRunner(command);
    return yield* make({ runWorker });
  }),
);
