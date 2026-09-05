import { repositoryExitApproval } from "./MemoryRepositoryExitGate.ts";
import { makeWithLineIdentity as makeMemoryDashboard } from "./MemoryDashboard.ts";
import { memoryReviewVersion } from "./memoryReviewIdentity.ts";
import { makeMemoryGitTrees } from "./memoryGitTrees.ts";
import {
  makeMemoryLineIdentity,
  makeMemoryPosition,
  type MemoryLineContext,
} from "./MemoryPosition.ts";

import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import {
  CheckpointRef,
  MemoryNotDesignatedError,
  MemoryReadUnavailableError,
  type MemoryReadingPosition,
  type MemoryPosition as MemoryPositionValue,
  type MemoryMergeReview,
  MemoryReviewBlockedError,
  MergeMemoryHomeBlockedError,
  type MemoryMapPlacement,
  type MemoryLineRef,
  type MemoryIndex as MemoryIndexValue,
  type MemoryNote,
  type MercurianLineMemoryChanges,
  type MercurianMergeMemoryHomeResult,
  MercurianMemoryError,
  type MercurianProjectId,
  type PlanTurnId,
  type ThreadId,
  ProductMapAlreadyExistsError,
  ProductMapCycleError,
  isProductMapCycleError,
} from "@t3tools/contracts";

import * as ProcessRunner from "../../processRunner.ts";
import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { lineRootCommitIdFor } from "../commitTree/LineBranchReactor.ts";
import { resolveRepositoryDefault } from "../commitTree/repositoryDefault.ts";
import { LegacySessionStore } from "../lineRuntimes/LegacySessionStore.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { PlanningStore } from "../planning/PlanningStore.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { SlotRegistry } from "../worktreeSlots/SlotRegistry.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import { SnapshotChain } from "../worktreeSlots/SnapshotChain.ts";
import { slotMemberWorktreePath } from "../worktreeSlots/SlotService.ts";
import * as MemorySourceStore from "./MemorySourceStore.ts";
import { MemoryReviewStore } from "./MemoryReviewStore.ts";
import {
  buildMemoryGraph,
  compileProductMap,
  fingerprintMemoryFiles,
  insertMapPlacement,
  isValidMemoryNoteName,
  legacyMemoryMapRefusal,
  parseSkillMap,
  serializeSkillMap,
  type MemoryGraph,
} from "./memoryModel.ts";
import type { MemoryTreeSource, ResolvedMemorySource } from "./schema.ts";

export type MemoryIndexError =
  | MemorySourceStore.MemorySourceStoreError
  | PlatformError.PlatformError
  | ProcessRunner.ProcessRunError
  | MemoryNotDesignatedError
  | MemoryReadUnavailableError
  | ProductMapAlreadyExistsError
  | ProductMapCycleError
  | MercurianMemoryError;

export class MemoryAmendmentValidationError extends Schema.TaggedErrorClass<MemoryAmendmentValidationError>()(
  "MemoryAmendmentValidationError",
  { reason: Schema.String },
) {}

export interface PendingMemoryAmendment {
  readonly title: string;
  readonly notes: ReadonlyArray<{ readonly name: string; readonly markdown: string }>;
  readonly placements: ReadonlyArray<MemoryMapPlacement>;
}

interface CachedRoot {
  readonly fingerprint: string;
  readonly graph: MemoryGraph;
  readonly maps: MemoryIndexValue["maps"];
  readonly index: MemoryIndexValue;
}

export interface PreparedMemoryAmendment {
  readonly turnId: PlanTurnId;
  readonly title: string;
  readonly changes: ReadonlyArray<{
    readonly path: string;
    readonly before: string | null;
    readonly after: string;
  }>;
  readonly patch: string;
  readonly placements: ReadonlyArray<MemoryMapPlacement>;
}

export class MemoryIndex extends Context.Service<
  MemoryIndex,
  {
    readonly getLineContext: (input: {
      readonly projectId: MercurianProjectId;
      readonly line: MemoryLineRef;
    }) => Effect.Effect<MemoryLineContext, MercurianMemoryError>;
    readonly readIndex: (
      projectId: MercurianProjectId,
      line?: MemoryLineRef,
      position?: MemoryReadingPosition,
    ) => Effect.Effect<MemoryIndexValue, MemoryIndexError>;
    readonly readNote: (
      projectId: MercurianProjectId,
      name: string,
      line?: MemoryLineRef,
      position?: MemoryReadingPosition,
    ) => Effect.Effect<MemoryNote, MemoryIndexError>;
    readonly generateProductMap: (
      projectId: MercurianProjectId,
    ) => Effect.Effect<void, MemoryIndexError>;
    readonly prepareAmendment: (input: {
      readonly projectId: MercurianProjectId;
      readonly turnId: PlanTurnId;
      readonly amendment: PendingMemoryAmendment;
    }) => Effect.Effect<PreparedMemoryAmendment, MemoryIndexError | MemoryAmendmentValidationError>;
    readonly resolveLineSource: (input: {
      readonly projectId: MercurianProjectId;
      readonly line: MemoryLineRef;
      readonly position?: MemoryReadingPosition;
    }) => Effect.Effect<MemoryTreeSource, MemoryIndexError>;
    readonly landAmendment: (input: {
      readonly projectId: MercurianProjectId;
      readonly threadId: ThreadId;
      readonly turnId: PlanTurnId;
      readonly amendment: PendingMemoryAmendment;
    }) => Effect.Effect<
      { readonly memoryCommitSha: string; readonly branch: string },
      MemoryIndexError | MemoryAmendmentValidationError
    >;
    readonly readLineChanges: (input: {
      readonly projectId: MercurianProjectId;
      readonly line: MemoryLineRef;
      readonly position?: MemoryReadingPosition;
    }) => Effect.Effect<MercurianLineMemoryChanges, MemoryIndexError>;
    readonly markChangeReviewed: (input: {
      readonly projectId: MercurianProjectId;
      readonly line: MemoryLineRef;
      readonly commitOid: string;
      readonly position?: MemoryReadingPosition;
    }) => Effect.Effect<void, MemoryIndexError | MemoryReviewBlockedError>;
    readonly revertChange: (input: {
      readonly position?: MemoryReadingPosition;
      readonly expectedVersion?: string;
      readonly projectId: MercurianProjectId;
      readonly line: MemoryLineRef;
      readonly target:
        | { readonly kind: "commit"; readonly commitOid: string }
        | { readonly kind: "unmarked" };
    }) => Effect.Effect<void, MemoryIndexError | MemoryReviewBlockedError>;
    readonly mergeHome: (input: {
      readonly reviewedUnmarkedId?: string | null;
      readonly position?: MemoryReadingPosition;
      readonly expectedVersion?: string;
      readonly projectId: MercurianProjectId;
      readonly line: MemoryLineRef;
    }) => Effect.Effect<
      MercurianMergeMemoryHomeResult,
      MemoryIndexError | MemoryReviewBlockedError | MergeMemoryHomeBlockedError
    >;
  }
>()("t3/mercurian/memory/MemoryIndex") {}

