import {
  parseRootAddress,
  type ProjectId,
  type ProjectRoot,
  type ProjectRootCheckout,
  projectRootKeys,
  ProjectRootsError,
  ProjectRootWriteTargetError,
  type RootKey,
  type SourceControlProviderKind,
  type WorkspaceFolderState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import { isWithinRoot } from "./KnownWorkspaces.ts";
import * as TaskFolderStore from "./TaskFolderStore.ts";
import { projectFolders } from "./WorkspaceFolders.ts";

export interface ProjectRootsThread {
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
}

/** A path inside a root: `path` is relative to it, with `/` separators. */
export interface RootPath {
  readonly root: ProjectRootCheckout;
  readonly path: string;
}

export interface ResolvedRootPath extends RootPath {
  readonly anchor: string | null;
  /** In the thread's checkout of the root; null when the thread leaves the root out. */
  readonly absolutePath: string | null;
}

export class ProjectRoots extends Context.Service<
  ProjectRoots,
  {
    /** The project folder, then its folders, each with the key addresses name it by. */
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<ProjectRoot>, ProjectRootsError>;
    /** Every root with the checkout the thread reads it in, as `WorkspaceFolders.forThread` grants. */
    readonly forThread: (
      thread: ProjectRootsThread,
    ) => Effect.Effect<ReadonlyArray<ProjectRootCheckout>, ProjectRootsError>;
    /** The deepest root holding an absolute path, in either its live checkout or the thread's. */
    readonly locate: (
      input: ProjectRootsThread & { readonly path: string },
    ) => Effect.Effect<RootPath | null, ProjectRootsError>;
    /**
     * An address, an absolute path, or a path relative to `fromRoot` (the project folder when
     * omitted), moved to the deepest root that holds it.
     */
    readonly resolve: (
      input: ProjectRootsThread & { readonly address: string; readonly fromRoot?: RootKey },
    ) => Effect.Effect<ResolvedRootPath, ProjectRootsError>;
    /** `resolve` for each of `addresses`, over one read of the thread's roots, which it returns. */
    readonly resolveAll: (
      input: ProjectRootsThread & { readonly addresses: ReadonlyArray<string> },
    ) => Effect.Effect<
      {
        readonly roots: ReadonlyArray<ProjectRootCheckout>;
        readonly paths: ReadonlyArray<ResolvedRootPath>;
      },
      ProjectRootsError
    >;
    /**
     * Where a new note, base or canvas goes: `repository` or the address's root, then the root of
     * `selectedPath` or `currentFile`, then the only writable root. Fails rather than guess.
     */
    readonly writeTarget: (
      input: ProjectRootsThread & {
        /** A root key, or a root's path. */
        readonly repository?: string;
        readonly address?: string;
        readonly selectedPath?: string;
        readonly currentFile?: string;
      },
    ) => Effect.Effect<
      { readonly root: ProjectRootCheckout; readonly path: string | null },
      ProjectRootsError | ProjectRootWriteTargetError
    >;
    /** The remote a Git folder's pull requests go through, and its host; null when it has none. */
    readonly host: (folder: string) => Effect.Effect<{
      readonly remote: string;
      readonly kind: SourceControlProviderKind;
    } | null>;
  }
>()("t3/workspace/ProjectRoots") {}

const DETECTION_CONCURRENCY = 8;

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const taskFolders = yield* TaskFolderStore.TaskFolderStore;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;

  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));

  // What a sandbox or Git hands back: the nearest real ancestor plus what does not exist yet.
  const realLocation = (target: string): Effect.Effect<string> =>
    fileSystem.realPath(target).pipe(
      Effect.catch(() => {
        const parent = path.dirname(target);
        return parent === target
          ? Effect.succeed(target)
          : Effect.map(realLocation(parent), (real) => path.join(real, path.basename(target)));
      }),
    );

  const stateOf = Effect.fnUntraced(function* (
    folder: string,
  ): Effect.fn.Return<WorkspaceFolderState> {
    if (yield* exists(path.join(folder, ".git"))) return "git";
    return (yield* exists(folder)) ? "plain" : "missing";
  });

  const host: ProjectRoots["Service"]["host"] = (folder) =>
    sourceControl.resolveHandle({ cwd: folder }).pipe(
      Effect.map(({ context }) =>
        context === null || context.provider.kind === "unknown"
          ? null
          : { remote: context.remoteName, kind: context.provider.kind },
      ),
      Effect.orElseSucceed(() => null),
    );

  const list: ProjectRoots["Service"]["list"] = Effect.fn("ProjectRoots.list")(
    function* (projectId) {
      const row = yield* projects
        .get(projectId)
        .pipe(
          Effect.mapError(
            () => new ProjectRootsError({ operation: "list", detail: "Failed to read project." }),
          ),
        );
      if (Option.isNone(row)) {
        return yield* new ProjectRootsError({
          operation: "list",
          detail: `Project ${projectId} was not found.`,
        });
      }
      const project = row.value;
      const folders = yield* projectFolders(project).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      const keys = projectRootKeys(project.workspaceRoot, folders);
      const entries = [
        {
          name: path.basename(project.workspaceRoot) || project.workspaceRoot,
          path: project.workspaceRoot,
          kind: "workspace" as const,
        },
        ...folders.map((folder) => ({
          name: folder.name,
          path: folder.path,
          kind: "tracked" as const,
        })),
      ];
      return yield* Effect.forEach(
        entries,
        Effect.fnUntraced(function* (entry, index) {
          const state = yield* stateOf(entry.path);
          return {
            key: keys[index]!,
            ...entry,
            state,
            hostBacked: state === "git" && (yield* host(entry.path)) !== null,
          };
        }),
        { concurrency: DETECTION_CONCURRENCY },
      );
    },
  );

  const live = (root: ProjectRoot): ProjectRootCheckout =>
    root.state === "missing"
      ? { ...root, checkout: null, writable: false }
      : { ...root, checkout: root.path, writable: true };

  // Mirrors `WorkspaceFolders.forThread`: a task folder's worktrees stand in for the roots it
  // holds and the rest are out of reach; a single worktree stands in for the project folder only.
  const forThread: ProjectRoots["Service"]["forThread"] = Effect.fn("ProjectRoots.forThread")(
    function* (thread) {
      const roots = yield* list(thread.projectId);
      const worktreePath = thread.worktreePath;
      if (worktreePath === null) return roots.map(live);
      const taskFolder = yield* taskFolders
        .findContaining(worktreePath)
        .pipe(
          Effect.mapError(
            (cause) => new ProjectRootsError({ operation: "list", detail: cause.detail }),
          ),
        );
      if (taskFolder === null) {
        return roots.map((root) =>
          root.kind === "workspace"
            ? { ...root, checkout: worktreePath, writable: true }
            : { ...live(root), writable: false },
        );
      }
      const repositories = yield* Effect.forEach(
        taskFolder.repositories,
        (repository) =>
          realLocation(repository.repositoryPath).pipe(
            Effect.map((real) => ({ ...repository, real })),
          ),
        { concurrency: DETECTION_CONCURRENCY },
      );
      return yield* Effect.forEach(
        roots,
        Effect.fnUntraced(function* (root): Effect.fn.Return<ProjectRootCheckout> {
          if (root.kind === "workspace") {
            return { ...root, checkout: taskFolder.projectPath, writable: true };
          }
          const real = yield* realLocation(root.path);
          const repository = repositories.find(
            (candidate) => candidate.repositoryPath === root.path || candidate.real === real,
          );
          return repository === undefined
            ? { ...root, checkout: null, writable: false }
            : { ...root, checkout: repository.worktreePath, writable: true };
        }),
        { concurrency: DETECTION_CONCURRENCY },
      );
    },
  );

  const depth = (relative: string) => (relative === "" ? 0 : relative.split(path.sep).length);

  const locateIn = Effect.fnUntraced(function* (
    roots: ReadonlyArray<ProjectRootCheckout>,
    target: string,
  ): Effect.fn.Return<RootPath | null> {
    if (!path.isAbsolute(target)) return null;
    const named = path.resolve(target);
    const spellings = [...new Set([named, yield* realLocation(named)])];
    const bases = yield* Effect.forEach(
      roots,
      (root) =>
        Effect.forEach(root.checkout === null ? [root.path] : [root.path, root.checkout], (base) =>
          realLocation(base).pipe(Effect.map((real) => [base, real])),
        ).pipe(Effect.map((found) => ({ root, bases: [...new Set(found.flat())] }))),
      { concurrency: DETECTION_CONCURRENCY },
    );
    let best: { readonly root: ProjectRootCheckout; readonly relative: string } | null = null;
    for (const { root, bases: rootBases } of bases) {
      for (const base of rootBases) {
        for (const spelling of spellings) {
          if (!isWithinRoot(path, spelling, base)) continue;
          const relative = path.relative(base, spelling);
          if (best === null || depth(relative) < depth(best.relative)) best = { root, relative };
        }
      }
    }
    return best === null
      ? null
      : { root: best.root, path: best.relative.split(path.sep).join("/") };
  });

  const locate: ProjectRoots["Service"]["locate"] = Effect.fn("ProjectRoots.locate")(
    function* (input) {
      return yield* locateIn(yield* forThread(input), input.path);
    },
  );

  const resolveIn = Effect.fnUntraced(function* (
    roots: ReadonlyArray<ProjectRootCheckout>,
    address: string,
    fromRoot: RootKey | undefined,
  ): Effect.fn.Return<ResolvedRootPath, ProjectRootsError> {
    const fail = (detail: string) => new ProjectRootsError({ operation: "resolve", detail });
    const parsed = parseRootAddress(
      address,
      roots.map((root) => root.key),
    );
    let found: RootPath | null;
    if (parsed.root === null && path.isAbsolute(parsed.path)) {
      found = yield* locateIn(roots, parsed.path);
      if (found === null) return yield* fail(`${parsed.path} is in none of the project's folders.`);
    } else {
      const key = parsed.root ?? fromRoot ?? roots[0]?.key;
      const root = roots.find((candidate) => candidate.key === key);
      if (root === undefined) return yield* fail(`The project has no folder named ${key}.`);
      const base = root.checkout ?? root.path;
      const target = path.resolve(base, parsed.path);
      if (!isWithinRoot(path, target, base)) {
        return yield* fail(`${address} leads outside ${root.key}.`);
      }
      found = (yield* locateIn(roots, target)) ?? {
        root,
        path: path.relative(base, target).split(path.sep).join("/"),
      };
    }
    return {
      ...found,
      anchor: parsed.anchor,
      absolutePath:
        found.root.checkout === null ? null : path.join(found.root.checkout, found.path),
    };
  });

  const resolve: ProjectRoots["Service"]["resolve"] = Effect.fn("ProjectRoots.resolve")(
    function* (input) {
      return yield* resolveIn(yield* forThread(input), input.address, input.fromRoot);
    },
  );

  const resolveAll: ProjectRoots["Service"]["resolveAll"] = Effect.fn("ProjectRoots.resolveAll")(
    function* (input) {
      const roots = yield* forThread(input);
      const paths = yield* Effect.forEach(input.addresses, (address) =>
        resolveIn(roots, address, undefined),
      );
      return { roots, paths };
    },
  );

  const writeTarget: ProjectRoots["Service"]["writeTarget"] = Effect.fn("ProjectRoots.writeTarget")(
    function* (input) {
      const roots = yield* forThread(input);
      const candidates = roots.filter((root) => root.writable).map((root) => root.key);
      const fail = (detail: string) => new ProjectRootWriteTargetError({ detail, candidates });
      const address =
        input.address === undefined
          ? null
          : parseRootAddress(
              input.address,
              roots.map((root) => root.key),
            );
      const pick = (root: ProjectRootCheckout) =>
        root.writable
          ? Effect.succeed({ root, path: address?.path ?? null })
          : Effect.fail(fail(`This thread cannot write ${root.key}.`));

      const prefixed = roots.find((root) => root.key === address?.root);
      const named =
        input.repository === undefined
          ? undefined
          : roots.find(
              (root) =>
                root.key === input.repository ||
                root.path === input.repository ||
                root.checkout === input.repository,
            );
      if (input.repository !== undefined && named === undefined) {
        return yield* fail(`The project has no folder ${input.repository}.`);
      }
      if (prefixed !== undefined && named !== undefined && prefixed.key !== named.key) {
        return yield* fail(`${input.address} is not in ${named.key}.`);
      }
      const explicit = prefixed ?? named;
      if (explicit !== undefined) return yield* pick(explicit);

      for (const context of [input.selectedPath, input.currentFile]) {
        if (context === undefined) continue;
        const found = yield* resolveIn(roots, context, undefined).pipe(Effect.option);
        if (Option.isSome(found)) return yield* pick(found.value.root);
      }

      const writable = roots.filter((root) => root.writable);
      if (writable.length === 1) return yield* pick(writable[0]!);
      return yield* fail(
        writable.length === 0
          ? "This thread can write none of the project's folders."
          : "Choose which folder the new file goes in.",
      );
    },
  );

  return ProjectRoots.of({ list, forThread, locate, resolve, resolveAll, writeTarget, host });
});

export const layer = Layer.effect(ProjectRoots, make);
