import {
  CheckpointRef,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type ProjectWorktree,
  type ProjectWorktreeChange,
  type ProjectWorktreeChangesInput,
  type ProjectWorktreeCreateInput,
  type ProjectWorktreeDiscardSetAsideInput,
  ProjectWorktreeError,
  type ProjectWorktreeHold,
  type ProjectWorktreeMaker,
  type ProjectWorktreeListInput,
  type ProjectWorktreeListResult,
  type ProjectWorktreeOpenInput,
  type ProjectWorktreeOpenResult,
  type ProjectWorktreeRemoveInput,
  type ProjectWorktreeRemoveResult,
  type ProjectWorktreeSetAside,
  type ProjectWorktreeSetKeptInput,
  type ProjectWorktreeStatusResult,
  type ProjectWorktreeTargetInput,
  type ServerSettings as ServerSettingsShape,
  type TerminalSummary,
  type WikiId,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { storageCleanupThreadIdle } from "../storageCleanup.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as WikiService from "../wiki/WikiService.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { makeIsManagedWorktreePath, resolveWorktreesDirectory } from "../worktreesDirectory.ts";
import * as WorkspaceWatcher from "./WorkspaceWatcher.ts";
import { countStatusFiles, type ListedWorktree, parseWorktreeList } from "./worktreeList.ts";

/**
 * Astrolabe: a repository's worktrees as buckets for branches, a project's or a wiki's. Opening a branch uses the worktree
 * it is checked out in, else a free one, else a new one. A free worktree's uncommitted work is set
 * aside under its branch (a checkpoint ref) and comes back when that branch is next opened, as
 * long as the branch has not moved on. Holds say why a worktree is not free.
 */
export class ProjectWorktreeService extends Context.Service<
  ProjectWorktreeService,
  {
    readonly list: (
      input: ProjectWorktreeListInput,
    ) => Effect.Effect<ProjectWorktreeListResult, ProjectWorktreeError>;
    readonly open: (
      input: ProjectWorktreeOpenInput,
    ) => Effect.Effect<ProjectWorktreeOpenResult, ProjectWorktreeError>;
    readonly create: (
      input: ProjectWorktreeCreateInput,
    ) => Effect.Effect<ProjectWorktree, ProjectWorktreeError>;
    readonly remove: (
      input: ProjectWorktreeRemoveInput,
    ) => Effect.Effect<ProjectWorktreeRemoveResult, ProjectWorktreeError>;
    readonly setKept: (
      input: ProjectWorktreeSetKeptInput,
    ) => Effect.Effect<void, ProjectWorktreeError>;
    readonly discardSetAside: (
      input: ProjectWorktreeDiscardSetAsideInput,
    ) => Effect.Effect<void, ProjectWorktreeError>;
    /** One worktree's uncommitted files, which a list leaves uncounted. */
    readonly status: (
      input: ProjectWorktreeTargetInput,
    ) => Effect.Effect<ProjectWorktreeStatusResult, ProjectWorktreeError>;
    /** Gives a worktree its number, the first time something is opened in it. */
    readonly markOpened: (
      input: ProjectWorktreeTargetInput,
    ) => Effect.Effect<void, ProjectWorktreeError>;
    /** Changes on disk in one of the project's worktrees, while the stream runs. */
    readonly changes: (
      input: ProjectWorktreeChangesInput,
    ) => Stream.Stream<ProjectWorktreeChange, ProjectWorktreeError>;
  }
>()("t3/worktrees/ProjectWorktreeService") {}

export const SET_ASIDE_REF_PREFIX = "refs/astrolabe/set-aside/";

/**
 * What the service keeps beside git: worktrees marked Keep, and the numbers of worktrees something
 * was opened in. Numbering every worktree read as one per agent run (hundreds), so an older store's
 * `numbers` is left unread.
 */
const KeptStore = Schema.Struct({
  version: Schema.Literal(1),
  kept: Schema.Array(Schema.String),
  /** By repository folder, then worktree folder. */
  opened: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number)).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
type KeptStore = typeof KeptStore.Type;
const KeptStoreJson = fromJsonStringPretty(KeptStore);
const decodeKeptStore = Schema.decodeEffect(KeptStoreJson);
const encodeKeptStore = Schema.encodeEffect(KeptStoreJson);

/** Worktree numbers by repository folder, then worktree folder; unique across repositories. */
type OpenedNumbers = Readonly<Record<string, Readonly<Record<string, number>>>>;

const lowestFree = (taken: ReadonlySet<number>) => {
  let n = 1;
  while (taken.has(n)) n += 1;
  return n;
};

/** Frees the numbers of a repository's worktrees gone; the same object when none went. */
export function keepNumbers(
  opened: OpenedNumbers,
  root: string,
  paths: ReadonlyArray<string>,
): OpenedNumbers {
  const numbers = opened[root] ?? {};
  const kept = Object.fromEntries(
    Object.entries(numbers).filter(([worktreePath]) => paths.includes(worktreePath)),
  );
  return Object.keys(kept).length === Object.keys(numbers).length
    ? opened
    : { ...opened, [root]: kept };
}

/**
 * Numbers a worktree with the lowest number no repository uses, so tabs from two projects never
 * share one; the same object when it has one.
 */
export function claimNumber(
  opened: OpenedNumbers,
  root: string,
  worktreePath: string,
): OpenedNumbers {
  const numbers = opened[root] ?? {};
  if (numbers[worktreePath] !== undefined) return opened;
  const taken = new Set(Object.values(opened).flatMap((each) => Object.values(each)));
  return { ...opened, [root]: { ...numbers, [worktreePath]: lowestFree(taken) } };
}

/**
 * Renumbers a number shared by several worktrees, as stores from when each repository counted
 * from 1 have; the first keeps it. The same object when every number is distinct.
 */
export function distinctNumbers(opened: OpenedNumbers): OpenedNumbers {
  const taken = new Set<number>();
  const repeated: Array<readonly [root: string, worktreePath: string]> = [];
  for (const [root, numbers] of Object.entries(opened)) {
    for (const [worktreePath, n] of Object.entries(numbers)) {
      if (taken.has(n)) repeated.push([root, worktreePath]);
      else taken.add(n);
    }
  }
  if (repeated.length === 0) return opened;
  const next = Object.fromEntries(
    Object.entries(opened).map(([root, numbers]) => [root, { ...numbers }]),
  );
  for (const [root, worktreePath] of repeated) {
    const n = lowestFree(taken);
    taken.add(n);
    next[root]![worktreePath] = n;
  }
  return next;
}

/** Which tool made a linked worktree, told by the folder its agents' tools keep worktrees in. */
export function worktreeMaker(
  worktreePath: string,
  context: { readonly managed: boolean; readonly home: string },
): ProjectWorktreeMaker {
  const under = (folder: string) => worktreePath.startsWith(`${context.home}/${folder}/`);
  if (context.managed || under(".astrolabe/worktrees")) return "astrolabe";
  if (worktreePath.includes("/.claude/worktrees/")) return "claude-code";
  if (worktreePath.includes("/.codex/worktrees/")) return "codex";
  if (under(".t3/worktrees")) return "t3-code";
  return "other";
}

const fail = (message: string) => new ProjectWorktreeError({ message });

/** How many free worktrees a branch looks through for one with nothing to set aside. */
const FREE_WORKTREES_COUNTED = 5;
const failWith = (prefix: string) => (cause: unknown) =>
  fail(
    `${prefix}: ${
      typeof cause === "object" && cause !== null && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause)
    }`,
  );

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectService.ProjectService;
  const wikis = yield* WikiService.WikiService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitWorkflow = yield* GitWorkflow.GitWorkflowService;
  const checkpoints = yield* CheckpointStore.CheckpointStore;
  const terminals = yield* TerminalManager.TerminalManager;
  const watcher = yield* WorkspaceWatcher.WorkspaceWatcher;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const isManagedWorktreePath = yield* makeIsManagedWorktreePath;
  const keptPath = path.join(config.stateDir, "worktree-keep.json");
  const keptCache = yield* Ref.make<KeptStore | undefined>(undefined);
  const keptLock = yield* Semaphore.make(1);
  const repositoryLocks = new Map<string, Semaphore.Semaphore>();
  const repositoryLock = (root: string) => {
    const existing = repositoryLocks.get(root);
    if (existing) return existing;
    const created = Semaphore.makeUnsafe(1);
    repositoryLocks.set(root, created);
    return created;
  };

  const liveTerminals = new Map<string, TerminalSummary>();
  const unsubscribe = yield* terminals.subscribeMetadata((event) =>
    Effect.sync(() => {
      if (event.type === "snapshot") {
        liveTerminals.clear();
        for (const terminal of event.terminals)
          liveTerminals.set(`${terminal.threadId}\0${terminal.terminalId}`, terminal);
      } else if (event.type === "upsert") {
        liveTerminals.set(
          `${event.terminal.threadId}\0${event.terminal.terminalId}`,
          event.terminal,
        );
      } else {
        liveTerminals.delete(`${event.threadId}\0${event.terminalId}`);
      }
    }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

  const inside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const runGit = (operation: string, cwd: string, args: ReadonlyArray<string>) =>
    git
      .execute({ operation: `ProjectWorktreeService.${operation}`, cwd, args })
      .pipe(Effect.mapError(failWith("Git failed")));
  const tryGit = (operation: string, cwd: string, args: ReadonlyArray<string>) =>
    git
      .execute({
        operation: `ProjectWorktreeService.${operation}`,
        cwd,
        args,
        allowNonZeroExit: true,
      })
      .pipe(Effect.mapError(failWith("Git failed")));

  const loadKept = Effect.gen(function* () {
    const cached = yield* Ref.get(keptCache);
    if (cached !== undefined) return cached;
    const exists = yield* fileSystem.exists(keptPath).pipe(Effect.orElseSucceed(() => false));
    const store: KeptStore = exists
      ? yield* fileSystem
          .readFileString(keptPath)
          .pipe(
            Effect.flatMap(decodeKeptStore),
            Effect.mapError(failWith("Kept worktrees could not be read")),
          )
      : { version: 1, kept: [], opened: {} };
    const opened = distinctNumbers(store.opened);
    const distinct = opened === store.opened ? store : { ...store, opened };
    yield* Ref.set(keptCache, distinct);
    return distinct;
  });

  /** Changes the store and saves it; nothing is written when `change` returns it as it was. */
  const updateStore = (change: (store: KeptStore) => KeptStore) =>
    keptLock.withPermit(
      Effect.gen(function* () {
        const store = yield* loadKept;
        const next = change(store);
        if (next === store) return next;
        const contents = yield* encodeKeptStore(next).pipe(
          Effect.mapError(failWith("Kept worktrees could not be saved")),
        );
        yield* writeFileStringAtomically({ filePath: keptPath, contents: `${contents}\n` }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.mapError(failWith("Kept worktrees could not be saved")),
        );
        yield* Ref.set(keptCache, next);
        return next;
      }),
    );

  /** A repository's worktree numbers, after freeing those of worktrees gone. */
  const numbersFor = (root: string, paths: ReadonlyArray<string>) =>
    updateStore((store) => {
      const opened = keepNumbers(store.opened, root, paths);
      return opened === store.opened ? store : { ...store, opened };
    }).pipe(Effect.map((store) => store.opened[root] ?? {}));

  const claim = (root: string, worktreePath: string) =>
    updateStore((store) => {
      const opened = claimNumber(store.opened, root, worktreePath);
      return opened === store.opened ? store : { ...store, opened };
    });

  /** The folder of the repository the worktrees are in: the project's, or the wiki's. */
  const repositoryRoot = Effect.fn("ProjectWorktreeService.repositoryRoot")(function* (owner: {
    readonly projectId?: ProjectId;
    readonly wikiId?: WikiId;
  }) {
    if (owner.wikiId !== undefined) {
      if (owner.projectId !== undefined) return yield* fail("Name a project or a wiki, not both.");
      return yield* wikis.root(owner.wikiId).pipe(Effect.mapError((error) => fail(error.message)));
    }
    if (owner.projectId === undefined) return yield* fail("Name a project or a wiki.");
    const project = yield* projects
      .getById(owner.projectId)
      .pipe(Effect.mapError(failWith("The project could not be read")));
    if (Option.isNone(project)) return yield* fail("The project was not found.");
    return project.value.workspaceRoot;
  });

  const changedFiles = (cwd: string) =>
    runGit("status", cwd, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=dirty",
    ]).pipe(Effect.map((result) => countStatusFiles(result.stdout)));

  const listSetAside = (root: string) =>
    runGit("listSetAside", root, [
      "for-each-ref",
      "--format=%(refname)%00%(parent)",
      SET_ASIDE_REF_PREFIX,
    ]).pipe(
      Effect.map((result) =>
        result.stdout
          .split("\n")
          .filter(Boolean)
          .map((line): ProjectWorktreeSetAside => {
            const [ref = "", parents = ""] = line.split("\0");
            return {
              branch: ref.slice(SET_ASIDE_REF_PREFIX.length),
              ref,
              base: parents.split(" ")[0] || null,
            };
          }),
      ),
    );

  const holdsFor = (
    listed: ListedWorktree,
    context: {
      readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
      readonly kept: boolean;
      readonly managed: boolean;
      readonly now: number;
      readonly settings: ServerSettingsShape;
    },
  ): ReadonlyArray<ProjectWorktreeHold> => {
    const holds: ProjectWorktreeHold[] = [];
    if (listed.isMain) holds.push({ kind: "main", label: "The repository's own checkout" });
    else if (!context.managed)
      holds.push({ kind: "external", label: "Made outside Astrolabe's worktree folder" });
    if (context.kept) holds.push({ kind: "kept", label: "Kept" });
    for (const thread of context.threads) {
      if (thread.worktreePath === null || path.resolve(thread.worktreePath) !== listed.path)
        continue;
      holds.push(
        storageCleanupThreadIdle(thread, context.now, context.settings)
          ? { kind: "thread", label: `Used by ${thread.title}` }
          : { kind: "working", label: `${thread.title} is working here` },
      );
    }
    for (const terminal of liveTerminals.values()) {
      if (terminal.status !== "starting" && terminal.status !== "running") continue;
      const cwd = path.resolve(terminal.cwd);
      if (
        (terminal.worktreePath !== null && path.resolve(terminal.worktreePath) === listed.path) ||
        inside(listed.path, cwd)
      ) {
        holds.push({ kind: "terminal", label: "A terminal is open here" });
        break;
      }
    }
    // Set-aside work is keyed by branch, so a detached checkout's edits would have nowhere to go;
    // a list does not count them, so a detached checkout is never taken.
    if (!listed.isMain && listed.branch === null)
      holds.push({
        kind: "detached",
        label: "A detached checkout, with no branch to set work aside on",
      });
    return holds;
  };

  // git status reads a whole checkout (a second or more in a big one), so a repository with
  // hundreds of worktrees counts a few at a time.
  const statusPermits = yield* Semaphore.make(4);
  const countChanged = (cwd: string) => statusPermits.withPermit(changedFiles(cwd));

  const mtimeOf = (target: string) =>
    fileSystem.stat(target).pipe(
      Effect.map((info) => Option.getOrNull(info.mtime)?.getTime() ?? null),
      Effect.orElseSucceed(() => null),
    );

  /** When a worktree was last used: its branch's reflog or its top folder, whichever moved last. */
  const lastActiveAt = Effect.fnUntraced(function* (worktreePath: string) {
    const dotGit = path.join(worktreePath, ".git");
    // A linked worktree's `.git` is a file naming its git dir; the main checkout's is the dir.
    const pointer = yield* fileSystem.readFileString(dotGit).pipe(Effect.orElseSucceed(() => ""));
    const gitDir = pointer.startsWith("gitdir: ")
      ? path.resolve(worktreePath, pointer.slice("gitdir: ".length).trim())
      : dotGit;
    const times = [
      yield* mtimeOf(path.join(gitDir, "logs", "HEAD")),
      yield* mtimeOf(path.join(gitDir, "HEAD")),
      yield* mtimeOf(worktreePath),
    ].filter((time) => time !== null);
    return times.length === 0 ? null : DateTime.formatIso(DateTime.makeUnsafe(Math.max(...times)));
  });

  /** The worktrees each repository had when last listed, which a single worktree is checked against. */
  const listedPaths = new Map<string, ReadonlySet<string>>();

  /** A repository's worktrees, uncounted: counting each would run git status in every one. */
  const listWorktrees = Effect.fn("ProjectWorktreeService.listWorktrees")(function* (root: string) {
    const listed = yield* runGit("list", root, ["worktree", "list", "--porcelain", "-z"]).pipe(
      Effect.map((result) => parseWorktreeList(result.stdout)),
    );
    listedPaths.set(root, new Set(listed.map((entry) => entry.path)));
    const { kept } = yield* loadKept;
    const numbers = yield* numbersFor(
      root,
      listed.filter((entry) => !entry.isMain).map((entry) => entry.path),
    );
    const snapshot = yield* projections
      .getShellSnapshot()
      .pipe(Effect.mapError(failWith("Threads could not be read")));
    const threads = snapshot.threads.filter(
      (thread) => thread.archivedAt === null && thread.deletedAt === null,
    );
    const now = yield* Clock.currentTimeMillis;
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(failWith("Settings could not be read")),
    );
    const home = yield* HostProcess.HomeDirectory;
    // The main checkout first, then the numbered by number, then the rest as git lists them.
    const ordered = listed.toSorted(
      (a, b) =>
        (a.isMain ? 0 : (numbers[a.path] ?? Number.MAX_SAFE_INTEGER)) -
        (b.isMain ? 0 : (numbers[b.path] ?? Number.MAX_SAFE_INTEGER)),
    );
    return yield* Effect.forEach(
      ordered,
      (entry) =>
        Effect.gen(function* () {
          const managed = entry.isMain ? false : yield* isManagedWorktreePath(entry.path);
          const worktree: ProjectWorktree = {
            path: entry.path,
            isMain: entry.isMain,
            branch: entry.branch,
            head: entry.head,
            alias: entry.branch ?? entry.head?.slice(0, 8) ?? path.basename(entry.path),
            number: entry.isMain ? null : (numbers[entry.path] ?? null),
            madeBy: entry.isMain ? null : worktreeMaker(entry.path, { managed, home }),
            lastActiveAt: yield* lastActiveAt(entry.path),
            kept: kept.includes(entry.path),
            holds: holdsFor(entry, {
              threads,
              kept: kept.includes(entry.path),
              managed,
              now,
              settings,
            }),
            changedFiles: null,
          };
          return worktree;
        }),
      { concurrency: 8 },
    );
  });

  /** A worktree with its uncommitted files counted; zero for a folder gone from disk. */
  const counted = Effect.fnUntraced(function* (worktree: ProjectWorktree) {
    const exists = yield* fileSystem.exists(worktree.path).pipe(Effect.orElseSucceed(() => false));
    return { ...worktree, changedFiles: exists ? yield* countChanged(worktree.path) : 0 };
  });

  /** A worktree of the repository's by its folder, as listed now. */
  const listedWorktree = Effect.fnUntraced(function* (root: string, worktreePath: string) {
    const found = (yield* listWorktrees(root)).find((entry) => entry.path === worktreePath);
    return found ?? (yield* fail("That worktree is not in this repository."));
  });

  const list: ProjectWorktreeService["Service"]["list"] = Effect.fn("ProjectWorktreeService.list")(
    function* (input) {
      const root = yield* repositoryRoot(input);
      const worktrees = yield* listWorktrees(root);
      const setAside = yield* listSetAside(root);
      return { worktrees, setAside };
    },
  );

  const setAsideRef = (branch: string) => CheckpointRef.make(`${SET_ASIDE_REF_PREFIX}${branch}`);

  /** Saves a worktree's uncommitted work under its branch, then leaves it clean. */
  const setAside = Effect.fn("ProjectWorktreeService.setAside")(function* (
    worktree: ProjectWorktree,
  ) {
    const { changedFiles } = yield* counted(worktree);
    if (changedFiles === 0) return;
    if (worktree.branch === null)
      return yield* fail("A detached checkout's uncommitted changes have no branch to go with.");
    yield* checkpoints
      .captureCheckpoint({ cwd: worktree.path, checkpointRef: setAsideRef(worktree.branch) })
      .pipe(Effect.mapError(failWith("Uncommitted work could not be set aside")));
    yield* runGit("resetSetAside", worktree.path, ["reset", "--hard", "--quiet"]);
    yield* runGit("cleanSetAside", worktree.path, ["clean", "-fd", "--quiet"]);
  });

  /** Puts a branch's set-aside work back when the branch is where it was left. */
  const restoreSetAside = Effect.fn("ProjectWorktreeService.restoreSetAside")(function* (
    cwd: string,
    branch: string,
  ) {
    const ref = setAsideRef(branch);
    const parent = yield* tryGit("setAsideBase", cwd, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^`,
    ]);
    if (parent.exitCode !== 0) return "none" as const;
    const head = yield* runGit("head", cwd, ["rev-parse", "HEAD"]);
    if (parent.stdout.trim() !== head.stdout.trim()) return "stale" as const;
    yield* checkpoints
      .restoreCheckpoint({ cwd, checkpointRef: ref })
      .pipe(Effect.mapError(failWith("Set-aside work could not be put back")));
    yield* checkpoints
      .deleteCheckpointRefs({ cwd, checkpointRefs: [ref] })
      .pipe(Effect.mapError(failWith("Set-aside work could not be cleared")));
    return "restored" as const;
  });

  const newWorktreePath = Effect.fn("ProjectWorktreeService.newWorktreePath")(function* (
    root: string,
  ) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(failWith("Settings could not be read")),
    );
    const parent = resolveWorktreesDirectory(
      settings.worktreesDirectory,
      config.worktreesDir,
      path,
      yield* HostProcess.HomeDirectory,
    );
    if (parent === null)
      return yield* fail(
        "The worktree location must be an absolute folder on this machine. Change it in Settings → Worktrees.",
      );
    const suffix = (yield* crypto.randomUUIDv4().pipe(Effect.orDie)).slice(0, 8);
    return path.join(parent, path.basename(path.resolve(root)), `t3-${suffix}`);
  });

  const checkBranchName = Effect.fn("ProjectWorktreeService.checkBranchName")(function* (
    root: string,
    branch: string,
  ) {
    const checked = yield* tryGit("checkBranch", root, ["check-ref-format", "--branch", branch]);
    if (checked.exitCode !== 0 || branch.startsWith("-"))
      return yield* fail(`"${branch}" is not a branch name.`);
  });

  /**
   * A free worktree, preferring one with nothing to set aside. The least recently used are
   * counted first, a few at most, as counting each runs git status.
   */
  const freeWorktree = Effect.fnUntraced(function* (worktrees: ReadonlyArray<ProjectWorktree>) {
    const free = worktrees
      .filter((worktree) => worktree.holds.length === 0)
      .toSorted((a, b) => (a.lastActiveAt ?? "").localeCompare(b.lastActiveAt ?? ""));
    let best: ProjectWorktree | undefined;
    for (const worktree of free.slice(0, FREE_WORKTREES_COUNTED)) {
      const withCount = yield* counted(worktree);
      if (withCount.changedFiles === 0) return withCount;
      if (best === undefined || (withCount.changedFiles ?? 0) < (best.changedFiles ?? 0))
        best = withCount;
    }
    return best;
  });

  /** A worktree as it stands after a change, counted, and numbered as opened. */
  const reread = Effect.fnUntraced(function* (root: string, worktreePath: string) {
    yield* claim(root, worktreePath);
    const found = (yield* listWorktrees(root)).find((worktree) => worktree.path === worktreePath);
    if (found === undefined) return yield* fail("The worktree went missing.");
    return yield* counted(found);
  });

  /**
   * Puts `branch` in a worktree: the free one's work is set aside and it switches; with none free,
   * a new worktree. `start` makes the branch new, from that commit.
   */
  const place = Effect.fn("ProjectWorktreeService.place")(function* (
    root: string,
    branch: string,
    start: string | null,
    reuse: boolean,
  ) {
    const worktrees = yield* listWorktrees(root);
    const free = reuse ? yield* freeWorktree(worktrees) : undefined;
    let target: string;
    if (free) {
      target = free.path;
      yield* withWorkspaceLease(
        free.path,
        Effect.gen(function* () {
          yield* setAside(free);
          yield* runGit(
            "switch",
            free.path,
            start === null
              ? ["switch", "--quiet", branch]
              : ["switch", "--quiet", "-c", branch, start],
          );
        }),
      );
    } else {
      target = yield* newWorktreePath(root);
      yield* git
        .createWorktree(
          start === null
            ? { cwd: root, refName: branch, path: target }
            : { cwd: root, refName: start, newRefName: branch, path: target },
        )
        .pipe(Effect.mapError(failWith("The worktree could not be made")));
    }
    yield* gitWorkflow.invalidateStatus(target);
    return target;
  });

  const open: ProjectWorktreeService["Service"]["open"] = Effect.fn("ProjectWorktreeService.open")(
    function* (input) {
      const root = yield* repositoryRoot(input);
      yield* checkBranchName(root, input.branch);
      return yield* repositoryLock(root).withPermit(
        Effect.gen(function* () {
          const worktrees = yield* listWorktrees(root);
          const existing = worktrees.find((worktree) => worktree.branch === input.branch);
          if (existing)
            return { worktree: yield* reread(root, existing.path), setAside: "none" as const };
          const target = yield* place(root, input.branch, null, input.newWorktree !== true);
          const restored = yield* withWorkspaceLease(target, restoreSetAside(target, input.branch));
          return { worktree: yield* reread(root, target), setAside: restored };
        }),
      );
    },
  );

  const create: ProjectWorktreeService["Service"]["create"] = Effect.fn(
    "ProjectWorktreeService.create",
  )(function* (input) {
    const root = yield* repositoryRoot(input);
    yield* checkBranchName(root, input.branch);
    const taken = yield* tryGit("branchExists", root, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${input.branch}`,
    ]);
    if (taken.exitCode === 0) return yield* fail(`A branch named ${input.branch} already exists.`);
    const base = yield* tryGit("base", root, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${input.base}^{commit}`,
    ]);
    if (base.exitCode !== 0) return yield* fail(`${input.base} is not a branch or commit here.`);
    return yield* repositoryLock(root).withPermit(
      Effect.gen(function* () {
        const target = yield* place(
          root,
          input.branch,
          base.stdout.trim(),
          input.newWorktree !== true,
        );
        return yield* reread(root, target);
      }),
    );
  });

  const removeWarnings = Effect.fn("ProjectWorktreeService.removeWarnings")(function* (
    root: string,
    worktree: ProjectWorktree,
  ) {
    const warnings: string[] = [];
    for (const hold of worktree.holds) {
      if (hold.kind === "thread")
        warnings.push(`${hold.label}. Its next turn makes the worktree again from its branch.`);
      else if (hold.kind === "terminal") warnings.push("A terminal open here will stop working.");
      else if (hold.kind === "kept") warnings.push("You marked this worktree Keep.");
      else if (hold.kind === "external") warnings.push("It was made outside Astrolabe.");
    }
    const { changedFiles } = yield* counted(worktree);
    if (changedFiles > 0) {
      const files = `${changedFiles} uncommitted ${changedFiles === 1 ? "file" : "files"}`;
      warnings.push(
        worktree.branch === null
          ? `${files} will be lost.`
          : `${files} will be set aside on ${worktree.branch} and come back when it is opened.`,
      );
    }
    if (worktree.branch !== null) {
      const only = yield* tryGit("unpushed", root, [
        "rev-list",
        "--count",
        `refs/heads/${worktree.branch}`,
        "--not",
        "--remotes",
        `--exclude=refs/heads/${worktree.branch}`,
        "--branches",
      ]);
      const count = Number(only.stdout.trim());
      if (only.exitCode === 0 && count > 0)
        warnings.push(
          `${count} ${count === 1 ? "commit" : "commits"} on ${worktree.branch} exist only on that branch. The branch stays.`,
        );
    }
    return warnings;
  });

  const remove: ProjectWorktreeService["Service"]["remove"] = Effect.fn(
    "ProjectWorktreeService.remove",
  )(function* (input) {
    const root = yield* repositoryRoot(input);
    return yield* repositoryLock(root).withPermit(
      Effect.gen(function* () {
        const worktrees = yield* listWorktrees(root);
        const worktree = worktrees.find((entry) => entry.path === input.path);
        if (worktree === undefined) return yield* fail("That worktree is not in this repository.");
        if (worktree.isMain)
          return yield* fail(
            "The repository's own checkout is not deleted here. Remove the repository instead.",
          );
        const working = worktree.holds.find((hold) => hold.kind === "working");
        if (working) return yield* fail(`${working.label}. Stop it before deleting the worktree.`);
        const warnings = yield* removeWarnings(root, worktree);
        if (warnings.length > 0 && !input.confirmed) return { removed: false, warnings };
        yield* withWorkspaceLease(
          worktree.path,
          Effect.gen(function* () {
            if (worktree.branch !== null) yield* setAside(worktree);
            yield* gitWorkflow
              .removeWorktree({ cwd: root, path: worktree.path, force: true })
              .pipe(Effect.mapError(failWith("The worktree could not be deleted")));
          }),
        );
        if (worktree.kept) yield* writeKept(worktree.path, false);
        yield* gitWorkflow.invalidateStatus(root);
        return { removed: true, warnings };
      }),
    );
  });

  const writeKept = (worktreePath: string, kept: boolean) =>
    updateStore((store) => ({
      ...store,
      kept: [
        ...store.kept.filter((entry) => entry !== worktreePath),
        ...(kept ? [worktreePath] : []),
      ],
    }));

  const setKept: ProjectWorktreeService["Service"]["setKept"] = Effect.fn(
    "ProjectWorktreeService.setKept",
  )(function* (input) {
    const root = yield* repositoryRoot(input);
    const listed = yield* runGit("list", root, ["worktree", "list", "--porcelain", "-z"]).pipe(
      Effect.map((result) => parseWorktreeList(result.stdout)),
    );
    if (!listed.some((entry) => entry.path === input.path && !entry.isMain))
      return yield* fail("That worktree is not in this repository.");
    yield* writeKept(input.path, input.kept);
  });

  const discardSetAside: ProjectWorktreeService["Service"]["discardSetAside"] = Effect.fn(
    "ProjectWorktreeService.discardSetAside",
  )(function* (input) {
    const root = yield* repositoryRoot(input);
    yield* checkpoints
      .deleteCheckpointRefs({ cwd: root, checkpointRefs: [setAsideRef(input.branch)] })
      .pipe(Effect.mapError(failWith("Set-aside work could not be discarded")));
  });

  const status: ProjectWorktreeService["Service"]["status"] = Effect.fn(
    "ProjectWorktreeService.status",
  )(function* (input) {
    const root = yield* repositoryRoot(input);
    if (!listedPaths.get(root)?.has(input.path)) yield* listedWorktree(root, input.path);
    const exists = yield* fileSystem.exists(input.path).pipe(Effect.orElseSucceed(() => false));
    return { changedFiles: exists ? yield* countChanged(input.path) : 0 };
  });

  const markOpened: ProjectWorktreeService["Service"]["markOpened"] = Effect.fn(
    "ProjectWorktreeService.markOpened",
  )(function* (input) {
    const root = yield* repositoryRoot(input);
    const worktree = yield* listedWorktree(root, input.path);
    if (!worktree.isMain) yield* claim(root, worktree.path);
  });

  const changes: ProjectWorktreeService["Service"]["changes"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const root = yield* repositoryRoot(input);
        const listed = yield* runGit("list", root, ["worktree", "list", "--porcelain", "-z"]).pipe(
          Effect.map((result) => parseWorktreeList(result.stdout)),
        );
        if (!listed.some((entry) => entry.path === input.path))
          return yield* fail("That worktree is not in this repository.");
        return yield* watcher.changes(input.path);
      }),
    );

  return ProjectWorktreeService.of({
    list,
    open,
    create,
    remove,
    setKept,
    discardSetAside,
    status,
    markOpened,
    changes,
  });
});

export const layer = Layer.effect(ProjectWorktreeService, make);
