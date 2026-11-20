import {
  CheckpointRef,
  GitClientError,
  type GitClientCommit,
  type GitClientCommitInput,
  type GitClientCommitResult,
  type GitClientCwdInput,
  type GitClientFile,
  type GitClientLogInput,
  type GitClientLogResult,
  type GitClientMessageResult,
  type GitClientOperation,
  type GitClientPathsInput,
  type GitClientStatus,
  type RunId,
  type VcsPullResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import {
  LOG_FIELD,
  parseLog,
  parseNumstatZ,
  parsePorcelainV2,
  parseReflogMadeAt,
  type StatusEntry,
} from "./gitClientParse.ts";
import * as GitClientTurns from "./gitClientTurns.ts";
import * as GitManager from "./GitManager.ts";
import * as GitWorkflow from "./GitWorkflowService.ts";

/**
 * Astrolabe: the Git tab's git client for one checkout. Its changes go through the real index, so
 * the agent and a terminal see the same state; the last few can be undone, and nothing it changes
 * runs while an agent is working in the checkout.
 */
export class GitClientService extends Context.Service<
  GitClientService,
  {
    readonly status: (input: GitClientCwdInput) => Effect.Effect<GitClientStatus, GitClientError>;
    readonly log: (input: GitClientLogInput) => Effect.Effect<GitClientLogResult, GitClientError>;
    readonly stage: (input: GitClientPathsInput) => Effect.Effect<void, GitClientError>;
    readonly unstage: (input: GitClientPathsInput) => Effect.Effect<void, GitClientError>;
    /** Restores tracked files and removes untracked ones, keeping a snapshot to undo from. */
    readonly discard: (
      input: GitClientPathsInput,
    ) => Effect.Effect<GitClientMessageResult, GitClientError>;
    /** Commits what is staged; with nothing staged, every change. Generates an empty message. */
    readonly commit: (
      input: GitClientCommitInput,
    ) => Effect.Effect<GitClientCommitResult, GitClientError>;
    readonly generateCommitMessage: (
      input: GitClientCwdInput,
    ) => Effect.Effect<GitClientMessageResult, GitClientError>;
    /** Takes back the last stage, unstage, discard or commit made here, while nothing moved since. */
    readonly undo: (
      input: GitClientCwdInput,
    ) => Effect.Effect<GitClientMessageResult, GitClientError>;
    readonly fetch: (input: GitClientCwdInput) => Effect.Effect<void, GitClientError>;
    readonly pull: (input: GitClientCwdInput) => Effect.Effect<VcsPullResult, GitClientError>;
  }
>()("t3/git/GitClientService") {}

export const UNDO_REF_PREFIX = "refs/astrolabe/git-undo/";
const MAX_OUTPUT_BYTES = 16_000_000;
const COMMIT_TIMEOUT_MS = 10 * 60_000;
const UNDO_DEPTH = 20;
/** Untracked files counted line by line; past this many, or this size, they show no counts. */
const COUNTED_UNTRACKED_FILES = 200;
const COUNTED_UNTRACKED_BYTES = 1_000_000;
const REFLOG_ENTRIES = 2_000;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

type UndoEntry =
  | {
      readonly kind: "stage" | "unstage";
      readonly paths: ReadonlyArray<string>;
      readonly before: string;
      readonly after: string;
    }
  | {
      readonly kind: "discard";
      readonly paths: ReadonlyArray<string>;
      readonly ref: string;
      readonly head: string | null;
      readonly indexBefore: string;
    }
  | {
      readonly kind: "commit";
      readonly sha: string;
      readonly parent: string;
      readonly subject: string;
      /** Set when the commit staged every change itself: undo unstages them again. */
      readonly stagedPaths: ReadonlyArray<string> | null;
    };

const fail = (message: string) => new GitClientError({ message });
const files = (count: number) => (count === 1 ? "1 file" : `${count} files`);

/** The first lines of git's complaint, bounded, for a person to read. */
const gitSaid = (stderr: string) => {
  const said = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("hint:"))
    .slice(0, 4)
    .join(" ");
  return said.length > 400 ? `${said.slice(0, 399)}…` : said;
};

