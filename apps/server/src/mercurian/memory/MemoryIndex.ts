import {
  makeMemoryLineIdentity,
  makeMemoryPosition,
  type MemoryLineContext,
} from "./MemoryPosition.ts";
import * as NodeCrypto from "node:crypto";

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
  MemoryReviewBlockedError,
  MergeMemoryHomeBlockedError,
  type MemoryMapPlacement,
  type MemoryLineRef,
  type MemoryIndex as MemoryIndexValue,
  type MemoryNote,
  type MercurianLineMemoryChanges,
  type MercurianMergeMemoryHomeResult,
  type MercurianCommitId,
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
import { lineSnapshotRef, SnapshotChain } from "../worktreeSlots/SnapshotChain.ts";
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
    }) => Effect.Effect<void, MemoryIndexError>;
    readonly revertChange: (input: {
      readonly projectId: MercurianProjectId;
      readonly line: MemoryLineRef;
      readonly target:
        | { readonly kind: "commit"; readonly commitOid: string }
        | { readonly kind: "unmarked" };
    }) => Effect.Effect<void, MemoryIndexError | MemoryReviewBlockedError>;
    readonly mergeHome: (input: {
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

  const readUnmarkedSnapshot = Effect.fn("MemoryIndex.readUnmarkedSnapshot")(function* (input: {
    readonly cwd: string;
    readonly lineRootCommitId: MercurianCommitId;
    readonly scope: string;
    readonly snapshotOid?: string | null;
  }) {
    let chainHead = input.snapshotOid;
    if (chainHead === undefined) {
      const resolvedSnapshot = yield* git.execute({
        operation: "MemoryIndex.readUnmarkedSnapshot.resolveSnapshot",
        cwd: input.cwd,
        args: [
          "rev-parse",
          "--verify",
          "--quiet",
          `${lineSnapshotRef(input.lineRootCommitId)}^{commit}`,
        ],
        allowNonZeroExit: true,
      });
      chainHead = resolvedSnapshot.exitCode === 0 ? resolvedSnapshot.stdout.trim() : null;
    }
    if (chainHead === null) return null;
    const secondParent = yield* git.execute({
      operation: "MemoryIndex.readUnmarkedSnapshot.secondParent",
      cwd: input.cwd,
      args: ["rev-parse", "--verify", "--quiet", `${chainHead}^2`],
      allowNonZeroExit: true,
    });
    const recordedHead =
      secondParent.exitCode === 0
        ? secondParent.stdout.trim()
        : (yield* git.execute({
            operation: "MemoryIndex.readUnmarkedSnapshot.firstParent",
            cwd: input.cwd,
            args: ["rev-parse", "--verify", `${chainHead}^1`],
          })).stdout.trim();
    const diff = yield* checkpoints.diffCheckpoints({
      cwd: input.cwd,
      fromCheckpointRef: CheckpointRef.make(recordedHead),
      toCheckpointRef: CheckpointRef.make(chainHead),
      ignoreWhitespace: false,
      paths: [input.scope],
    });
    if (diff.trim().length === 0) return null;
    const paths = (yield* git.execute({
      operation: "MemoryIndex.readUnmarkedSnapshot.paths",
      cwd: input.cwd,
      args: [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        recordedHead,
        chainHead,
        "--",
        input.scope,
      ],
    })).stdout
      .split("\0")
      .filter(Boolean);
    return { chainHead, recordedHead, diff, paths };
  });

  const readLineChanges: MemoryIndex["Service"]["readLineChanges"] = (input) =>
    Effect.gen(function* () {
      const context = yield* lineIdentity(input);
      const position = yield* positions
        .read(context, input.position ?? { kind: "latest" })
        .pipe(Effect.scoped);
      if ("kind" in position)
        return yield* new MemoryReadUnavailableError({ reason: position.reason });
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
      const entries = log.stdout
        .split("\x1e")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [oid = "", title = "", trailers = "", authoredAt = ""] = entry.split("\0");
          const match = /^Astrolabe-Amendment:\s*(.+)$/imu.exec(trailers);
          return { oid, title, turnId: match?.[1]?.trim() ?? null, authoredAt };
        });
      const withDiff = yield* Effect.forEach(entries, (entry) =>
        git
          .execute({
            operation: "MemoryIndex.readLineChanges.diff",
            cwd: context.source.repositoryPath,
            args: ["show", "--format=", "--patch", entry.oid, "--", scope],
          })
          .pipe(Effect.map((result) => ({ ...entry, diff: result.stdout }))),
      );
      const reviewed = new Set(
        (yield* reviews.listReviewed({
          lineRootCommitId: context.lineRootCommitId,
          repositoryId: context.source.repositoryId,
        })).map(({ commitOid }) => commitOid),
      );
      const unmarked = yield* readUnmarkedSnapshot({
        cwd: context.source.repositoryPath,
        lineRootCommitId: context.lineRootCommitId,
        scope,
        snapshotOid: position.snapshotOid,
      });
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
        unmarked: unmarked === null ? null : { diff: unmarked.diff },
        unreviewedCount:
          withDiff.filter((entry) => !reviewed.has(entry.oid)).length + (unmarked === null ? 0 : 1),
      } satisfies MercurianLineMemoryChanges;
    }).pipe(Effect.mapError(normalizeReadError("readLineMemoryChanges")));

  const markChangeReviewed: MemoryIndex["Service"]["markChangeReviewed"] = (input) =>
    Effect.gen(function* () {
      const context = yield* lineContext(input);
      yield* reviews.markReviewed({
        lineRootCommitId: context.lineRootCommitId,
        repositoryId: context.source.repositoryId,
        commitOid: input.commitOid,
        reviewedAt: yield* DateTime.now,
      });
    }).pipe(Effect.mapError(normalizeReadError("readLineMemoryChanges")));

  const ensureNoActiveTurn = Effect.fn("MemoryIndex.ensureNoActiveTurn")(function* (
    lineRootCommitId: string,
  ) {
    const allSlots = yield* slots.listAll;
    for (const slot of allSlots.filter(
      (candidate) => candidate.currentLineRootCommitId === lineRootCommitId,
    )) {
      const lease = yield* slotRegistry.lease(slot.slotId);
      if (Option.isSome(lease) && lease.value.holders.some(({ kind }) => kind === "turn")) {
        return yield* new MemoryReviewBlockedError({ reason: "turn-active" });
      }
    }
    return allSlots;
  });

  const revertChange: MemoryIndex["Service"]["revertChange"] = (input) =>
    Effect.gen(function* () {
      const context = yield* lineContext(input);
      const allSlots = yield* ensureNoActiveTurn(context.lineRootCommitId);
      const scope = context.source.subpath ?? ".";
      const branchRef = `refs/heads/${context.branch.branch}`;
      const tip = (yield* git.execute({
        operation: "MemoryIndex.revertChange.tip",
        cwd: context.source.repositoryPath,
        args: ["rev-parse", `${branchRef}^{commit}`],
      })).stdout.trim();
      if (input.target.kind === "commit") {
        const commit = input.target.commitOid;
        const onLine = yield* git.execute({
          operation: "MemoryIndex.revertChange.commitOnLine",
          cwd: context.source.repositoryPath,
          args: ["merge-base", "--is-ancestor", commit, tip],
          allowNonZeroExit: true,
        });
        const atOrBeforeBase = yield* git.execute({
          operation: "MemoryIndex.revertChange.commitAfterBase",
          cwd: context.source.repositoryPath,
          args: ["merge-base", "--is-ancestor", commit, context.branch.baseOid],
          allowNonZeroExit: true,
        });
        if (onLine.exitCode !== 0 || atOrBeforeBase.exitCode === 0) {
          return yield* new MemoryReviewBlockedError({ reason: "not-on-line" });
        }
      }
      const unmarked =
        input.target.kind === "unmarked"
          ? yield* readUnmarkedSnapshot({
              cwd: context.source.repositoryPath,
              lineRootCommitId: context.lineRootCommitId,
              scope,
            })
          : null;
      if (input.target.kind === "unmarked" && unmarked === null) return;
      const commonDir = (yield* git.execute({
        operation: "MemoryIndex.revertChange.commonDir",
        cwd: context.source.repositoryPath,
        args: ["rev-parse", "--git-common-dir"],
      })).stdout.trim();
      const resolvedCommonDir = path.isAbsolute(commonDir)
        ? commonDir
        : path.resolve(context.source.repositoryPath, commonDir);
      const tempIndex = path.join(
        resolvedCommonDir,
        `t3-memory-revert-index-${NodeCrypto.randomUUID()}`,
      );
      const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: tempIndex };
      const cleanup = fs.remove(tempIndex, { force: true }).pipe(Effect.ignore);
      yield* Effect.gen(function* () {
        if (input.target.kind === "commit") {
          const commit = input.target.commitOid;
          const metadata = (yield* git.execute({
            operation: "MemoryIndex.revertChange.metadata",
            cwd: context.source.repositoryPath,
            args: ["show", "-s", "--format=%s", commit],
          })).stdout.trim();
          const touched = (yield* git.execute({
            operation: "MemoryIndex.revertChange.paths",
            cwd: context.source.repositoryPath,
            args: ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit, "--", scope],
          })).stdout
            .split("\0")
            .filter(Boolean);
          yield* git.execute({
            operation: "MemoryIndex.revertChange.readTip",
            cwd: context.source.repositoryPath,
            args: ["read-tree", tip],
            env,
          });
          const checkoutPaths: Array<string> = [];
          const removedPaths: Array<string> = [];
          for (const touchedPath of touched) {
            const parentEntry = yield* git.execute({
              operation: "MemoryIndex.revertChange.parentEntry",
              cwd: context.source.repositoryPath,
              args: ["ls-tree", `${commit}^`, "--", touchedPath],
              allowNonZeroExit: true,
            });
            const match = /^(\d+)\s+\w+\s+([0-9a-f]+)\t/u.exec(parentEntry.stdout);
            if (match === null) removedPaths.push(touchedPath);
            else checkoutPaths.push(touchedPath);
            yield* git.execute({
              operation: "MemoryIndex.revertChange.updateIndex",
              cwd: context.source.repositoryPath,
              args:
                match === null
                  ? ["update-index", "--force-remove", "--", touchedPath]
                  : [
                      "update-index",
                      "--add",
                      "--cacheinfo",
                      `${match[1]},${match[2]},${touchedPath}`,
                    ],
              env,
            });
          }
          const tree = (yield* git.execute({
            operation: "MemoryIndex.revertChange.writeTree",
            cwd: context.source.repositoryPath,
            args: ["write-tree"],
            env,
          })).stdout.trim();
          const message = `Reverted: ${metadata}\n\nAstrolabe-Amendment: revert:${commit}\nAmended-from-plan: ${context.detail.plan.title} (${context.planId})`;
          const reverted = (yield* git.execute({
            operation: "MemoryIndex.revertChange.commit",
            cwd: context.source.repositoryPath,
            args: ["commit-tree", tree, "-p", tip, "-m", message],
          })).stdout.trim();
          yield* git.execute({
            operation: "MemoryIndex.revertChange.moveBranch",
            cwd: context.source.repositoryPath,
            args: ["update-ref", branchRef, reverted, tip],
          });
          yield* reviews.markReviewed({
            lineRootCommitId: context.lineRootCommitId,
            repositoryId: context.source.repositoryId,
            commitOid: reverted,
            reviewedAt: yield* DateTime.now,
          });
          yield* Effect.forEach(
            allSlots.flatMap((slot) => {
              const member = slot.members.find(
                (candidate) =>
                  candidate.repositoryId === context.source.repositoryId &&
                  candidate.currentBranch === context.branch.branch,
              );
              const cwd =
                member === undefined
                  ? null
                  : slotMemberWorktreePath(path, slot, context.source.repositoryId);
              return cwd === null ? [] : [cwd];
            }),
            (cwd) =>
              Effect.gen(function* () {
                if (removedPaths.length > 0) {
                  yield* git.execute({
                    operation: "MemoryIndex.revertChange.removeFromMember",
                    cwd,
                    args: ["rm", "-f", "--ignore-unmatch", "--", ...removedPaths],
                  });
                }
                if (checkoutPaths.length > 0) {
                  yield* git.execute({
                    operation: "MemoryIndex.revertChange.refreshCommit",
                    cwd,
                    args: ["checkout", context.branch.branch, "--", ...checkoutPaths],
                  });
                }
              }),
            { discard: true },
          );
          return;
        }
        const chainHead = unmarked!.chainHead;
        yield* git.execute({
          operation: "MemoryIndex.revertChange.readChain",
          cwd: context.source.repositoryPath,
          args: ["read-tree", chainHead],
          env,
        });
        if (context.source.subpath === null) {
          yield* git.execute({
            operation: "MemoryIndex.revertChange.readBranch",
            cwd: context.source.repositoryPath,
            args: ["read-tree", tip],
            env,
          });
        } else {
          yield* git.execute({
            operation: "MemoryIndex.revertChange.removeMemory",
            cwd: context.source.repositoryPath,
            args: ["rm", "--cached", "-r", "-f", "--ignore-unmatch", "--", context.source.subpath],
            env,
          });
          const branchMemory = yield* git.execute({
            operation: "MemoryIndex.revertChange.resolveBranchMemory",
            cwd: context.source.repositoryPath,
            args: ["cat-file", "-e", `${tip}:${context.source.subpath}`],
            allowNonZeroExit: true,
          });
          if (branchMemory.exitCode === 0) {
            yield* git.execute({
              operation: "MemoryIndex.revertChange.restoreMemory",
              cwd: context.source.repositoryPath,
              args: [
                "read-tree",
                `--prefix=${context.source.subpath}/`,
                `${tip}:${context.source.subpath}`,
              ],
              env,
            });
          }
        }
        const treeOid = (yield* git.execute({
          operation: "MemoryIndex.revertChange.writeSnapshotTree",
          cwd: context.source.repositoryPath,
          args: ["write-tree"],
          env,
        })).stdout.trim();
        const snapshot = yield* snapshots.captureTree({
          cwd: context.source.repositoryPath,
          lineRootCommitId: context.lineRootCommitId,
          repositoryId: context.source.repositoryId,
          lineBranch: context.branch.branch,
          kind: "curated",
          treeOid,
        });
        yield* Effect.forEach(
          allSlots.flatMap((slot) => {
            const member = slot.members.find(
              (candidate) =>
                candidate.repositoryId === context.source.repositoryId &&
                candidate.currentBranch === context.branch.branch,
            );
            const cwd =
              member === undefined
                ? null
                : slotMemberWorktreePath(path, slot, context.source.repositoryId);
            return cwd === null ? [] : [cwd];
          }),
          (cwd) =>
            git.execute({
              operation: "MemoryIndex.revertChange.refreshUnmarked",
              cwd,
              args: ["checkout", snapshot.oid, "--", scope],
            }),
          { discard: true },
        );
      }).pipe(Effect.ensuring(cleanup));
    }).pipe(Effect.mapError(normalizeReviewError));

  const mergeHome: MemoryIndex["Service"]["mergeHome"] = (input) =>
    Effect.gen(function* () {
      const context = yield* lineContext(input);
      yield* ensureNoActiveTurn(context.lineRootCommitId);
      const scope = context.source.subpath ?? ".";
      const branchRef = `refs/heads/${context.branch.branch}`;
      let lineTip = (yield* git.execute({
        operation: "MemoryIndex.mergeHome.lineTip",
        cwd: context.source.repositoryPath,
        args: ["rev-parse", `${branchRef}^{commit}`],
      })).stdout.trim();
      const unmarked = yield* readUnmarkedSnapshot({
        cwd: context.source.repositoryPath,
        lineRootCommitId: context.lineRootCommitId,
        scope,
      });

      if (unmarked !== null) {
        const commonDir = (yield* git.execute({
          operation: "MemoryIndex.mergeHome.commonDir",
          cwd: context.source.repositoryPath,
          args: ["rev-parse", "--git-common-dir"],
        })).stdout.trim();
        const resolvedCommonDir = path.isAbsolute(commonDir)
          ? commonDir
          : path.resolve(context.source.repositoryPath, commonDir);
        const tempIndex = path.join(
          resolvedCommonDir,
          `t3-memory-merge-home-index-${NodeCrypto.randomUUID()}`,
        );
        const env: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: tempIndex };
        yield* Effect.gen(function* () {
          yield* git.execute({
            operation: "MemoryIndex.mergeHome.readLineTip",
            cwd: context.source.repositoryPath,
            args: ["read-tree", lineTip],
            env,
          });
          yield* git.execute({
            operation: "MemoryIndex.mergeHome.removeChangedMemory",
            cwd: context.source.repositoryPath,
            args: ["update-index", "--force-remove", "--", ...unmarked.paths],
            env,
          });
          const chainEntries = yield* git.execute({
            operation: "MemoryIndex.mergeHome.readChangedMemory",
            cwd: context.source.repositoryPath,
            args: ["ls-tree", "-r", "-z", unmarked.chainHead, "--", ...unmarked.paths],
          });
          if (chainEntries.stdout.length > 0) {
            yield* git.execute({
              operation: "MemoryIndex.mergeHome.restoreChangedMemory",
              cwd: context.source.repositoryPath,
              args: ["update-index", "-z", "--index-info"],
              stdin: chainEntries.stdout,
              env,
            });
          }
          const tree = (yield* git.execute({
            operation: "MemoryIndex.mergeHome.writeUnmarkedTree",
            cwd: context.source.repositoryPath,
            args: ["write-tree"],
            env,
          })).stdout.trim();
          const message = `Unmarked memory changes\n\nAstrolabe-Amendment: unmarked\nAmended-from-plan: ${context.detail.plan.title} (${context.planId})`;
          const commit = (yield* git.execute({
            operation: "MemoryIndex.mergeHome.commitUnmarked",
            cwd: context.source.repositoryPath,
            args: ["commit-tree", tree, "-p", lineTip, "-m", message],
          })).stdout.trim();
          yield* git.execute({
            operation: "MemoryIndex.mergeHome.moveLineBranch",
            cwd: context.source.repositoryPath,
            args: ["update-ref", branchRef, commit, lineTip],
          });
          yield* reviews.markReviewed({
            lineRootCommitId: context.lineRootCommitId,
            repositoryId: context.source.repositoryId,
            commitOid: commit,
            reviewedAt: yield* DateTime.now,
          });
          lineTip = commit;
        }).pipe(Effect.ensuring(fs.remove(tempIndex, { force: true }).pipe(Effect.ignore)));
      }

      const repositorySnapshot = yield* repositories.getSnapshot;
      const memoryIsLinked = repositorySnapshot.projectRepositories.some(
        (link) =>
          link.projectId === input.projectId && link.repositoryId === context.source.repositoryId,
      );
      const lineSessions = context.detail.codingSessions.filter(
        (session) =>
          lineRootCommitIdFor(context.detail, session.commitId) === context.lineRootCommitId,
      );
      const lineRuntimeRecords = context.detail.lineRuntimes.filter(
        (runtime) => runtime.lineRootCommitId === context.lineRootCommitId,
      );
      const recordMergedHome = Effect.fn("MemoryIndex.mergeHome.record")(function* () {
        const now = yield* DateTime.now;
        yield* Effect.all(
          [
            Effect.forEach(
              lineRuntimeRecords,
              (runtime) => lineRuntimes.recordMemoryMergedHome(runtime.threadId, now),
              { discard: true },
            ),
            Effect.forEach(
              lineSessions,
              (session) => legacySessions.recordMemoryMergedHome(session.threadId, now),
              { discard: true },
            ),
          ],
          { concurrency: "unbounded", discard: true },
        );
      });

      if (context.source.subpath !== null || memoryIsLinked) {
        yield* recordMergedHome();
        return { kind: "deferred-to-push" as const };
      }

      const version = yield* git.gitVersion;
      if (version.major < 2 || (version.major === 2 && version.minor < 38)) {
        return yield* new MergeMemoryHomeBlockedError({ reason: "git-too-old" });
      }
      const startFromOrigin = (yield* settings.getSettings).newWorktreesStartFromOrigin;
      const home = yield* resolveRepositoryDefault({
        git,
        path: context.source.repositoryPath,
        startFromOrigin,
      });
      const mainRef = `refs/heads/${home.branch}`;
      const resolvedMain = yield* git.execute({
        operation: "MemoryIndex.mergeHome.mainTip",
        cwd: context.source.repositoryPath,
        args: ["rev-parse", "--verify", `${mainRef}^{commit}`],
        allowNonZeroExit: true,
      });
      if (resolvedMain.exitCode !== 0) {
        return yield* new MergeMemoryHomeBlockedError({ reason: "main-missing" });
      }
      const mainOid = resolvedMain.stdout.trim();
      const checkedOut = yield* git.execute({
        operation: "MemoryIndex.mergeHome.checkedOutBranch",
        cwd: context.source.repositoryPath,
        args: ["symbolic-ref", "--quiet", "HEAD"],
        allowNonZeroExit: true,
      });
      if (checkedOut.exitCode === 0 && checkedOut.stdout.trim() === mainRef) {
        const dirty = yield* git.execute({
          operation: "MemoryIndex.mergeHome.checkoutStatus",
          cwd: context.source.repositoryPath,
          args: ["status", "--porcelain", "--", scope],
        });
        if (dirty.stdout.trim().length > 0) {
          return yield* new MergeMemoryHomeBlockedError({ reason: "checkout-dirty" });
        }
      }

      const mergedTree = yield* git.execute({
        operation: "MemoryIndex.mergeHome.mergeTree",
        cwd: context.source.repositoryPath,
        args: ["merge-tree", "--write-tree", "--messages", mainOid, lineTip],
        allowNonZeroExit: true,
      });
      if (mergedTree.exitCode === 1) {
        const paths = new Set<string>();
        for (const line of `${mergedTree.stdout}\n${mergedTree.stderr}`.split("\n")) {
          const stagedPath = /^\d+\s+\w+\s+[0-9a-f]+\t(.+)$/u.exec(line)?.[1];
          const messagePath = /(?: in |modify\/delete:)\s*(.+)$/u.exec(line)?.[1];
          const conflictPath = stagedPath ?? messagePath;
          if (conflictPath !== undefined && conflictPath.trim().length > 0) {
            paths.add(conflictPath.trim());
          }
        }
        return {
          kind: "conflict" as const,
          conflicts: [...paths].sort().map((conflictPath) => ({ path: conflictPath })),
        };
      }
      if (mergedTree.exitCode !== 0) {
        return yield* new MercurianMemoryError({
          operation: "mergeMemoryHome",
          cause: new Error(mergedTree.stderr || "git merge-tree failed"),
        });
      }
      const tree = mergedTree.stdout.split("\n", 1)[0]?.trim();
      if (!tree) {
        return yield* new MercurianMemoryError({
          operation: "mergeMemoryHome",
          cause: new Error("git merge-tree did not return a tree"),
        });
      }
      const commitOid = (yield* git.execute({
        operation: "MemoryIndex.mergeHome.commit",
        cwd: context.source.repositoryPath,
        args: [
          "commit-tree",
          tree,
          "-p",
          mainOid,
          "-p",
          lineTip,
          "-m",
          `Merge memory from ${context.detail.plan.title}`,
        ],
      })).stdout.trim();
      yield* git.execute({
        operation: "MemoryIndex.mergeHome.moveMain",
        cwd: context.source.repositoryPath,
        args: ["update-ref", mainRef, commitOid, mainOid],
      });
      if (checkedOut.exitCode === 0 && checkedOut.stdout.trim() === mainRef) {
        yield* git.execute({
          operation: "MemoryIndex.mergeHome.refreshCheckout",
          cwd: context.source.repositoryPath,
          args: ["checkout", home.branch, "--", scope],
        });
      }
      yield* recordMergedHome();
      return { kind: "merged" as const, commitOid };
    }).pipe(Effect.mapError(normalizeMergeHomeError));

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
