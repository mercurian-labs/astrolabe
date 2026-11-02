// @effect-diagnostics-next-line nodeBuiltinImport:off - fs.watch is in place on return, before a subscriber's first event.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

import type * as ParcelWatcherModule from "@parcel/watcher";
import type { ProjectWorktreeChange } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as RcMap from "effect/RcMap";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";

// @parcel/watcher's native addon stays external; a single-executable resolves disk modules only
// through require, and a missing addon then fails the subscribe, leaving the worktree unwatched.
const requireForParcelWatcher = NodeModule.createRequire(import.meta.url);
const loadParcelWatcher = () =>
  requireForParcelWatcher("@parcel/watcher") as typeof ParcelWatcherModule;

/**
 * Astrolabe: changes on disk in a worktree, from an agent, a terminal or another editor. The first
 * subscriber starts watching it and the last one leaving stops it. Each report also refreshes the
 * worktree's git status, which reaches every status subscriber.
 */
export class WorkspaceWatcher extends Context.Service<
  WorkspaceWatcher,
  {
    /** Changes from now on. The stream holds the watch open while it runs. */
    readonly changes: (
      root: string,
    ) => Effect.Effect<Stream.Stream<ProjectWorktreeChange>, never, Scope.Scope>;
  }
>()("t3/worktrees/WorkspaceWatcher") {}

/** How long changes gather after the first before they are reported together. */
const SETTLE = "250 millis";
/** A worktree nobody follows stays watched this long, so a quick remount reuses the watch. */
const LINGER = "10 seconds";
/** Past this many changed folders, a report names none and clients read everything again. */
const MAX_NAMED_DIRECTORIES = 200;
/** Git's store and dependency folders change in bulk. A glob skips only what it matches, hence two. */
const ALWAYS_IGNORED = [".git", "**/node_modules", "**/node_modules/**"];
/** Files in a worktree's git directory that move when it commits, checks out, or stages. */
const GIT_STATE_FILES = new Set(["HEAD", "index"]);

export type RawChange =
  | { readonly type: "create" | "update" | "delete"; readonly path: string }
  | { readonly type: "git" }
  | { readonly type: "overflow" };

/**
 * The folders, relative to `root` and `/`-separated, whose listing a batch of changes touched; null
 * when the watcher dropped events or more than `max` folders changed.
 */
export function changedDirectories(
  path: Path.Path,
  root: string,
  changes: ReadonlyArray<RawChange>,
  max = MAX_NAMED_DIRECTORIES,
): ReadonlyArray<string> | null {
  const directories = new Set<string>();
  for (const change of changes) {
    if (change.type === "overflow") return null;
    if (change.type !== "create" && change.type !== "delete") continue;
    const relative = path.relative(root, path.dirname(change.path));
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    directories.add(relative.split(path.sep).join("/"));
    if (directories.size > max) return null;
  }
  return [...directories].toSorted();
}

const unwatchedReason = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /ENOSPC|inotify/i.test(message)
    ? "The system's limit on watched folders is reached (fs.inotify.max_user_watches)."
    : message;
};