/** "Codex CLI command failed" of a text generation error that goes on to quote the whole prompt. */
const generationFailure = (message: string) => {
  const reason = message.replace(/^Text generation failed in \w+: /, "").split(/: |\n/, 1)[0]!;
  return reason.length > 100 ? `${reason.slice(0, 99)}…` : reason;
};

const undoLabel = (entry: UndoEntry) => {
  switch (entry.kind) {
    case "stage":
      return `staging ${files(entry.paths.length)}`;
    case "unstage":
      return `unstaging ${files(entry.paths.length)}`;
    case "discard":
      return `discarding ${files(entry.paths.length)}`;
    case "commit":
      return `commit “${entry.subject}”`;
  }
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitManager = yield* GitManager.GitManager;
  const gitWorkflow = yield* GitWorkflow.GitWorkflowService;
  const checkpoints = yield* CheckpointStore.CheckpointStore;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const statusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;

  const operationIn = Effect.fn("GitClientService.operationIn")(function* (gitDir: string) {
    const has = (name: string) =>
      fileSystem.exists(path.join(gitDir, name)).pipe(Effect.orElseSucceed(() => false));
    if ((yield* has("rebase-merge")) || (yield* has("rebase-apply"))) return "rebase" as const;
    if (yield* has("MERGE_HEAD")) return "merge" as const;
    if (yield* has("CHERRY_PICK_HEAD")) return "cherry-pick" as const;
    if (yield* has("REVERT_HEAD")) return "revert" as const;
    return null;
  });

  const undoStacks = new Map<string, UndoEntry[]>();
  const locks = new Map<string, Semaphore.Semaphore>();
  const lockOf = (cwd: string) => {
    const existing = locks.get(cwd);
    if (existing) return existing;
    const created = Semaphore.makeUnsafe(1);
    locks.set(cwd, created);
    return created;
  };

  const run = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: { readonly stdin?: string; readonly timeoutMs?: number },
  ) =>
    git
      .execute({
        operation: `GitClientService.${operation}`,
        cwd,
        args: ["--literal-pathspecs", ...args],
        allowNonZeroExit: true,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        ...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
        ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      })
      .pipe(Effect.mapError((cause) => new GitClientError({ message: cause.message })));

  /** Runs git and fails with `what` and git's own words when it exits non-zero. */
  const runOk = Effect.fn("GitClientService.runOk")(function* (
    what: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options?: { readonly stdin?: string; readonly timeoutMs?: number },
  ) {
    const result = yield* run(what.replaceAll(" ", "-"), cwd, args, options);
    if (result.exitCode !== 0) {
      const said = gitSaid(result.stderr || result.stdout);
      return yield* fail(said.length > 0 ? `${what}: ${said}` : `${what}.`);
    }
    return result.stdout;
  });

  const canonical = (value: string) => {
    const resolved = path.resolve(value);
    return fileSystem.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved));
  };

  /** As ReviewService does: inside the configured workspace root or a known workspace. */
  const boundCwd = Effect.fn("GitClientService.boundCwd")(function* (cwd: string) {
    const [candidate, root] = yield* Effect.all([canonical(cwd), canonical(config.cwd)]);
    if (
      KnownWorkspaces.isWithinRoot(path, candidate, root) ||
      (yield* knownWorkspaces.contains(candidate))
    ) {
      return candidate;
    }
    return yield* fail(`'${cwd}' is not a project, a managed worktree, or a thread's worktree.`);
  });

  const sqlFailure = (cause: unknown) =>
    new GitClientError({
      message: `Could not read this checkout's turns: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    });
  const withSql = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
    effect.pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.mapError(sqlFailure));

  const workingTurn = Effect.fn("GitClientService.workingTurn")(function* (cwd: string) {
    const threads = yield* withSql(GitClientTurns.checkoutThreads(cwd));
    const runId = yield* withSql(GitClientTurns.workingRunId(threads.threadIds));
    if (runId === null) return { threads, running: null };
    const turns = yield* withSql(GitClientTurns.describeTurns([runId]));
    return { threads, running: turns.get(runId) ?? null };
  });

  /** Refuses while a turn is working in the checkout: its agent may be mid-edit or mid-commit. */
  const assertIdle = Effect.fn("GitClientService.assertIdle")(function* (cwd: string) {
    const { running } = yield* workingTurn(cwd);
    if (running === null) return;
    return yield* new GitClientError({
      message: `An agent is working in this checkout (“${running.threadTitle}”, turn ${running.turnNumber}). Try again when its turn ends.`,
      runningThreadId: running.threadId,
    });
  });

  const refreshVcsStatus = (cwd: string) =>
    statusBroadcaster
      .refreshStatus(cwd, { localOnly: true })
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  /**
   * A mutation of the checkout: bound, serialized per checkout, refused while a turn works, and
   * followed by a status refresh for everything else that watches it.
   */
  const mutation = Effect.fn("GitClientService.mutation")(function* <A>(
    cwd: string,
    body: (canonicalCwd: string) => Effect.Effect<A, GitClientError>,
  ) {
    const canonicalCwd = yield* boundCwd(cwd);
    return yield* lockOf(canonicalCwd).withPermit(
      Effect.gen(function* () {
        yield* assertIdle(cwd);
        return yield* body(canonicalCwd);
      }).pipe(Effect.ensuring(refreshVcsStatus(cwd))),
    );
  });

  /** An entry falling off the stack can no longer be undone, so its kept copy goes too. */
  const pushUndo = Effect.fn("GitClientService.pushUndo")(function* (
    cwd: string,
    entry: UndoEntry,
  ) {
    const stack = undoStacks.get(cwd) ?? [];
    stack.push(entry);
    undoStacks.set(cwd, stack);
    const dropped = stack.length > UNDO_DEPTH ? stack.shift() : undefined;
    if (dropped?.kind === "discard") {
      yield* run("forgetKeptCopy", cwd, ["update-ref", "-d", dropped.ref]);
    }
  });

  const readStatus = Effect.fn("GitClientService.readStatus")(function* (cwd: string) {
    const [status, gitDir] = yield* Effect.all(
      [
        run("status", cwd, ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"]),
        run("gitDir", cwd, ["rev-parse", "--absolute-git-dir"]),
      ],
      { concurrency: "unbounded" },
    );
    if (status.exitCode !== 0 || gitDir.exitCode !== 0) return null;
    return { parsed: parsePorcelainV2(status.stdout), gitDir: gitDir.stdout.trim() };
  });

  const countLines = Effect.fn("GitClientService.countLines")(function* (absolute: string) {
    const stat = yield* fileSystem.stat(absolute);
    if (stat.type !== "File" || Number(stat.size) > COUNTED_UNTRACKED_BYTES) return null;
    const bytes = yield* fileSystem.readFile(absolute);
    if (bytes.includes(0)) return null;
    if (bytes.length === 0) return 0;
    let lines = 0;
    for (const byte of bytes) if (byte === 10) lines += 1;
    return bytes[bytes.length - 1] === 10 ? lines : lines + 1;
  });

  const counts = Effect.fn("GitClientService.counts")(function* (
    cwd: string,
    head: string | null,
    entries: ReadonlyArray<StatusEntry>,
  ) {
    const byPath = new Map<string, { additions: number | null; deletions: number | null }>();
    // Plumbing, so the index is not rewritten; -M pairs a staged rename with its source.
    const numstat = yield* run("numstat", cwd, [
      "diff-index",
      "-M",
      "--numstat",
      "-z",
      head ?? EMPTY_TREE,
      "--",
    ]);
    if (numstat.exitCode === 0) {
      for (const entry of parseNumstatZ(numstat.stdout)) byPath.set(entry.path, entry);
    }
    const untracked = entries.filter((entry) => entry.untracked).slice(0, COUNTED_UNTRACKED_FILES);
    const lines = yield* Effect.forEach(
      untracked,
      (entry) =>
        countLines(path.join(cwd, entry.path)).pipe(
          Effect.orElseSucceed(() => null),
          Effect.map((count) => [entry.path, count] as const),
        ),
      { concurrency: 8 },
    );
    for (const [file, count] of lines) byPath.set(file, { additions: count, deletions: 0 });
    return byPath;
  });

  const status: GitClientService["Service"]["status"] = Effect.fn("GitClientService.status")(
    function* (input) {
      const cwd = yield* boundCwd(input.cwd);
      const read = yield* readStatus(input.cwd);
      const stack = undoStacks.get(cwd);
      const undo = stack?.length ? undoLabel(stack.at(-1)!) : null;
      if (read === null) {
        return {
          cwd: input.cwd,
          isRepository: false,
          branch: null,
          head: null,
          upstream: null,
          ahead: 0,
          behind: 0,
          operation: null,
          files: [],
          turns: [],
          running: null,
          undo: null,
        };
      }
      const { parsed, gitDir } = read;
      const paths = parsed.entries.map((entry) => entry.path);
      const [lineCounts, operation, working] = yield* Effect.all(
        [
          counts(input.cwd, parsed.head, parsed.entries),
          operationIn(gitDir),
          workingTurn(input.cwd),
        ],
        { concurrency: "unbounded" },
      );
      const attribution = yield* withSql(GitClientTurns.fileTurns(working.threads.scopeIds, paths));
      const turns = yield* withSql(GitClientTurns.describeTurns(attribution.order));
      const changed: GitClientFile[] = parsed.entries.map((entry) => {
        const count = lineCounts.get(entry.path);
        const turn = attribution.byPath.get(entry.path);
        return {
          ...entry,
          additions: count?.additions ?? null,
          deletions: count?.deletions ?? null,
          turnRunId: turn !== undefined && turns.has(turn.runId) ? turn.runId : null,
          earlierTurns: turn?.earlier ?? 0,
        };
      });
      return {
        cwd: input.cwd,
        isRepository: true,
        branch: parsed.branch,
        head: parsed.head,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        operation: operation satisfies GitClientOperation | null,
        files: changed,
        turns: attribution.order.flatMap((runId) => turns.get(runId) ?? []),
        running: working.running,
        undo,
      };
    },
  );

  const log: GitClientService["Service"]["log"] = Effect.fn("GitClientService.log")(
    function* (input) {
      yield* boundCwd(input.cwd);
      const limit = Math.min(input.limit, 200);
      const skip = input.skip ?? 0;
      const listed = yield* run("log", input.cwd, [
        "log",
        "-z",
        `--max-count=${limit + 1}`,
        `--skip=${skip}`,
        `--format=%H${LOG_FIELD}%an${LOG_FIELD}%aI${LOG_FIELD}%s${LOG_FIELD}%b`,
        "HEAD",
        "--",
      ]);
      // An unborn branch has no history yet.
      if (listed.exitCode !== 0) return { commits: [], hasMore: false };
      const entries = parseLog(listed.stdout);
      const page = entries.slice(0, limit);
      if (page.length === 0) return { commits: [], hasMore: false };

      const window = `--max-count=${skip + limit}`;
      const unpushedOfUpstream = yield* run("unpushed", input.cwd, [
        "rev-list",
        window,
        "HEAD",
        "--not",
        "@{upstream}",
        "--",
      ]);
      const unpushed =
        unpushedOfUpstream.exitCode === 0
          ? unpushedOfUpstream
          : yield* run("unpushed", input.cwd, [
              "rev-list",
              window,
              "HEAD",
              "--not",
              "--remotes",
              "--",
            ]);
      const notPushed = new Set(unpushed.exitCode === 0 ? unpushed.stdout.split("\n") : []);

      const reflog = yield* run("reflog", input.cwd, [
        "log",
        "--walk-reflogs",
        "--date=unix",
        `--max-count=${REFLOG_ENTRIES}`,
        `--format=%H${LOG_FIELD}%gd${LOG_FIELD}%gs`,
        "HEAD",
        "--",
      ]);
      const madeAt = reflog.exitCode === 0 ? parseReflogMadeAt(reflog.stdout) : new Map();
      const pageTimes = page.flatMap((entry) => {
        const time = madeAt.get(entry.sha);
        return time === undefined ? [] : [time];
      });
      const commitTurns = new Map<string, RunId>();
      if (pageTimes.length > 0) {
        const { threadIds } = yield* withSql(GitClientTurns.checkoutThreads(input.cwd));
        const windows = yield* withSql(
          GitClientTurns.runWindows(threadIds, Math.min(...pageTimes)),
        );
        const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
        // A heuristic: a commit made in this checkout while a turn here was working is credited
        // to that turn (the latest-started one when several were). It may have been the person's.
        for (const entry of page) {
          const time = madeAt.get(entry.sha);
          if (time === undefined) continue;
          const during = windows.findLast(
            (window) => window.start <= time && time <= (window.end ?? now),
          );
          if (during) commitTurns.set(entry.sha, during.runId);
        }
      }
      const turns = yield* withSql(GitClientTurns.describeTurns([...commitTurns.values()]));
      const commits = page.map((entry): GitClientCommit => ({
        ...entry,
        pushed: !notPushed.has(entry.sha),
        turn: turns.get(commitTurns.get(entry.sha)!) ?? null,
      }));
      return { commits, hasMore: entries.length > limit };
    },
  );

  const indexEntries = (cwd: string, paths: ReadonlyArray<string>) =>
    runOk("Could not read the index", cwd, ["ls-files", "--stage", "-z", "--", ...paths]);

  /** Puts these paths' index entries back as `entries` (from `ls-files --stage -z`) had them. */
  const writeIndexEntries = (cwd: string, paths: ReadonlyArray<string>, entries: string) => {
    const removals = paths.map((file) => `0 ${"0".repeat(40)}\t${file}\0`).join("");
    return runOk("Could not restore the index", cwd, ["update-index", "-z", "--index-info"], {
      stdin: removals + entries,
    });
  };

  const assertRelative = (paths: ReadonlyArray<string>) =>
    paths.some((file) => path.isAbsolute(file) || file.split(/[\\/]/).includes(".."))
      ? Effect.fail(fail("Paths must stay inside the checkout."))
      : Effect.void;

  const stage: GitClientService["Service"]["stage"] = Effect.fn("GitClientService.stage")(
    function* (input) {
      yield* assertRelative(input.paths);
      yield* mutation(input.cwd, (cwd) =>
        Effect.gen(function* () {
          const before = yield* indexEntries(input.cwd, input.paths);
          yield* runOk("Could not stage", input.cwd, ["add", "-A", "--", ...input.paths]);
          const after = yield* indexEntries(input.cwd, input.paths);
          yield* pushUndo(cwd, { kind: "stage", paths: input.paths, before, after });
        }),
      );
    },
  );

  const unstage: GitClientService["Service"]["unstage"] = Effect.fn("GitClientService.unstage")(
    function* (input) {
      yield* assertRelative(input.paths);
      yield* mutation(input.cwd, (cwd) =>
        Effect.gen(function* () {
          const before = yield* indexEntries(input.cwd, input.paths);
          const head = yield* run("head", input.cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
          yield* head.exitCode === 0
            ? runOk("Could not unstage", input.cwd, ["restore", "--staged", "--", ...input.paths])
            : runOk("Could not unstage", input.cwd, [
                "rm",
                "--cached",
                "-r",
                "--quiet",
                "--ignore-unmatch",
                "--",
                ...input.paths,
              ]);
          const after = yield* indexEntries(input.cwd, input.paths);
          yield* pushUndo(cwd, { kind: "unstage", paths: input.paths, before, after });
        }),
      );
    },
  );

  const discard: GitClientService["Service"]["discard"] = Effect.fn("GitClientService.discard")(
    function* (input) {
      yield* assertRelative(input.paths);
      return yield* mutation(input.cwd, (cwd) =>
        Effect.gen(function* () {
          const read = yield* readStatus(input.cwd);
          if (read === null) return yield* fail("This folder is not a Git repository.");
          const wanted = new Set(input.paths);
          const selected = read.parsed.entries.filter((entry) => wanted.has(entry.path));
          if (selected.length === 0) return yield* fail("Those files have no changes to discard.");
          const tracked = selected
            .filter((entry) => !entry.untracked)
            .flatMap((entry) =>
              entry.originalPath === null ? [entry.path] : [entry.path, entry.originalPath],
            );
          const untracked = selected.filter((entry) => entry.untracked).map((entry) => entry.path);
          const paths = [...tracked, ...untracked];

          const ref = `${UNDO_REF_PREFIX}${yield* random.uuidV4()}`;
          yield* checkpoints
            .captureCheckpoint({ cwd: input.cwd, checkpointRef: CheckpointRef.make(ref) })
            .pipe(
              Effect.mapError((cause) =>
                fail(
                  `Could not keep a copy to undo from, so nothing was discarded: ${cause.message}`,
                ),
              ),
            );
          const indexBefore = yield* indexEntries(input.cwd, paths);

          if (tracked.length > 0) {
            yield* read.parsed.head === null
              ? runOk("Could not discard", input.cwd, [
                  "rm",
                  "--cached",
                  "-r",
                  "--quiet",
                  "--ignore-unmatch",
                  "--",
                  ...tracked,
                ]).pipe(
                  Effect.andThen(
                    Effect.forEach(tracked, (file) =>
                      fileSystem
                        .remove(path.join(input.cwd, file), { force: true })
                        .pipe(Effect.orElseSucceed(() => undefined)),
                    ),
                  ),
                )
              : runOk("Could not discard", input.cwd, [
                  "restore",
                  "--source=HEAD",
                  "--staged",
                  "--worktree",
                  "--",
                  ...tracked,
                ]);
          }
          if (untracked.length > 0) {
            yield* runOk("Could not remove untracked files", input.cwd, [
              "clean",
              "-f",
              "-q",
              "--",
              ...untracked,
            ]);
          }
          yield* pushUndo(cwd, {
            kind: "discard",
            paths,
            ref,
            head: read.parsed.head,
            indexBefore,
          });
          return { message: `Discarded ${files(selected.length)}` };
        }),
      );
    },
  );

  const generate = Effect.fn("GitClientService.generate")(function* (cwd: string) {
    const staged = yield* stagedPaths(cwd);
    const branch = yield* run("branch", cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const suggestion = yield* gitManager
      .suggestCommitMessage({
        cwd,
        branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
        // Partly staged files are described whole; the commit takes only what is staged.
        ...(staged.length > 0 ? { filePaths: staged } : {}),
      })
      .pipe(
        // The cause carries the whole prompt and the provider's log: say why in a line.
        Effect.mapError((cause) =>
          fail(
            `No commit message could be written (${generationFailure(cause.message)}). Write one yourself, or change the text generation model in Settings.`,
          ),
        ),
      );
    if (suggestion === null) return yield* fail("There is nothing to commit.");
    const body = suggestion.body.trim();
    return body.length > 0 ? `${suggestion.subject}\n\n${body}` : suggestion.subject;
  });

  const stagedPaths = Effect.fn("GitClientService.stagedPaths")(function* (cwd: string) {
    const listed = yield* runOk("Could not read what is staged", cwd, [
      "diff",
      "--cached",
      "--name-only",
      "--no-renames",
      "-z",
    ]);
    return listed.split("\0").filter((file) => file.length > 0);
  });

  const generateCommitMessage: GitClientService["Service"]["generateCommitMessage"] = Effect.fn(
    "GitClientService.generateCommitMessage",
  )(function* (input) {
    yield* boundCwd(input.cwd);
    return { message: yield* generate(input.cwd) };
  });

  const commit: GitClientService["Service"]["commit"] = Effect.fn("GitClientService.commit")(
    function* (input) {
      return yield* mutation(input.cwd, (cwd) =>
        Effect.gen(function* () {
          const staged = yield* stagedPaths(input.cwd);
          const written = input.message?.trim() ?? "";
          const message = written.length > 0 ? written : yield* generate(input.cwd);
          let stagedHere: ReadonlyArray<string> | null = null;
          if (staged.length === 0) {
            yield* runOk("Could not stage the changes", input.cwd, ["add", "-A"]);
            stagedHere = yield* stagedPaths(input.cwd);
            if (stagedHere.length === 0) return yield* fail("There is nothing to commit.");
          }
          const committed = yield* run(
            "commit",
            input.cwd,
            ["commit", "--file=-", "--cleanup=whitespace"],
            { stdin: `${message}\n`, timeoutMs: COMMIT_TIMEOUT_MS },
          );
          if (committed.exitCode !== 0) {
            if (stagedHere !== null) {
              yield* run("unstageAfterFailure", input.cwd, [
                "reset",
                "--quiet",
                "--",
                ...stagedHere,
              ]);
            }
            const said = gitSaid(committed.stderr || committed.stdout);
            return yield* fail(
              said.length > 0 ? `The commit failed: ${said}` : "The commit failed.",
            );
          }
          const sha = (yield* runOk("Could not read the commit", input.cwd, [
            "rev-parse",
            "HEAD",
          ])).trim();
          const subject = message.split("\n")[0]!.trim();
          const parent = yield* run("parent", input.cwd, [
            "rev-parse",
            "--verify",
            "--quiet",
            `${sha}^`,
          ]);
          if (parent.exitCode === 0) {
            yield* pushUndo(cwd, {
              kind: "commit",
              sha,
              parent: parent.stdout.trim(),
              subject,
              stagedPaths: stagedHere,
            });
          }
          return { sha, subject };
        }),
      );
    },
  );

  /** Clears the stack when its top is stale: everything below it is older still. */
  const refuse = (cwd: string, message: string) =>
    Effect.sync(() => undoStacks.delete(cwd)).pipe(Effect.andThen(Effect.fail(fail(message))));

  const undo: GitClientService["Service"]["undo"] = Effect.fn("GitClientService.undo")(
    function* (input) {
      return yield* mutation(input.cwd, (cwd) =>
        Effect.gen(function* () {
          const entry = undoStacks.get(cwd)?.at(-1);
          if (entry === undefined) return yield* fail("There is nothing to undo here.");
          switch (entry.kind) {
            case "stage":
            case "unstage": {
              const now = yield* indexEntries(input.cwd, entry.paths);
              if (now !== entry.after) {
                return yield* refuse(
                  cwd,
                  `Those files' staged changes moved on since, so ${undoLabel(entry)} can't be undone.`,
                );
              }
              yield* writeIndexEntries(input.cwd, entry.paths, entry.before);
              break;
            }
            case "discard": {
              const head = yield* run("head", input.cwd, [
                "rev-parse",
                "--verify",
                "--quiet",
                "HEAD",
              ]);
              const headNow = head.exitCode === 0 ? head.stdout.trim() : null;
              const changed = yield* runOk("Could not read the checkout", input.cwd, [
                "status",
                "--porcelain=v2",
                "--untracked-files=all",
                "-z",
                "--",
                ...entry.paths,
              ]);
              if (headNow !== entry.head || changed.length > 0) {
                return yield* refuse(
                  cwd,
                  `Those files changed since they were discarded, so the discard can't be undone here. A copy is kept at ${entry.ref}.`,
                );
              }
              const kept = (yield* runOk("Could not read the kept copy", input.cwd, [
                "ls-tree",
                "-r",
                "-z",
                "--name-only",
                entry.ref,
                "--",
                ...entry.paths,
              ]))
                .split("\0")
                .filter((file) => file.length > 0);
              if (kept.length > 0) {
                yield* runOk("Could not restore the discarded files", input.cwd, [
                  "restore",
                  `--source=${entry.ref}`,
                  "--worktree",
                  "--",
                  ...kept,
                ]);
              }
              // A path the copy lacks was deleted before the discard brought it back.
              const keptSet = new Set(kept);
              yield* Effect.forEach(
                entry.paths.filter((file) => !keptSet.has(file)),
                (file) =>
                  fileSystem
                    .remove(path.join(input.cwd, file), { force: true })
                    .pipe(Effect.orElseSucceed(() => undefined)),
              );
              yield* writeIndexEntries(input.cwd, entry.paths, entry.indexBefore);
              yield* run("forgetKeptCopy", input.cwd, ["update-ref", "-d", entry.ref]);
              break;
            }
            case "commit": {
              const head = yield* run("head", input.cwd, [
                "rev-parse",
                "--verify",
                "--quiet",
                "HEAD",
              ]);
              if (head.exitCode !== 0 || head.stdout.trim() !== entry.sha) {
                return yield* refuse(
                  cwd,
                  `The branch moved on since “${entry.subject}”, so that commit can't be undone here.`,
                );
              }
              const remote = yield* runOk("Could not check the remotes", input.cwd, [
                "for-each-ref",
                "--count=1",
                "--format=%(refname)",
                "--contains",
                entry.sha,
                "refs/remotes",
              ]);
              if (remote.trim().length > 0) {
                return yield* refuse(
                  cwd,
                  `“${entry.subject}” is already pushed, so it can't be undone here.`,
                );
              }
              yield* runOk("Could not undo the commit", input.cwd, [
                "reset",
                "--soft",
                "--quiet",
                entry.parent,
              ]);
              if (entry.stagedPaths !== null && entry.stagedPaths.length > 0) {
                yield* runOk("Could not unstage the commit's files", input.cwd, [
                  "reset",
                  "--quiet",
                  "--",
                  ...entry.stagedPaths,
                ]);
              }
              break;
            }
          }
          undoStacks.get(cwd)?.pop();
          return { message: `Undid ${undoLabel(entry)}` };
        }),
      );
    },
  );

  const fetch: GitClientService["Service"]["fetch"] = Effect.fn("GitClientService.fetch")(
    function* (input) {
      yield* boundCwd(input.cwd);
      const upstream = yield* run("upstreamRemote", input.cwd, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]);
      const remoteName =
        upstream.exitCode === 0 && upstream.stdout.includes("/")
          ? upstream.stdout.trim().split("/")[0]!
          : yield* git
              .resolvePrimaryRemoteName(input.cwd)
              .pipe(Effect.mapError(() => fail("This repository has no remote to fetch from.")));
      yield* gitWorkflow
        .fetchRemote({ cwd: input.cwd, remoteName })
        .pipe(
          Effect.mapError((cause) => fail(`Could not fetch from ${remoteName}: ${cause.detail}`)),
        );
      yield* refreshVcsStatus(input.cwd);
    },
  );

  const pull: GitClientService["Service"]["pull"] = Effect.fn("GitClientService.pull")(
    function* (input) {
      return yield* mutation(input.cwd, () =>
        gitWorkflow
          .pullCurrentBranch(input.cwd)
          .pipe(Effect.mapError((cause) => fail(`Could not pull: ${cause.detail}`))),
      );
    },
  );

  return GitClientService.of({
    status,
    log,
    stage,
    unstage,
    discard,
    commit,
    generateCommitMessage,
    undo,
    fetch,
    pull,
  });
});

export const layer = Layer.effect(GitClientService, make);