const posix = (value: string) => value.replaceAll("\\", "/");

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const sourceStore = yield* MemorySourceStore.MemorySourceStore;
  const git = yield* GitVcsDriver;
  const positions = yield* makeMemoryPosition;
  const lineRuntimes = yield* LineRuntimeStore;
  const legacySessions = yield* LegacySessionStore;
  const planning = yield* PlanningStore;
  const repositories = yield* RepositoryStore;
  const settings = yield* ServerSettingsService;
  const planTurns = yield* PlanTurnRegistry;
  const slots = yield* SlotStore;
  const slotRegistry = yield* SlotRegistry;
  const checkpoints = yield* CheckpointStore;
  const reviews = yield* MemoryReviewStore;
  const snapshots = yield* SnapshotChain;
  const trees = yield* makeMemoryGitTrees;
  const normalizeReadError =
    (operation: "readMemoryIndex" | "readMemoryNote" | "readLineMemoryChanges") =>
    (cause: unknown) => {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "_tag" in cause &&
        (cause._tag === "MemoryNotDesignatedError" ||
          cause._tag === "MemorySourceInvalidError" ||
          cause._tag === "MemoryReadUnavailableError")
      ) {
        return cause as
          | MemoryNotDesignatedError
          | MemoryReadUnavailableError
          | MemorySourceStore.MemorySourceStoreError;
      }
      return new MercurianMemoryError({ operation, cause });
    };
  const normalizeLandError = (cause: unknown) => {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "_tag" in cause &&
      cause._tag === "MemoryAmendmentValidationError"
    ) {
      return cause as MemoryAmendmentValidationError;
    }
    return new MercurianMemoryError({ operation: "landMemoryAmendment", cause });
  };
  const normalizeReviewError = (cause: unknown) =>
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "MemoryReviewBlockedError"
      ? (cause as MemoryReviewBlockedError)
      : new MercurianMemoryError({ operation: "revertMemoryChange", cause });
  const normalizeMergeHomeError = (cause: unknown) =>
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    (cause._tag === "MemoryReviewBlockedError" ||
      cause._tag === "MergeMemoryHomeBlockedError" ||
      cause._tag === "MemoryNotDesignatedError" ||
      cause._tag === "MemorySourceInvalidError")
      ? (cause as
          | MemoryReviewBlockedError
          | MergeMemoryHomeBlockedError
          | MemoryNotDesignatedError
          | MemorySourceStore.MemorySourceStoreError)
      : new MercurianMemoryError({ operation: "mergeMemoryHome", cause });
  const cache = new Map<string, CachedRoot>();

  const runGit = (cwd: string, args: ReadonlyArray<string>) =>
    processRunner.run({ command: "git", args: ["-C", cwd, ...args] });

  const gitRoot = Effect.fn("MemoryIndex.gitRoot")(function* (rootPath: string) {
    const result = yield* runGit(rootPath, ["rev-parse", "--show-toplevel"]).pipe(Effect.option);
    return Option.isSome(result) && result.value.code === 0 && result.value.stdout.trim()
      ? result.value.stdout.trim()
      : null;
  });

  const readIfExists = Effect.fn("MemoryIndex.readIfExists")(function* (file: string) {
    return (yield* fs.exists(file)) ? yield* fs.readFileString(file) : null;
  });

  const commitPaths = Effect.fn("MemoryIndex.commitPaths")(function* (input: {
    readonly rootPath: string;
    readonly absolutePaths: ReadonlyArray<string>;
    readonly message: string;
    readonly operation: "generateProductMap" | "applyMemoryAmendment";
    readonly trailers?: ReadonlyArray<string>;
  }) {
    const discoveredRoot = yield* gitRoot(input.rootPath);
    if (discoveredRoot === null) return null;
    const repositoryRoot = yield* fs.realPath(discoveredRoot);
    const canonicalPaths = yield* Effect.forEach(input.absolutePaths, (file) => fs.realPath(file));
    const relativePaths = canonicalPaths.map((file) => path.relative(repositoryRoot, file));
    const add = yield* runGit(repositoryRoot, ["add", "--", ...relativePaths]);
    const commit =
      add.code === 0
        ? yield* runGit(repositoryRoot, [
            "commit",
            "--only",
            "-m",
            `${input.message}${
              input.trailers === undefined || input.trailers.length === 0
                ? ""
                : `\n\n${input.trailers.join("\n")}`
            }`,
            "--",
            ...relativePaths,
          ])
        : add;
    if (commit.code !== 0) {
      return yield* new MercurianMemoryError({
        operation: input.operation,
        cause: new Error(commit.stderr || "git commit failed"),
      });
    }
    const revision = yield* runGit(repositoryRoot, ["rev-parse", "HEAD"]);
    if (revision.code !== 0 || revision.stdout.trim().length === 0) {
      return yield* new MercurianMemoryError({
        operation: input.operation,
        cause: new Error(revision.stderr || "git rev-parse failed"),
      });
    }
    return revision.stdout.trim();
  });

  const walkFiles = Effect.fn("MemoryIndex.walkFiles")(function* (rootPath: string) {
    const files: Array<string> = [];
    const walk = (directory: string): Effect.Effect<void, PlatformError.PlatformError> =>
      Effect.gen(function* () {
        const names = yield* fs.readDirectory(directory);
        for (const name of names.sort((a, b) => a.localeCompare(b))) {
          if (name.startsWith(".")) continue;
          const absolute = path.join(directory, name);
          const info = yield* fs.stat(absolute);
          if (info.type === "Directory") yield* walk(absolute);
          else if (info.type === "File") files.push(absolute);
        }
      });
    yield* walk(rootPath);
    return files;
  });

  const listFiles = Effect.fn("MemoryIndex.listFiles")(function* (rootPath: string) {
    const repositoryRoot = yield* gitRoot(rootPath);
    if (repositoryRoot === null) return { files: yield* walkFiles(rootPath), gitRoot: null };
    const scope = path.relative(repositoryRoot, rootPath) || ".";
    const result = yield* runGit(repositoryRoot, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      scope,
    ]).pipe(Effect.option);
    if (Option.isNone(result) || result.value.code !== 0) {
      return { files: yield* walkFiles(rootPath), gitRoot: null };
    }
    return {
      files: result.value.stdout
        .split("\0")
        .filter(Boolean)
        .map((file) => path.resolve(repositoryRoot, file)),
      gitRoot: repositoryRoot,
    };
  });

  const classifyFiles = (rootPath: string, files: ReadonlyArray<string>) => {
    const notes: Array<string> = [];
    const maps: Array<string> = [];
    for (const absolute of files) {
      const relative = posix(path.relative(rootPath, absolute));
      if (!relative || relative === ".." || relative.startsWith("../")) continue;
      const segments = relative.split("/");
      if (segments.some((segment) => segment.startsWith("."))) continue;
      if (relative.endsWith(".skillmap.md")) {
        maps.push(absolute);
        continue;
      }
      if (segments[0] === "maps") {
        if (segments.length === 2 && relative.endsWith(".yaml")) maps.push(absolute);
        continue;
      }
      if (relative.endsWith(".md")) notes.push(absolute);
    }
    return {
      notes: notes.sort((a, b) => a.localeCompare(b)),
      maps: maps.sort((a, b) => a.localeCompare(b)),
    };
  };

  const requireSource = Effect.fn("MemoryIndex.requireSource")(function* (
    projectId: MercurianProjectId,
  ) {
    const source = yield* sourceStore.getResolvedSource(projectId);
    if (Option.isNone(source)) return yield* new MemoryNotDesignatedError({ projectId });
    return source.value;
  });

  const loadRoot = Effect.fn("MemoryIndex.loadRoot")(function* (source: ResolvedMemorySource) {
    const listed = yield* listFiles(source.rootPath);
    const classified = classifyFiles(source.rootPath, listed.files);
    const productPath = path.join(source.rootPath, "Product.skillmap.md");
    const productExists = yield* fs.exists(productPath);
    const fingerprintPaths = [
      ...classified.notes,
      ...classified.maps,
      ...(productExists && !classified.maps.includes(productPath) ? [productPath] : []),
    ];
    const fingerprintEntries = yield* Effect.forEach(fingerprintPaths, (file) =>
      fs.stat(file).pipe(
        Effect.map((info) => ({
          path: file,
          mtimeMs: Option.match(info.mtime, {
            onNone: () => 0,
            onSome: (date) => date.getTime(),
          }),
          size: Number(info.size),
        })),
      ),
    );
    const fingerprint = fingerprintMemoryFiles(fingerprintEntries);
    const previous = cache.get(source.rootPath);
    if (previous?.fingerprint === fingerprint) return previous;

    const noteFiles = yield* Effect.forEach(classified.notes, (file) =>
      fs.readFileString(file).pipe(
        Effect.map((markdown) => ({
          name: path.basename(file, path.extname(file)),
          path: file,
          markdown,
        })),
      ),
    );
    const graph = buildMemoryGraph(noteFiles);
    const maps = yield* Effect.forEach(classified.maps, (file) =>
      fs.readFileString(file).pipe(
        Effect.map((contents) => {
          const relative = posix(path.relative(source.rootPath, file));
          return relative.endsWith(".skillmap.md")
            ? parseSkillMap(relative, contents, graph)
            : legacyMemoryMapRefusal(relative);
        }),
      ),
    );
    const index: MemoryIndexValue = {
      notes: graph.notes.map(({ name, path: notePath }) => ({ name, path: notePath })),
      maps,
      unresolved: graph.unresolved,
      problems: graph.problems,
      productMapOffer:
        graph.declarations.length > 0 && !productExists
          ? { declarationCount: graph.declarations.length }
          : null,
    };
    const next = { fingerprint, graph, maps, index } satisfies CachedRoot;
    cache.set(source.rootPath, next);
    return next;
  });

  const refPath = (source: Extract<MemoryTreeSource, { readonly kind: "ref" }>, relative: string) =>
    posix([source.subpath, relative].filter(Boolean).join("/"));

  const loadRef = Effect.fn("MemoryIndex.loadRef")(function* (
    source: Extract<MemoryTreeSource, { readonly kind: "ref" }>,
  ) {
    const oid =
      source.treeOid ??
      (yield* git.execute({
        operation: "MemoryIndex.resolveRef",
        cwd: source.repositoryPath,
        args: ["rev-parse", "--verify", `${source.ref}^{tree}`],
      })).stdout.trim();
    const cacheKey = `ref:${source.repositoryPath}\0${oid}\0${source.subpath}`;
    const previous = cache.get(cacheKey);
    if (previous !== undefined) return previous;
    const listed = yield* git.execute({
      operation: "MemoryIndex.listRef",
      cwd: source.repositoryPath,
      args: ["ls-tree", "-r", "--name-only", "-z", oid, "--", source.subpath || "."],
    });
    const prefix =
      source.subpath.length === 0 ? "" : `${posix(source.subpath).replace(/\/$/u, "")}/`;
    const relativeFiles = listed.stdout
      .split("\0")
      .filter(Boolean)
      .map((file) => posix(file))
      .flatMap((file) =>
        prefix.length === 0 ? [file] : file.startsWith(prefix) ? [file.slice(prefix.length)] : [],
      );
    const rootPath = path.join(source.repositoryPath, source.subpath);
    const classified = classifyFiles(
      rootPath,
      relativeFiles.map((file) => path.join(rootPath, file)),
    );
    const readRefFile = (absolute: string) => {
      const relative = posix(path.relative(rootPath, absolute));
      return git
        .execute({
          operation: "MemoryIndex.readRef",
          cwd: source.repositoryPath,
          args: ["show", `${oid}:${refPath(source, relative)}`],
        })
        .pipe(Effect.map((result) => result.stdout));
    };
    const noteFiles = yield* Effect.forEach(classified.notes, (file) =>
      readRefFile(file).pipe(
        Effect.map((markdown) => ({
          name: path.basename(file, path.extname(file)),
          path: file,
          markdown,
        })),
      ),
    );
    const graph = buildMemoryGraph(noteFiles);
    const maps = yield* Effect.forEach(classified.maps, (file) =>
      readRefFile(file).pipe(
        Effect.map((contents) => {
          const relative = posix(path.relative(rootPath, file));
          return relative.endsWith(".skillmap.md")
            ? parseSkillMap(relative, contents, graph)
            : legacyMemoryMapRefusal(relative);
        }),
      ),
    );
    const productExists = relativeFiles.includes("Product.skillmap.md");
    const index: MemoryIndexValue = {
      notes: graph.notes.map(({ name, path: notePath }) => ({ name, path: notePath })),
      maps,
      unresolved: graph.unresolved,
      problems: graph.problems,
      productMapOffer:
        graph.declarations.length > 0 && !productExists
          ? { declarationCount: graph.declarations.length }
          : null,
    };
    const next = { fingerprint: oid, graph, maps, index } satisfies CachedRoot;
    cache.set(cacheKey, next);
    return next;
  });

  const lineIdentity = yield* makeMemoryLineIdentity;
  const dashboard = yield* makeMemoryDashboard((input) =>
    lineIdentity(input).pipe(
      Effect.mapError(
        (cause) => new MercurianMemoryError({ operation: "readMemoryDashboard", cause }),
      ),
    ),
  );

  const lineContext = Effect.fn("MemoryIndex.lineContext")(function* (input: {
    readonly projectId: MercurianProjectId;
    readonly line: MemoryLineRef;
  }) {
    const context = yield* lineIdentity(input);
    if (context.branch === null) {
      return yield* new MercurianMemoryError({
        operation: "readLineMemoryChanges",
        cause: new Error("The memory line branch is missing"),
      });
    }
    return { ...context, branch: context.branch };
  });

  const resolveLineSource: MemoryIndex["Service"]["resolveLineSource"] = (input) =>
    Effect.gen(function* () {
      const context = yield* lineIdentity(input);
      const position = yield* positions
        .read(context, input.position ?? { kind: "latest" })
        .pipe(Effect.scoped);
      if ("kind" in position)
        return yield* new MemoryReadUnavailableError({ reason: position.reason });
      return {
        kind: "ref",
        repositoryPath: context.source.repositoryPath,
        ref: position.treeOid,
        treeOid: position.treeOid,
        subpath: position.memoryRoot,
      } satisfies MemoryTreeSource;
    }).pipe(Effect.mapError(normalizeReadError("readMemoryIndex")));

  const loadSource = (source: MemoryTreeSource | ResolvedMemorySource) =>
    "kind" in source && source.kind === "ref"
      ? loadRef(source)
      : loadRoot(source as ResolvedMemorySource);

  const readIndex: MemoryIndex["Service"]["readIndex"] = (projectId, line, position) =>
    Effect.gen(function* () {
      if (line === undefined && position !== undefined && position.kind !== "latest")
        return yield* new MemoryReadUnavailableError({ reason: "line-missing" });
      const treeSource =
        line === undefined
          ? yield* requireSource(projectId)
          : yield* resolveLineSource({
              projectId,
              line,
              ...(position === undefined ? {} : { position }),
            });
      return (yield* loadSource(treeSource)).index;
    }).pipe(Effect.mapError(normalizeReadError("readMemoryIndex")));

  const readNote: MemoryIndex["Service"]["readNote"] = (projectId, name, line, position) =>
    Effect.gen(function* () {
      if (line === undefined && position !== undefined && position.kind !== "latest")
        return yield* new MemoryReadUnavailableError({ reason: "line-missing" });
      const treeSource =
        line === undefined
          ? yield* requireSource(projectId)
          : yield* resolveLineSource({
              projectId,
              line,
              ...(position === undefined ? {} : { position }),
            });
      const { graph } = yield* loadSource(treeSource);
      const selected = graph.noteByName.get(name);
      if (selected === undefined) {
        return {
          name,
          exists: false,
          links: [],
          backlinks: graph.backlinks.get(name) ?? [],
        } satisfies MemoryNote;
      }
      return {
        name,
        exists: true,
        path: selected.path,
        markdown: selected.markdown,
        links: (graph.outgoing.get(name) ?? []).map((link) => ({
          name: link,
          exists: graph.noteByName.has(link),
        })),
        backlinks: graph.backlinks.get(name) ?? [],
      } satisfies MemoryNote;
    }).pipe(Effect.mapError(normalizeReadError("readMemoryNote")));

  const generateProductMap: MemoryIndex["Service"]["generateProductMap"] = (projectId) =>
    Effect.gen(function* () {
      const source = yield* requireSource(projectId);
      const productPath = path.join(source.rootPath, "Product.skillmap.md");
      if (yield* fs.exists(productPath)) {
        return yield* new ProductMapAlreadyExistsError({ projectId });
      }
      const { graph } = yield* loadRoot(source);
      const compiled = compileProductMap(graph.declarations);
      if (isProductMapCycleError(compiled)) return yield* compiled;
      yield* fs.writeFileString(productPath, serializeSkillMap(compiled));
      cache.delete(source.rootPath);

      yield* commitPaths({
        rootPath: source.rootPath,
        absolutePaths: [productPath],
        message: "Generate product map from containment declarations",
        operation: "generateProductMap",
      });
    });

  const makePatch = Effect.fn("MemoryIndex.makePatch")(function* (
    changes: PreparedMemoryAmendment["changes"],
  ) {
    const temporary = yield* fs.makeTempDirectory({ prefix: "t3-memory-amendment-" });
    return yield* Effect.gen(function* () {
      const patches: Array<string> = [];
      for (const change of changes) {
        const beforePath = path.join(temporary, "before", change.path);
        const afterPath = path.join(temporary, "after", change.path);
        yield* fs.makeDirectory(path.dirname(afterPath), { recursive: true });
        if (change.before !== null) {
          yield* fs.makeDirectory(path.dirname(beforePath), { recursive: true });
          yield* fs.writeFileString(beforePath, change.before);
        }
        yield* fs.writeFileString(afterPath, change.after);
        const result = yield* runGit(temporary, [
          "diff",
          "--no-index",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          "--",
          change.before === null ? "/dev/null" : path.join("before", change.path),
          path.join("after", change.path),
        ]);
        if (result.code !== 0 && result.code !== 1) {
          return yield* new MercurianMemoryError({
            operation: "prepareMemoryAmendment",
            cause: new Error(result.stderr || "git diff failed"),
          });
        }
        patches.push(
          result.stdout
            .replaceAll(`a/before/${change.path}`, `a/${change.path}`)
            .replaceAll(`a/after/${change.path}`, `a/${change.path}`)
            .replaceAll(`b/before/${change.path}`, `b/${change.path}`)
            .replaceAll(`b/after/${change.path}`, `b/${change.path}`),
        );
      }
      return patches.filter(Boolean).join("\n");
    }).pipe(
      Effect.ensuring(
        fs.remove(temporary, { recursive: true }).pipe(Effect.catch(() => Effect.void)),
      ),
    );
  });

  const prepareAtSource = Effect.fn("MemoryIndex.prepareAtSource")(function* (
    input: {
      readonly projectId: MercurianProjectId;
      readonly turnId: PlanTurnId;
      readonly amendment: PendingMemoryAmendment;
    },
    source: ResolvedMemorySource,
  ) {
    const title = input.amendment.title.trim();
    if (title.length === 0 || /[\r\n]/u.test(title)) {
      return yield* new MemoryAmendmentValidationError({
        reason: "Give the amendment a one-line title.",
      });
    }
    const names = input.amendment.notes.map(({ name }) => name);
    if (names.some((name) => !isValidMemoryNoteName(name))) {
      return yield* new MemoryAmendmentValidationError({
        reason: "Every amended note needs a valid note name.",
      });
    }
    if (new Set(names).size !== names.length) {
      return yield* new MemoryAmendmentValidationError({
        reason: "An amendment can change each note only once.",
      });
    }
    const loaded = yield* loadRoot(source);
    const nextFiles = new Map(loaded.graph.notes.map((note) => [note.name, note]));
    const noteChanges: Array<PreparedMemoryAmendment["changes"][number]> = [];
    for (const note of input.amendment.notes) {
      const previous = loaded.graph.noteByName.get(note.name);
      const relative =
        previous === undefined
          ? `${note.name}.md`
          : posix(path.relative(source.rootPath, previous.path));
      const before = previous?.markdown ?? null;
      nextFiles.set(note.name, {
        name: note.name,
        path: path.join(source.rootPath, relative),
        markdown: note.markdown,
      });
      if (before !== note.markdown)
        noteChanges.push({ path: relative, before, after: note.markdown });
    }
    const nextGraph = buildMemoryGraph([...nextFiles.values()]);
    const mapsByName = new Map(
      loaded.maps.flatMap((map) => ("refusal" in map ? [] : [[map.name, map] as const])),
    );
    const mapSources = new Map<string, string>();
    const changedMaps = new Map<string, { before: string; after: string }>();
    for (const placement of input.amendment.placements) {
      const current = mapsByName.get(placement.map);
      if (current === undefined) {
        return yield* new MemoryAmendmentValidationError({
          reason: `The ${placement.map} map is not available for placement.`,
        });
      }
      const before =
        mapSources.get(current.file) ??
        (yield* fs.readFileString(path.join(source.rootPath, current.file)));
      const placed = insertMapPlacement(
        current,
        placement.parent,
        placement.note,
        nextGraph,
        placement.type,
      );
      if ("refusal" in placed) {
        return yield* new MemoryAmendmentValidationError({ reason: placed.refusal });
      }
      const after = serializeSkillMap(placed);
      mapsByName.set(placed.name, placed);
      mapSources.set(current.file, after);
      changedMaps.set(current.file, {
        before: changedMaps.get(current.file)?.before ?? before,
        after,
      });
    }
    const changes = [
      ...noteChanges,
      ...[...changedMaps.entries()].map(([relative, change]) => ({ path: relative, ...change })),
    ];
    if (changes.length === 0) {
      return yield* new MemoryAmendmentValidationError({
        reason: "This amendment does not change project memory.",
      });
    }
    return {
      turnId: input.turnId,
      title,
      changes,
      patch: yield* makePatch(changes),
      placements: [...input.amendment.placements],
    } satisfies PreparedMemoryAmendment;
  });

  const prepareAmendment: MemoryIndex["Service"]["prepareAmendment"] = (input) =>
    requireSource(input.projectId).pipe(Effect.flatMap((source) => prepareAtSource(input, source)));

  const landAmendment: MemoryIndex["Service"]["landAmendment"] = (input) =>
    Effect.gen(function* () {
      const claimedTurn = yield* planTurns.getByThread(input.threadId);
      if (Option.isNone(claimedTurn) || claimedTurn.value.turnId !== input.turnId) {
        return yield* new MemoryAmendmentValidationError({
          reason: "The planning turn no longer holds this memory line.",
        });
      }
      const context = yield* lineContext({
        projectId: input.projectId,
        line: { threadId: input.threadId },
      });
      const holder = { kind: "turn" as const, threadId: input.threadId };
      const projectSlots = yield* slots.list(input.projectId);
      let heldSlot = undefined as (typeof projectSlots)[number] | undefined;
      for (const candidate of projectSlots) {
        const lease = yield* slotRegistry.lease(candidate.slotId);
        if (
          Option.isSome(lease) &&
          lease.value.holders.some(
            (candidateHolder) =>
              candidateHolder.kind === holder.kind && candidateHolder.threadId === holder.threadId,
          )
        ) {
          heldSlot = candidate;
          break;
        }
      }
      if (heldSlot === undefined) {
        return yield* new MemoryAmendmentValidationError({
          reason: "The planning turn no longer holds a worktree slot.",
        });
      }
      const memberRoot = slotMemberWorktreePath(path, heldSlot, context.source.repositoryId);
      if (memberRoot === null) {
        return yield* new MemoryAmendmentValidationError({
          reason: "The worktree slot has no memory member.",
        });
      }
      const rootPath = path.join(memberRoot, context.source.subpath ?? "");
      const memberSource: ResolvedMemorySource = { ...context.source, rootPath };
      const prepared = yield* prepareAtSource(input, memberSource);
      for (const change of prepared.changes) {
        const current = yield* readIfExists(path.join(rootPath, change.path));
        if (current !== change.before) {
          return yield* new MemoryAmendmentValidationError({ reason: "memory-changed" });
        }
      }
      const absolutePaths: Array<string> = [];
      for (const change of prepared.changes) {
        const absolute = path.join(rootPath, change.path);
        yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
        yield* fs.writeFileString(absolute, change.after);
        absolutePaths.push(absolute);
      }
      cache.delete(rootPath);
      const memoryCommitSha = yield* commitPaths({
        rootPath,
        absolutePaths,
        message: prepared.title,
        trailers: [
          `Astrolabe-Amendment: ${input.turnId}`,
          `Amended-from-plan: ${context.detail.plan.title} (${context.planId})`,
        ],
        operation: "applyMemoryAmendment",
      });
      if (memoryCommitSha === null) {
        return yield* new MercurianMemoryError({
          operation: "landMemoryAmendment",
          cause: new Error("The memory slot member is not a Git repository"),
        });
      }
      const createdAt = yield* DateTime.now;
      const message = yield* planning.appendMemoryAmendment({
        planId: context.planId,
        parentCommitId: claimedTurn.value.tipCommitId,
        title: prepared.title,
        memoryCommitSha,
        branch: context.branch.branch,
        notes: prepared.changes
          .filter((change) => change.path.endsWith(".md") && !change.path.endsWith(".skillmap.md"))
          .map((change) => path.basename(change.path, ".md")),
        createdAt,
      });
      yield* planTurns.advanceTip(context.planId, input.turnId, message.commitId);
      return { memoryCommitSha, branch: context.branch.branch };
    }).pipe(Effect.mapError(normalizeLandError));

  const readLineChanges: MemoryIndex["Service"]["readLineChanges"] = (input) =>
    Effect.gen(function* () {
      const context = yield* lineIdentity(input);
      const current = yield* dashboard.readDashboard({
        ...input,
        position: input.position ?? { kind: "latest" },
      });
      if (current.kind !== "available")
        return yield* new MemoryReadUnavailableError({ reason: current.reason });
      const position = current.position;
      const scope = position.memoryRoot || ".";
      const log = yield* git.execute({
        operation: "MemoryIndex.readLineChanges.log",
        cwd: context.source.repositoryPath,
        args: [
          "log",
          "--first-parent",
          "--format=%H%x00%s%x00%(trailers:only,unfold)%x00%aI%x00%x1e",
          `${position.baseCommitOid}..${position.headOid}`,
          "--",
          scope,
        ],
      });
      const visibleAmendments = new Map(
        current.amendments.map((amendment) => [amendment.id, amendment]),
      );
      const entries = log.stdout
        .split("\x1e")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [oid = "", title = "", trailers = "", authoredAt = ""] = entry.split("\0");
          const match = /^Astrolabe-Amendment:\s*(.+)$/imu.exec(trailers);
          return { oid, title, turnId: match?.[1]?.trim() ?? null, authoredAt };
        })
        .filter((entry) => visibleAmendments.has(entry.oid));
      const withDiff = yield* Effect.forEach(entries, (entry) =>
        git
          .execute({
            operation: "MemoryIndex.readLineChanges.diff",
            cwd: context.source.repositoryPath,
            args: [
              "--literal-pathspecs",
              "show",
              "--format=",
              "--patch",
              entry.oid,
              "--",
              ...visibleAmendments.get(entry.oid)!.comparison.paths,
            ],
          })
          .pipe(Effect.map((result) => ({ ...entry, diff: result.stdout }))),
      );
      const reviewed = new Set(
        (yield* reviews.listReviewed({
          lineRootCommitId: context.lineRootCommitId,
          repositoryId: context.source.repositoryId,
        })).map(({ commitOid }) => commitOid),
      );
      const amendment = current.amendments.find((a) => a.kind === "unmarked");
      const unmarked = amendment
        ? {
            id: amendment.id,
            diff: yield* checkpoints.diffCheckpoints({
              cwd: context.source.repositoryPath,
              fromCheckpointRef: CheckpointRef.make(position.recordedHeadOid),
              toCheckpointRef: CheckpointRef.make(position.snapshotOid!),
              ignoreWhitespace: false,
              paths: amendment.comparison.paths.map((path) => `:(literal)${path}`),
            }),
          }
        : null;
      return {
        marked: withDiff
          .filter((entry) => entry.turnId !== null)
          .map((entry) => ({ ...entry, reviewed: reviewed.has(entry.oid) })),
        hand: withDiff
          .filter((entry) => entry.turnId === null)
          .map(({ turnId: _turnId, ...entry }) => ({
            ...entry,
            reviewed: reviewed.has(entry.oid),
          })),
        unmarked,
        unreviewedCount:
          withDiff.filter((entry) => !reviewed.has(entry.oid)).length +
          (unmarked === null || reviewed.has(unmarked.id) ? 0 : 1),
      } satisfies MercurianLineMemoryChanges;
    }).pipe(Effect.mapError(normalizeReadError("readLineMemoryChanges")));

  const ensureLatest = (position?: MemoryReadingPosition) =>
    position && position.kind !== "latest"
      ? Effect.fail(new MemoryReviewBlockedError({ reason: "historical-position" }))
      : Effect.void;

  const currentDashboard = Effect.fn("MemoryIndex.currentDashboard")(function* (input: {
    readonly projectId: MercurianProjectId;
    readonly line: MemoryLineRef;
  }) {
    const result = yield* dashboard.readDashboard({ ...input, position: { kind: "latest" } });
    if (result.kind !== "available")
      return yield* new MemoryReadUnavailableError({ reason: result.reason });
    return result;
  });

  const markChangeReviewed: MemoryIndex["Service"]["markChangeReviewed"] = (input) =>
    slotRegistry
      .withProjectLock(
        input.projectId,
        Effect.gen(function* () {
          yield* ensureLatest(input.position);
          const current = yield* currentDashboard(input);
          if (!current.amendments.some((a) => a.id === input.commitOid))
            return yield* new MemoryReviewBlockedError({ reason: "not-on-line" });
          yield* reviews.markReviewed({
            lineRootCommitId: current.position.lineRootCommitId,
            repositoryId: current.position.repositoryId,
            commitOid: input.commitOid,
            reviewedAt: yield* DateTime.now,
          });
          yield* reviews.invalidate;
        }),
      )
      .pipe(Effect.mapError(normalizeReviewError));

  const ensureNoActiveTurn = Effect.fn("MemoryIndex.ensureNoActiveTurn")(function* (
    lineRootCommitId: string,
  ) {
    const allSlots = yield* slots.listAll;
    for (const slot of allSlots.filter((s) => s.currentLineRootCommitId === lineRootCommitId)) {
      const lease = yield* slotRegistry.lease(slot.slotId);
      if (Option.isSome(lease) && lease.value.holders.some(({ kind }) => kind === "turn"))
        return yield* new MemoryReviewBlockedError({ reason: "turn-active" });
    }
    return allSlots;
  });

  const requireModernGit = Effect.gen(function* () {
    const version = yield* git.gitVersion;
    if (version.major < 2 || (version.major === 2 && version.minor < 38))
      return yield* new MergeMemoryHomeBlockedError({ reason: "git-too-old" });
  });
  const requireMerged = (
    result: { kind: "merged"; treeOid: string } | { kind: "conflict"; paths: string[] },
    selected: string,
  ) =>
    result.kind === "merged"
      ? Effect.succeed(result.treeOid)
      : Effect.fail(
          new MemoryReviewBlockedError({
            reason: "conflict",
            paths: result.paths,
            reconciliationSeed: `Reconcile the inverse of memory amendment ${selected} against the current line. Preserve later work in ${result.paths.join(", ")}.`,
          }),
        );

  const effectiveTree = Effect.fn("MemoryIndex.effectiveTree")(function* (
    cwd: string,
    position: MemoryPositionValue,
  ) {
    if (!position.snapshotOid || position.recordedHeadOid === position.headOid)
      return position.treeOid;
    const headTree = (yield* trees.run(cwd, [
      "rev-parse",
      `${position.headOid}^{tree}`,
    ])).stdout.trim();
    const snapshotTree = (yield* trees.run(cwd, [
      "rev-parse",
      `${position.snapshotOid}^{tree}`,
    ])).stdout.trim();
    return yield* requireMerged(
      yield* trees.merge(cwd, position.recordedHeadOid, headTree, snapshotTree),
      "captured work",
    );
  });

  const prepareMembers = Effect.fn("MemoryIndex.prepareMembers")(function* (
    context: Effect.Success<ReturnType<typeof lineContext>>,
    projectId: MercurianProjectId,
    fullTree: string,
    headOid: string,
  ) {
    const members: Array<{ cwd: string; indexOid: string; headTree: string }> = [];
    const headTree = (yield* trees.run(context.source.repositoryPath, [
      "rev-parse",
      `${headOid}^{tree}`,
    ])).stdout.trim();
    for (const slot of yield* slots.listAll) {
      const member = slot.members.find(
        (m) =>
          m.repositoryId === context.source.repositoryId &&
          m.currentBranch === context.branch.branch,
      );
      if (!member) continue;
      // A branch is shared even when another project's slot has a different line
      // assignment. Its claim is not protected by this project's lock.
      if (slot.projectId !== projectId || slot.currentLineRootCommitId !== context.lineRootCommitId)
        return yield* new MemoryReviewBlockedError({ reason: "slot-busy" });
      const lease = yield* slotRegistry.lease(slot.slotId);
      if (Option.isSome(lease) && lease.value.holders.length)
        return yield* new MemoryReviewBlockedError({
          reason: lease.value.holders.some((h) => h.kind === "turn") ? "turn-active" : "slot-busy",
        });
      const cwd = slotMemberWorktreePath(path, slot, context.source.repositoryId);
      if (cwd === null) continue;
      const actual = yield* trees
        .checkoutTrees(cwd)
        .pipe(
          Effect.catchTag("GitCommandError", () =>
            Effect.fail(new MemoryReviewBlockedError({ reason: "slot-dirty" })),
          ),
        );
      if (
        actual.worktreeOid !== fullTree ||
        (actual.indexOid !== headTree && actual.indexOid !== fullTree)
      ) {
        const changed = yield* trees.run(cwd, [
          "diff",
          "--name-only",
          "-z",
          fullTree,
          actual.worktreeOid,
        ]);
        const staged = yield* trees.run(cwd, [
          "diff",
          "--name-only",
          "-z",
          headTree,
          actual.indexOid,
        ]);
        return yield* new MemoryReviewBlockedError({
          reason: "slot-dirty",
          paths: [
            ...new Set(
              [...changed.stdout.split("\0"), ...staged.stdout.split("\0")].filter(Boolean),
            ),
          ].sort(),
        });
      }
      members.push({ cwd, indexOid: actual.indexOid, headTree });
    }
    return members;
  });

  const refreshMembers = Effect.fn("MemoryIndex.refreshMembers")(function* (
    members: ReadonlyArray<{ cwd: string; indexOid: string; headTree: string }>,
    beforeTree: string,
    afterTree: string,
    nextHeadOid: string,
  ) {
    for (const member of members) {
      // Apply only the curation delta. Git apply refuses overlapping editor writes;
      // it never resets unrelated files or cleans untracked files after the check.
      const patch = yield* trees.run(member.cwd, [
        "diff",
        "--binary",
        "--full-index",
        beforeTree,
        afterTree,
      ]);
      if (patch.stdout)
        yield* git.execute({
          operation: "MemoryIndex.refreshMembers.apply",
          cwd: member.cwd,
          args: ["apply", "--whitespace=nowarn"],
          stdin: patch.stdout,
        });
      const nextIndex = member.indexOid === member.headTree ? nextHeadOid : afterTree;
      yield* trees.run(member.cwd, ["read-tree", "-i", "-m", member.indexOid, nextIndex]);
    }
  });

  const revertChange: MemoryIndex["Service"]["revertChange"] = (input) =>
    slotRegistry
      .withProjectLock(
        input.projectId,
        Effect.gen(function* () {
          yield* ensureLatest(input.position);
          const context = yield* lineContext(input);
          yield* ensureNoActiveTurn(context.lineRootCommitId);
          yield* requireModernGit;
          const current = yield* currentDashboard(input);
          if (
            input.expectedVersion === undefined ||
            input.expectedVersion !== current.curationVersion
          )
            return yield* new MemoryReviewBlockedError({ reason: "stale-review" });
          const position = current.position;
          const selected =
            input.target.kind === "commit"
              ? current.amendments.find(
                  (a) =>
                    input.target.kind === "commit" &&
                    a.kind !== "unmarked" &&
                    a.id === input.target.commitOid,
                )
              : current.amendments.find((a) => a.kind === "unmarked");
          if (!selected) {
            if (input.target.kind === "unmarked") {
              yield* reviews.invalidate;
              return;
            }
            return yield* new MemoryReviewBlockedError({ reason: "not-on-line" });
          }
          const cwd = context.source.repositoryPath;
          const fullTree = yield* effectiveTree(cwd, position);
          const selectedBase = selected.kind === "unmarked" ? position.snapshotOid! : selected.id;
          const inverseTree = yield* trees.overlay(
            cwd,
            selectedBase,
            selected.comparison.beforeTreeOid,
            selected.comparison.paths,
          );
          const curatedTree = yield* requireMerged(
            yield* trees.merge(cwd, selectedBase, fullTree, inverseTree),
            selected.id,
          );
          let nextHeadOid: string | undefined;
          if (selected.kind !== "unmarked") {
            const headTree = (yield* trees.run(cwd, [
              "rev-parse",
              `${position.headOid}^{tree}`,
            ])).stdout.trim();
            const revertedTree = yield* requireMerged(
              yield* trees.merge(cwd, selectedBase, headTree, inverseTree),
              selected.id,
            );
            nextHeadOid = yield* trees.commit(
              cwd,
              revertedTree,
              [position.headOid],
              `Reverted: ${selected.title}\n\nAstrolabe-Amendment: revert:${selected.id}\nReverts-Amendment: ${selected.id}`,
            );
          }
          const members = yield* prepareMembers(
            context,
            input.projectId,
            fullTree,
            position.headOid,
          );
          yield* snapshots.captureTree({
            cwd,
            lineRootCommitId: context.lineRootCommitId,
            repositoryId: context.source.repositoryId,
            lineBranch: context.branch.branch,
            kind: "curated",
            treeOid: curatedTree,
            expected: {
              headOid: position.headOid,
              snapshotOid: position.snapshotOid,
              ...(nextHeadOid ? { nextHeadOid } : {}),
            },
          });
          yield* reviews.invalidate;
          if (nextHeadOid)
            yield* reviews.markReviewed({
              lineRootCommitId: context.lineRootCommitId,
              repositoryId: context.source.repositoryId,
              commitOid: nextHeadOid,
              reviewedAt: yield* DateTime.now,
            });
          yield* refreshMembers(members, fullTree, curatedTree, nextHeadOid ?? position.headOid);
          yield* reviews.invalidate;
        }),
      )
      .pipe(Effect.mapError(normalizeReviewError));

  const prepareMerge = Effect.fn("MemoryIndex.prepareMerge")(function* (input: {
    readonly projectId: MercurianProjectId;
    readonly line: MemoryLineRef;
  }) {
    const context = yield* lineContext(input);
    const current = yield* currentDashboard(input);
    const cwd = context.source.repositoryPath;
    const startFromOrigin = (yield* settings.getSettings).newWorktreesStartFromOrigin;
    const home = yield* resolveRepositoryDefault({ git, path: cwd, startFromOrigin });
    const homeRef = `refs/heads/${home.branch}`;
    const homeOid = yield* positions.resolve(cwd, `${homeRef}^{commit}`);
    if (!homeOid) return yield* new MergeMemoryHomeBlockedError({ reason: "main-missing" });
    const loaded = yield* loadRef({
      kind: "ref",
      repositoryPath: cwd,
      subpath: context.source.subpath ?? "",
      ref: current.position.treeOid,
      treeOid: current.position.treeOid,
    });
    const warnings = [
      ...new Set([
        ...loaded.index.problems,
        ...loaded.maps.flatMap((map) => ("refusal" in map ? [map.refusal] : [])),
      ]),
    ].sort();
    const treeOid = yield* effectiveTree(cwd, current.position);
    const identity = {
      sourceUpdatedAt: DateTime.formatIso(context.source.updatedAt),
      projectId: input.projectId,
      repositoryId: current.position.repositoryId,
      memoryRoot: current.position.memoryRoot,
      lineRootCommitId: current.position.lineRootCommitId,
      baseCommitOid: current.position.baseCommitOid,
      baselineTreeOid: current.position.baselineTreeOid,
      baselineSnapshotOid: current.position.baselineSnapshotOid,
      headOid: current.position.headOid,
      snapshotOid: current.position.snapshotOid,
      treeOid,
      homeOid,
      homeRef,
      amendments: current.amendments.map((a) => ({ id: a.id, reviewed: a.reviewed })),
      warnings,
    };
    const review: MemoryMergeReview = {
      version: memoryReviewVersion(identity),
      headOid: identity.headOid,
      snapshotOid: identity.snapshotOid,
      treeOid,
      homeOid,
      homeRef,
      unmarkedId: current.amendments.find((a) => a.kind === "unmarked")?.id ?? null,
      unreviewedIds: current.amendments.filter((a) => !a.reviewed).map((a) => a.id),
      warnings,
    };
    const repositorySnapshot = yield* repositories.getSnapshot;
    const shared =
      context.source.subpath !== null ||
      repositorySnapshot.projectRepositories.some(
        (link) =>
          link.projectId === input.projectId && link.repositoryId === context.source.repositoryId,
      );
    return { context, current, review, shared };
  });

  const mergeHome: MemoryIndex["Service"]["mergeHome"] = (input) =>
    slotRegistry
      .withProjectLock(
        input.projectId,
        Effect.gen(function* () {
          yield* ensureLatest(input.position);
          const context = yield* lineContext(input);
          yield* ensureNoActiveTurn(context.lineRootCommitId);
          yield* requireModernGit;
          const prepared = yield* prepareMerge(input);
          const { review, current, shared } = prepared;
          const cwd = context.source.repositoryPath;
          const checkedOut = yield* git.execute({
            operation: "MemoryIndex.mergeHome.checkedOut",
            cwd,
            args: ["symbolic-ref", "--quiet", "HEAD"],
            allowNonZeroExit: true,
          });
          if (!shared && checkedOut.stdout.trim() === review.homeRef) {
            const dirty = yield* trees.run(cwd, ["status", "--porcelain", "--untracked-files=all"]);
            if (dirty.stdout.length)
              return yield* new MergeMemoryHomeBlockedError({ reason: "checkout-dirty" });
          }
          if (
            input.expectedVersion !== review.version ||
            review.unreviewedIds.length ||
            (input.reviewedUnmarkedId ?? null) !== review.unmarkedId
          )
            return { kind: "review-required" as const, review };
          if (shared) {
            yield* reviews.markReviewed({
              lineRootCommitId: context.lineRootCommitId,
              repositoryId: context.source.repositoryId,
              commitOid: repositoryExitApproval({
                sourceUpdatedAt: DateTime.formatIso(context.source.updatedAt),
                baseOid: context.branch.baseOid,
                projectId: input.projectId,
                repositoryId: context.source.repositoryId,
                lineRootCommitId: context.lineRootCommitId,
                review,
                memoryRoot: current.position.memoryRoot,
                reviewIds: (yield* reviews.listReviewed({
                  lineRootCommitId: context.lineRootCommitId,
                  repositoryId: context.source.repositoryId,
                }))
                  .map((r) => r.commitOid)
                  .filter((id) => !id.startsWith("exit:"))
                  .sort(),
              }),
              reviewedAt: yield* DateTime.now,
            });
            yield* reviews.invalidate;
            return { kind: "deferred-to-push" as const };
          }
          let lineTip = review.headOid;
          const unmarked = current.amendments.find((a) => a.kind === "unmarked");
          if (unmarked) {
            const tree = yield* trees.overlay(
              cwd,
              lineTip,
              review.treeOid,
              unmarked.comparison.paths,
            );
            lineTip = yield* trees.commit(
              cwd,
              tree,
              [lineTip],
              "Unmarked memory changes\n\nAstrolabe-Amendment: unmarked",
            );
          }
          const merged = yield* git.execute({
            operation: "MemoryIndex.mergeHome.mergeTree",
            cwd,
            args: ["merge-tree", "--write-tree", "--name-only", "-z", review.homeOid, lineTip],
            allowNonZeroExit: true,
          });
          if (merged.exitCode === 1) {
            const fields = merged.stdout.split("\0");
            return {
              kind: "conflict" as const,
              conflicts: fields.slice(1, fields.indexOf("", 1)).map((path) => ({ path })),
            };
          }
          if (merged.exitCode !== 0)
            return yield* new MercurianMemoryError({
              operation: "mergeMemoryHome",
              cause: merged.stderr,
            });
          const tree = merged.stdout.split("\0")[0]!.trim();
          const commitOid = yield* trees.commit(
            cwd,
            tree,
            [review.homeOid, lineTip],
            `Merge memory from ${context.detail.plan.title}`,
          );
          // No ref moves until every review, conflict and checkout check has passed.
          const members = yield* prepareMembers(
            context,
            input.projectId,
            review.treeOid,
            review.headOid,
          );
          const captured = yield* snapshots
            .captureTree({
              cwd,
              lineRootCommitId: context.lineRootCommitId,
              repositoryId: context.source.repositoryId,
              lineBranch: context.branch.branch,
              kind: "curated",
              treeOid: review.treeOid,
              expected: {
                headOid: review.headOid,
                snapshotOid: review.snapshotOid,
                ...(lineTip !== review.headOid ? { nextHeadOid: lineTip } : {}),
                refs: [{ ref: review.homeRef, expectedOid: review.homeOid, oid: commitOid }],
              },
            })
            .pipe(
              Effect.map((snapshot) => ({ kind: "captured" as const, snapshot })),
              Effect.catchTag("GitCommandError", (cause) =>
                Effect.gen(function* () {
                  if (cause.operation !== "SnapshotChain.captureTree.transaction")
                    return yield* cause;
                  // A failed CAS has not promoted home. Do not hide an ambiguous transport
                  // failure after a successful transaction behind a fresh review response.
                  if ((yield* positions.resolve(cwd, review.homeRef)) === commitOid)
                    return yield* cause;
                  const fresh = yield* prepareMerge(input);
                  if (fresh.review.version === review.version) return yield* cause;
                  return { kind: "review-required" as const, review: fresh.review };
                }),
              ),
            );
          if (captured.kind === "review-required") {
            yield* reviews.invalidate;
            return captured;
          }
          yield* reviews.invalidate;
          if (unmarked)
            yield* reviews.markReviewed({
              lineRootCommitId: context.lineRootCommitId,
              repositoryId: context.source.repositoryId,
              commitOid: lineTip,
              reviewedAt: yield* DateTime.now,
            });
          yield* refreshMembers(members, review.treeOid, review.treeOid, lineTip);
          if (checkedOut.stdout.trim() === review.homeRef)
            yield* trees.run(cwd, ["read-tree", "-m", "-u", review.homeOid, commitOid]);
          const now = yield* DateTime.now;
          for (const runtime of context.detail.lineRuntimes.filter(
            (r) => r.lineRootCommitId === context.lineRootCommitId,
          ))
            yield* lineRuntimes.recordMemoryMergedHome(runtime.threadId, now);
          for (const session of context.detail.codingSessions.filter(
            (s) => lineRootCommitIdFor(context.detail, s.commitId) === context.lineRootCommitId,
          ))
            yield* legacySessions.recordMemoryMergedHome(session.threadId, now);
          yield* reviews.invalidate;
          return { kind: "merged" as const, commitOid };
        }),
      )
      .pipe(Effect.mapError(normalizeMergeHomeError));

  return {
    getLineContext: (input) =>
      lineIdentity(input).pipe(
        Effect.mapError(
          (cause) => new MercurianMemoryError({ operation: "readMemoryDashboard", cause }),
        ),
      ),
    readIndex,
    readNote,
    generateProductMap,
    prepareAmendment,
    resolveLineSource,
    landAmendment,
    readLineChanges,
    markChangeReviewed,
    revertChange,
    mergeHome,
  } satisfies MemoryIndex["Service"];
});

export const layer = Layer.effect(MemoryIndex, make);
