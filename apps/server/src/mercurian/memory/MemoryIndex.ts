import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import {
  MemoryNotDesignatedError,
  type MemoryAmendmentProposal,
  type MemoryMapPlacement,
  type MemoryIndex as MemoryIndexValue,
  type MemoryNote,
  MercurianMemoryError,
  type MercurianProjectId,
  type PlanTurnId,
  ProductMapAlreadyExistsError,
  ProductMapCycleError,
  ConfirmMemoryAmendmentBlockedError,
  isProductMapCycleError,
} from "@t3tools/contracts";

import * as ProcessRunner from "../../processRunner.ts";
import * as MemorySourceStore from "./MemorySourceStore.ts";
import {
  buildMemoryGraph,
  compileProductMap,
  fingerprintMemoryFiles,
  insertMapPlacement,
  isValidMemoryNoteName,
  missingOpenDecisionHeadings,
  parseAndValidateMemoryMap,
  parseOpenDecisions,
  serializeMemoryMap,
  type MemoryGraph,
} from "./memoryModel.ts";
import type { ResolvedMemorySource } from "./schema.ts";

export type MemoryIndexError =
  | MemorySourceStore.MemorySourceStoreError
  | PlatformError.PlatformError
  | ProcessRunner.ProcessRunError
  | MemoryNotDesignatedError
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

export class MemoryIndex extends Context.Service<
  MemoryIndex,
  {
    readonly readIndex: (
      projectId: MercurianProjectId,
    ) => Effect.Effect<MemoryIndexValue, MemoryIndexError>;
    readonly readNote: (
      projectId: MercurianProjectId,
      name: string,
    ) => Effect.Effect<MemoryNote, MemoryIndexError>;
    readonly generateProductMap: (
      projectId: MercurianProjectId,
    ) => Effect.Effect<void, MemoryIndexError>;
    readonly prepareAmendment: (input: {
      readonly projectId: MercurianProjectId;
      readonly turnId: PlanTurnId;
      readonly amendment: PendingMemoryAmendment;
    }) => Effect.Effect<MemoryAmendmentProposal, MemoryIndexError | MemoryAmendmentValidationError>;
    readonly applyAmendment: (input: {
      readonly projectId: MercurianProjectId;
      readonly proposal: MemoryAmendmentProposal;
      readonly planId: string;
      readonly planName: string;
    }) => Effect.Effect<string | null, MemoryIndexError | ConfirmMemoryAmendmentBlockedError>;
  }
>()("t3/mercurian/memory/MemoryIndex") {}

