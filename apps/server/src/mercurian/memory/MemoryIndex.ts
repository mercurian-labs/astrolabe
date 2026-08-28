import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import {
  MemoryNotDesignatedError,
  type MemoryIndex as MemoryIndexValue,
  type MemoryNote,
  MercurianMemoryError,
  type MercurianProjectId,
  ProductMapAlreadyExistsError,
  ProductMapCycleError,
  isProductMapCycleError,
} from "@t3tools/contracts";

import * as ProcessRunner from "../../processRunner.ts";
import * as MemorySourceStore from "./MemorySourceStore.ts";
import {
  buildMemoryGraph,
  compileProductMap,
  fingerprintMemoryFiles,
  parseAndValidateMemoryMap,
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

      const repositoryRoot = yield* gitRoot(source.rootPath);
      if (repositoryRoot === null) return;
      const relative = path.relative(repositoryRoot, productPath);
      const add = yield* runGit(repositoryRoot, ["add", "--", relative]);
      const commit =
        add.code === 0
          ? yield* runGit(repositoryRoot, [
              "commit",
              "--only",
              "-m",
              "Generate product map from containment declarations",
              "--",
              relative,
            ])
          : add;
      if (commit.code !== 0) {
        return yield* new MercurianMemoryError({
          operation: "generateProductMap",
          cause: new Error(commit.stderr || "git commit failed"),
        });
      }
    });

  return { readIndex, readNote, generateProductMap } satisfies MemoryIndex["Service"];
});

export const layer = Layer.effect(MemoryIndex, make);