interface Watch {
  readonly changes: PubSub.PubSub<ProjectWorktreeChange>;
  /** Why the worktree can't be watched, once that is known. */
  readonly unwatched: Ref.Ref<string | null>;
}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const vcsStatus = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const gitOutput = (root: string, operation: string, args: ReadonlyArray<string>) =>
    git
      .execute({
        operation: `WorkspaceWatcher.${operation}`,
        cwd: root,
        args,
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => (result.exitCode === 0 ? result.stdout : null)),
        Effect.orElseSucceed(() => null),
      );

  /** Folders git ignores, collapsed to the topmost one; a folder ignored later is still watched. */
  const ignoredDirectories = (root: string) =>
    gitOutput(root, "ignored", [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ]).pipe(
      Effect.map((stdout) =>
        (stdout ?? "")
          .split("\0")
          .filter((entry) => entry.endsWith("/"))
          .map((entry) => entry.slice(0, -1)),
      ),
    );

  /** Watches the git directory's own files, which sit outside the worktree for a linked one. */
  const watchGitState = (gitDir: string, onChange: () => void) =>
    Effect.forEach(
      [gitDir, path.join(gitDir, "logs")],
      (directory) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            try {
              return NodeFS.watch(directory, (_event, name) => {
                if (name !== null && GIT_STATE_FILES.has(name)) onChange();
              });
            } catch {
              return null;
            }
          }),
          (watcher) => Effect.sync(() => watcher?.close()),
        ),
      { discard: true },
    );

  const report = Effect.fn("WorkspaceWatcher.report")(function* (
    root: string,
    realRoot: string,
    watch: Watch,
    batch: ReadonlyArray<RawChange>,
  ) {
    const directories = changedDirectories(path, realRoot, batch);
    yield* PubSub.publish(watch.changes, { _tag: "changed", directories });
    yield* vcsStatus
      .refreshLocalStatus(root)
      .pipe(
        Effect.ignore({ log: "Warn", message: "Refreshing a watched worktree's status failed." }),
      );
    if (directories === null || directories.length > 0) yield* workspaceEntries.refresh(root);
  });

  const watchRoot = Effect.fn("WorkspaceWatcher.watchRoot")(function* (root: string) {
    const watch: Watch = {
      changes: yield* Effect.acquireRelease(
        PubSub.unbounded<ProjectWorktreeChange>(),
        PubSub.shutdown,
      ),
      unwatched: yield* Ref.make<string | null>(null),
    };
    const stop = (reason: string) =>
      Ref.set(watch.unwatched, reason).pipe(
        Effect.andThen(PubSub.publish(watch.changes, { _tag: "unwatched", reason })),
      );
    // Events name real paths, so a root reached through a symlink would match none of them.
    const real = yield* fileSystem.realPath(root).pipe(Effect.result);
    if (Result.isFailure(real)) {
      yield* stop(unwatchedReason(real.failure));
      return watch;
    }
    const raw = yield* Effect.acquireRelease(Queue.unbounded<RawChange>(), Queue.shutdown);
    const ignore = [...ALWAYS_IGNORED, ...(yield* ignoredDirectories(root))];
    const subscribed = yield* Effect.tryPromise(() =>
      loadParcelWatcher().subscribe(
        real.success,
        (error, events) => {
          // The watcher reports dropped events as an error; reading everything again recovers.
          if (error) Queue.offerUnsafe(raw, { type: "overflow" });
          else Queue.offerAllUnsafe(raw, events);
        },
        { ignore },
      ),
    ).pipe(Effect.result);
    if (Result.isFailure(subscribed)) {
      yield* stop(unwatchedReason(subscribed.failure.cause));
      return watch;
    }
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => subscribed.success.unsubscribe()).pipe(Effect.ignore),
    );
    const gitDir = yield* gitOutput(root, "gitDir", ["rev-parse", "--absolute-git-dir"]);
    if (gitDir !== null)
      yield* watchGitState(gitDir.trim(), () => Queue.offerUnsafe(raw, { type: "git" }));
    yield* Stream.fromQueue(raw).pipe(
      Stream.groupedWithin(10_000, SETTLE),
      Stream.runForEach((batch) => report(root, real.success, watch, batch)),
      Effect.forkScoped,
    );
    return watch;
  });

  const watches = yield* RcMap.make({ lookup: watchRoot, idleTimeToLive: LINGER });

  const changes: WorkspaceWatcher["Service"]["changes"] = Effect.fn("WorkspaceWatcher.changes")(
    function* (root) {
      const watch = yield* RcMap.get(watches, root);
      const subscription = yield* PubSub.subscribe(watch.changes);
      const reason = yield* Ref.get(watch.unwatched);
      return reason === null
        ? Stream.fromSubscription(subscription)
        : Stream.make({ _tag: "unwatched", reason } as const);
    },
  );

  return WorkspaceWatcher.of({ changes });
});

export const layer = Layer.effect(WorkspaceWatcher, make);