const posix = (value: string) => value.replaceAll("\\", "/");

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const sourceStore = yield* MemorySourceStore.MemorySourceStore;
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
  }) {
    const repositoryRoot = yield* gitRoot(input.rootPath);
    if (repositoryRoot === null) return null;
    const relativePaths = input.absolutePaths.map((file) => path.relative(repositoryRoot, file));
    const add = yield* runGit(repositoryRoot, ["add", "--", ...relativePaths]);
    const commit =
      add.code === 0
        ? yield* runGit(repositoryRoot, [
            "commit",
            "--only",
            "-m",
            input.message,
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
    const productPath = path.join(source.rootPath, "maps", "product.yaml");
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
      fs
        .readFileString(file)
        .pipe(
          Effect.map((contents) =>
            parseAndValidateMemoryMap(posix(path.relative(source.rootPath, file)), contents, graph),
          ),
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

  const readIndex: MemoryIndex["Service"]["readIndex"] = (projectId) =>
    Effect.gen(function* () {
      const source = yield* requireSource(projectId);
      return (yield* loadRoot(source)).index;
    });

  const readNote: MemoryIndex["Service"]["readNote"] = (projectId, name) =>
    Effect.gen(function* () {
      const source = yield* requireSource(projectId);
      const { graph } = yield* loadRoot(source);
      const selected = graph.noteByName.get(name);
      if (selected === undefined) {
        return {
          name,
          exists: false,
          links: [],
          backlinks: graph.backlinks.get(name) ?? [],
          openDecisions: [],
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
        openDecisions: parseOpenDecisions(selected.markdown),
      } satisfies MemoryNote;
    });

  const generateProductMap: MemoryIndex["Service"]["generateProductMap"] = (projectId) =>
    Effect.gen(function* () {
      const source = yield* requireSource(projectId);
      const productPath = path.join(source.rootPath, "maps", "product.yaml");
      if (yield* fs.exists(productPath)) {
        return yield* new ProductMapAlreadyExistsError({ projectId });
      }
      const { graph } = yield* loadRoot(source);
      const compiled = compileProductMap(graph.declarations);
      if (isProductMapCycleError(compiled)) return yield* compiled;
      yield* fs.makeDirectory(path.dirname(productPath), { recursive: true });
      yield* fs.writeFileString(productPath, serializeMemoryMap(compiled));
      cache.delete(source.rootPath);

      yield* commitPaths({
        rootPath: source.rootPath,
        absolutePaths: [productPath],
        message: "Generate product map from containment declarations",
        operation: "generateProductMap",
      });
    });

  const makePatch = Effect.fn("MemoryIndex.makePatch")(function* (
    changes: MemoryAmendmentProposal["changes"],
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

  const prepareAmendment: MemoryIndex["Service"]["prepareAmendment"] = (input) =>
    Effect.gen(function* () {
      const source = yield* requireSource(input.projectId);
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
      const noteChanges: Array<MemoryAmendmentProposal["changes"][number]> = [];
      for (const note of input.amendment.notes) {
        const previous = loaded.graph.noteByName.get(note.name);
        if (previous !== undefined) {
          const missing = missingOpenDecisionHeadings(previous.markdown, note.markdown);
          if (missing.length > 0) {
            return yield* new MemoryAmendmentValidationError({
              reason: `Keep the Open Decision heading${missing.length === 1 ? "" : "s"} ${missing.map((heading) => `“${heading}”`).join(", ")} and record any resolution beneath it.`,
            });
          }
        }
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
        const placed = insertMapPlacement(current, placement.parent, placement.note, nextGraph);
        if ("refusal" in placed) {
          return yield* new MemoryAmendmentValidationError({ reason: placed.refusal });
        }
        const after = serializeMemoryMap(placed);
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
          reason: "This proposal does not change project memory.",
        });
      }
      return {
        turnId: input.turnId,
        title,
        changes,
        patch: yield* makePatch(changes),
        placements: [...input.amendment.placements],
      } satisfies MemoryAmendmentProposal;
    });

  const applyAmendment: MemoryIndex["Service"]["applyAmendment"] = (input) =>
    Effect.gen(function* () {
      const resolved = yield* sourceStore.getResolvedSource(input.projectId);
      if (Option.isNone(resolved)) {
        return yield* new ConfirmMemoryAmendmentBlockedError({ reason: "not-designated" });
      }
      const source = resolved.value;
      for (const change of input.proposal.changes) {
        const current = yield* readIfExists(path.join(source.rootPath, change.path));
        if (current !== change.before) {
          return yield* new ConfirmMemoryAmendmentBlockedError({ reason: "memory-changed" });
        }
      }
      const absolutePaths: Array<string> = [];
      for (const change of input.proposal.changes) {
        const absolute = path.join(source.rootPath, change.path);
        yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
        yield* fs.writeFileString(absolute, change.after);
        absolutePaths.push(absolute);
      }
      cache.delete(source.rootPath);
      return yield* commitPaths({
        rootPath: source.rootPath,
        absolutePaths,
        message: `${input.proposal.title}\n\nAmended-from-plan: ${input.planName} (${input.planId})`,
        operation: "applyMemoryAmendment",
      });
    });

  return {
    readIndex,
    readNote,
    generateProductMap,
    prepareAmendment,
    applyAmendment,
  } satisfies MemoryIndex["Service"];
});

export const layer = Layer.effect(MemoryIndex, make);
