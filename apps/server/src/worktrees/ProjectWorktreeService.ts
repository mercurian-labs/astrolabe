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
  type ProjectWorktreeListResult,
  type ProjectWorktreeOpenInput,
  type ProjectWorktreeOpenResult,
  type ProjectWorktreeRemoveInput,
  type ProjectWorktreeRemoveResult,
  type ProjectWorktreeSetAside,
  type ProjectWorktreeSetKeptInput,
  type TerminalSummary,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
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
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { makeIsManagedWorktreePath, resolveWorktreesDirectory } from "../worktreesDirectory.ts";
import * as WorkspaceWatcher from "./WorkspaceWatcher.ts";
import { countStatusFiles, type ListedWorktree, parseWorktreeList } from "./worktreeList.ts";

/**
 * Astrolabe: a repository's worktrees as buckets for branches. Opening a branch uses the worktree
 * it is checked out in, else a free one, else a new one. A free worktree's uncommitted work is set
 * aside under its branch (a checkpoint ref) and comes back when that branch is next opened, as
 * long as the branch has not moved on. Holds say why a worktree is not free.
 */
export class ProjectWorktreeService extends Context.Service<
  ProjectWorktreeService,
  {
    readonly list: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<ProjectWorktreeListResult, ProjectWorktreeError>;
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
    /** Changes on disk in one of the project's worktrees, while the stream runs. */
    readonly changes: (
      input: ProjectWorktreeChangesInput,
    ) => Stream.Stream<ProjectWorktreeChange, ProjectWorktreeError>;
  }
>()("t3/worktrees/ProjectWorktreeService") {}

export const SET_ASIDE_REF_PREFIX = "refs/astrolabe/set-aside/";

/** What the service keeps beside git: worktrees marked Keep, and each repository's numbering. */
const KeptStore = Schema.Struct({
  version: Schema.Literal(1),
  kept: Schema.Array(Schema.String),
  /** By repository folder, then worktree folder. */
  numbers: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number)).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
type KeptStore = typeof KeptStore.Type;
const KeptStoreJson = fromJsonStringPretty(KeptStore);
const decodeKeptStore = Schema.decodeEffect(KeptStoreJson);
const encodeKeptStore = Schema.encodeEffect(KeptStoreJson);

/**
 * Numbers a repository's linked worktrees: one keeps its number while it exists, a new one takes
 * the lowest free number from 1. The same object when nothing changed.
 */
export function numberWorktrees(
  numbers: Readonly<Record<string, number>>,
  paths: ReadonlyArray<string>,
): Readonly<Record<string, number>> {
  const kept = Object.fromEntries(
    Object.entries(numbers).filter(([worktreePath]) => paths.includes(worktreePath)),
  );
  const taken = new Set(Object.values(kept));
  let changed = Object.keys(kept).length !== Object.keys(numbers).length;
  for (const worktreePath of paths) {
    if (kept[worktreePath] !== undefined) continue;
    let n = 1;
    while (taken.has(n)) n += 1;
    kept[worktreePath] = n;
    taken.add(n);
    changed = true;
  }
  return changed ? kept : numbers;
}

