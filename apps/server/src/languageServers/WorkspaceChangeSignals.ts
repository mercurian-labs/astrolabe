import type { OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as LanguageServers from "./LanguageServers.ts";
import type { WatchedFileChange } from "./watchedFiles.ts";

/**
 * Astrolabe: until the environment watches workspaces, a checkout's status updates (a window's
 * return refreshes it too) and its agents' file edits and commands each re-read git's status, and
 * the servers hear what was created, changed or deleted since. Ignored files, and changes nothing
 * signals, go unseen.
 */

/** Past this many changed files the checkout isn't followed: too many to read on every signal. */
const MAX_ENTRIES = 5_000;
const STATUS_MAX_BYTES = 4 * 1024 * 1024;

interface Entry {
  /** `new` is not in HEAD (untracked or added); `deleted` is gone from disk. */
  readonly kind: "new" | "modified" | "deleted";
  /** The file's mtime and size, so a file edited again while it stays changed counts. */
  readonly stamp: string | null;
}

type Snapshot = ReadonlyMap<string, Entry>;

/** Events from a thread in the checkout whose tools may have written files. */
function touchesFiles(event: OrchestrationV2DomainEvent, threads: ReadonlySet<string>): boolean {
  return (
    event.type === "turn-item.updated" &&
    threads.has(event.threadId) &&
    event.payload.status === "completed" &&
    (event.payload.type === "file_change" || event.payload.type === "command_execution")
  );
}

/** What changed between two reads; `exists` says whether a file that left the status is there. */
function changesBetween(
  before: Snapshot,
  after: Snapshot,
  exists: (relativePath: string) => boolean,
): Array<WatchedFileChange> {
  const changes: Array<WatchedFileChange> = [];
  const add = (relativePath: string, type: WatchedFileChange["type"]) =>
    changes.push({ relativePath, type });
  for (const [relativePath, now] of after) {
    const was = before.get(relativePath);
    if (was === undefined) {
      add(
        relativePath,
        now.kind === "new" ? "created" : now.kind === "deleted" ? "deleted" : "changed",
      );
    } else if (now.kind === "deleted") {
      if (was.kind !== "deleted") add(relativePath, "deleted");
    } else if (was.kind === "deleted") {
      add(relativePath, "created");
    } else if (now.stamp !== was.stamp) {
      add(relativePath, "changed");
    }
  }
  for (const [relativePath, was] of before) {
    if (after.has(relativePath)) continue;
    // Back to HEAD: restored, reverted or committed (a committed new file changed nothing).
    if (exists(relativePath)) {
      if (was.kind === "deleted") add(relativePath, "created");
      else if (was.kind === "modified") add(relativePath, "changed");
    } else if (was.kind !== "deleted") add(relativePath, "deleted");
  }
  return changes;
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const languageServers = yield* LanguageServers.LanguageServers;
    const statusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
    const threadManagement = yield* ThreadManagement.ThreadManagementService;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sql = yield* SqlClient.SqlClient;

    const runGit = (cwd: string, args: ReadonlyArray<string>) =>
      git.execute({
        operation: "WorkspaceChangeSignals.status",
        cwd,
        args,
        allowNonZeroExit: true,
        maxOutputBytes: STATUS_MAX_BYTES,
      });

    const stampOf = (cwd: string, relativePath: string) =>
      fileSystem.stat(path.join(cwd, relativePath)).pipe(
        Effect.map((info) =>
          info.type === "File"
            ? `${Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() })}:${info.size}`
            : null,
        ),
        Effect.orElseSucceed(() => null),
      );

    /** git's status of the files under `cwd`, by path from `cwd`; null when it can't be read. */
    const snapshot = Effect.fn("WorkspaceChangeSignals.snapshot")(function* (cwd: string) {
      const prefix = yield* runGit(cwd, ["rev-parse", "--show-prefix"]);
      const status = yield* runGit(cwd, [
        "status",
        "--porcelain=2",
        "-z",
        "--untracked-files=all",
        "--no-renames",
        "--",
        ".",
      ]);
      if (prefix.exitCode !== 0 || status.exitCode !== 0 || status.stdoutTruncated) return null;
      const under = prefix.stdout.trim();
      const entries = new Map<string, Entry>();
      for (const record of status.stdout.split("\0")) {
        const fields = record.split(" ");
        // `1 XY sub mH mI mW hH hI path`, `u XY sub m1 m2 m3 mW h1 h2 h3 path`, `? path`.
        const [tag, xy = ""] = fields;
        const file =
          tag === "1"
            ? fields.slice(8).join(" ")
            : tag === "u"
              ? fields.slice(10).join(" ")
              : tag === "?"
                ? record.slice(2)
                : null;
        if (file === null || !file.startsWith(under)) continue;
        const kind =
          xy[0] === "D" || xy[1] === "D"
            ? "deleted"
            : tag === "?" || xy[0] === "A"
              ? "new"
              : "modified";
        entries.set(file.slice(under.length), { kind, stamp: null });
      }
      if (entries.size > MAX_ENTRIES) return null;
      for (const [relativePath, entry] of entries) {
        if (entry.kind === "deleted") continue;
        entries.set(relativePath, { ...entry, stamp: yield* stampOf(cwd, relativePath) });
      }
      return entries;
    });

    const threadsIn = (cwd: string) =>
      sql<{ readonly thread_id: string }>`
        SELECT scope.thread_id
        FROM orchestration_v2_projection_checkpoint_scopes AS scope
        JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = scope.thread_id
        WHERE thread.deleted_at IS NULL AND json_extract(scope.payload_json, '$.cwd') = ${cwd}
      `.pipe(
        Effect.map((rows): ReadonlySet<string> => new Set(rows.map((row) => row.thread_id))),
        Effect.orElseSucceed((): ReadonlySet<string> => new Set()),
      );

    /** Reads the checkout again on each signal, and tells its servers what changed. */
    const follow = Effect.fn("WorkspaceChangeSignals.follow")(function* (cwd: string) {
      let previous = yield* snapshot(cwd).pipe(Effect.orElseSucceed(() => null));
      const threads = yield* Ref.make(yield* threadsIn(cwd));
      // A full refresh (a window's return) comes as a snapshot; only a remote update has no files.
      const statusSignals = statusBroadcaster
        .streamStatus({ cwd, includeRemote: false })
        .pipe(Stream.filter((event) => event._tag !== "remoteUpdated"));
      const turnSignals = threadManagement.streamDomainEvents.pipe(
        Stream.tap((event) =>
          event.type === "checkpoint-scope.created" && event.payload.cwd === cwd
            ? threadsIn(cwd).pipe(Effect.flatMap((ids) => Ref.set(threads, ids)))
            : Effect.void,
        ),
        Stream.filterEffect((event) =>
          Ref.get(threads).pipe(Effect.map((ids) => touchesFiles(event, ids))),
        ),
      );
      yield* Stream.merge(statusSignals, turnSignals).pipe(
        // Signals arriving while the checkout is read collapse into one more read.
        Stream.buffer({ capacity: 1, strategy: "sliding" }),
        Stream.runForEach(() =>
          Effect.gen(function* () {
            const next = yield* snapshot(cwd).pipe(Effect.orElseSucceed(() => null));
            const before = previous;
            previous = next;
            if (before === null || next === null) return;
            const present = new Set<string>();
            for (const relativePath of before.keys()) {
              if (next.has(relativePath)) continue;
              if ((yield* stampOf(cwd, relativePath)) !== null) present.add(relativePath);
            }
            const changes = changesBetween(before, next, (relativePath) =>
              present.has(relativePath),
            );
            if (changes.length > 0) yield* languageServers.filesChanged({ cwd, changes });
          }),
        ),
        Effect.ignore({ log: "Warn", message: "Following a checkout's file changes failed." }),
      );
    });

    // One follower per checkout with a language server, for as long as it has one.
    const followers = new Map<string, Fiber.Fiber<void>>();
    yield* forkParked(
      languageServers.subscribe.pipe(
        Stream.runForEach((list) =>
          Effect.gen(function* () {
            const cwds = new Set(list.map((status) => status.cwd));
            for (const [cwd, fiber] of followers) {
              if (cwds.has(cwd)) continue;
              followers.delete(cwd);
              yield* Fiber.interrupt(fiber);
            }
            for (const cwd of cwds) {
              if (!followers.has(cwd)) followers.set(cwd, yield* Effect.forkScoped(follow(cwd)));
            }
          }),
        ),
      ),
    );
  }),
);