const fail = (message: string) => new ProjectWorktreeError({ message });
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
  const projectLocks = new Map<string, Semaphore.Semaphore>();
  const projectLock = (projectId: ProjectId) => {
    const existing = projectLocks.get(projectId);
    if (existing) return existing;
    const created = Semaphore.makeUnsafe(1);
    projectLocks.set(projectId, created);
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
      : { version: 1, kept: [], numbers: {} };
    yield* Ref.set(keptCache, store);
    return store;
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

  /** A repository's worktree numbers, after numbering any new worktree and freeing gone ones. */
  const numbersFor = (root: string, paths: ReadonlyArray<string>) =>
    updateStore((store) => {
      const current = store.numbers[root] ?? {};
      const next = numberWorktrees(current, paths);
      return next === current && store.numbers[root] !== undefined
        ? store
        : { ...store, numbers: { ...store.numbers, [root]: next } };
    }).pipe(Effect.map((store) => store.numbers[root] ?? {}));

  const repositoryRoot = Effect.fn("ProjectWorktreeService.repositoryRoot")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* projects
      .getById(projectId)
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
      readonly changedFiles: number;
      readonly now: number;
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
        storageCleanupThreadIdle(thread, context.now)
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
    // Set-aside work is keyed by branch, so a detached checkout's edits have nowhere to go.
    if (listed.branch === null && context.changedFiles > 0)
      holds.push({ kind: "detached", label: "Uncommitted changes on a detached checkout" });
    return holds;
  };

  const listWorktrees = Effect.fn("ProjectWorktreeService.listWorktrees")(function* (root: string) {
    const listed = yield* runGit("list", root, ["worktree", "list", "--porcelain", "-z"]).pipe(
      Effect.map((result) => parseWorktreeList(result.stdout)),
    );
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
    // The main checkout first, then by number, so a worktree keeps its place in the list.
    const ordered = listed.toSorted(
      (a, b) =>
        (a.isMain ? 0 : (numbers[a.path] ?? Number.MAX_SAFE_INTEGER)) -
        (b.isMain ? 0 : (numbers[b.path] ?? Number.MAX_SAFE_INTEGER)),
    );
    return yield* Effect.forEach(
      ordered,
      (entry) =>
        Effect.gen(function* () {
          const exists = yield* fileSystem
            .exists(entry.path)
            .pipe(Effect.orElseSucceed(() => false));
          const files = exists ? yield* changedFiles(entry.path) : 0;
          const managed = entry.isMain ? false : yield* isManagedWorktreePath(entry.path);
          const worktree: ProjectWorktree = {
            path: entry.path,
            isMain: entry.isMain,
            branch: entry.branch,
            head: entry.head,
            alias: entry.branch ?? entry.head?.slice(0, 8) ?? path.basename(entry.path),
            number: entry.isMain ? null : (numbers[entry.path] ?? null),
            kept: kept.includes(entry.path),
            holds: holdsFor(entry, {
              threads,
              kept: kept.includes(entry.path),
              managed,
              changedFiles: files,
              now,
            }),
            changedFiles: files,
          };
          return worktree;
        }),
      { concurrency: 4 },
    );
  });

  const list: ProjectWorktreeService["Service"]["list"] = Effect.fn("ProjectWorktreeService.list")(
    function* (input) {
      const root = yield* repositoryRoot(input.projectId);
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
    if (worktree.changedFiles === 0) return;
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

  /** A free worktree, preferring one with nothing to set aside. */
  const freeWorktree = (worktrees: ReadonlyArray<ProjectWorktree>) =>
    worktrees
      .filter((worktree) => worktree.holds.length === 0)
      .toSorted((a, b) => a.changedFiles - b.changedFiles)[0];

  const reread = (root: string, worktreePath: string) =>
    listWorktrees(root).pipe(
      Effect.flatMap((worktrees) => {
        const found = worktrees.find((worktree) => worktree.path === worktreePath);
        return found ? Effect.succeed(found) : Effect.fail(fail("The worktree went missing."));
      }),
    );

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
    const free = reuse ? freeWorktree(worktrees) : undefined;
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
      const root = yield* repositoryRoot(input.projectId);
      yield* checkBranchName(root, input.branch);
      return yield* projectLock(input.projectId).withPermit(
        Effect.gen(function* () {
          const worktrees = yield* listWorktrees(root);
          const existing = worktrees.find((worktree) => worktree.branch === input.branch);
          if (existing) return { worktree: existing, setAside: "none" as const };
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
    const root = yield* repositoryRoot(input.projectId);
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
    return yield* projectLock(input.projectId).withPermit(
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
    if (worktree.changedFiles > 0) {
      const files = `${worktree.changedFiles} uncommitted ${worktree.changedFiles === 1 ? "file" : "files"}`;
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
    const root = yield* repositoryRoot(input.projectId);
    return yield* projectLock(input.projectId).withPermit(
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
    const root = yield* repositoryRoot(input.projectId);
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
    const root = yield* repositoryRoot(input.projectId);
    yield* checkpoints
      .deleteCheckpointRefs({ cwd: root, checkpointRefs: [setAsideRef(input.branch)] })
      .pipe(Effect.mapError(failWith("Set-aside work could not be discarded")));
  });

  const changes: ProjectWorktreeService["Service"]["changes"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const root = yield* repositoryRoot(input.projectId);
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
    changes,
  });
});

export const layer = Layer.effect(ProjectWorktreeService, make);
