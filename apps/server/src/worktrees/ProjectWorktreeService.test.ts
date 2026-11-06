import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2ThreadShell,
  ProjectId,
  runTerminalThreadId,
  type TerminalMetadataStreamEvent,
  ThreadId,
  WikiError,
  WikiId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Settings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WikiService from "../wiki/WikiService.ts";
import {
  claimNumber,
  distinctNumbers,
  keepNumbers,
  worktreeMaker,
  ProjectWorktreeService,
  layer as projectWorktreeLayer,
  SET_ASIDE_REF_PREFIX,
} from "./ProjectWorktreeService.ts";
import * as WorkspaceWatcher from "./WorkspaceWatcher.ts";

const projectId = ProjectId.make("project-1");
const wikiIdOfRepo = WikiId.make("wiki-1");

const layerVcsProcess = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const layerBase = Layer.mergeAll(
  GitVcsDriver.layer,
  CheckpointStore.layer.pipe(
    Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(layerVcsProcess))),
  ),
).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "project-worktrees-" })),
  Layer.provideMerge(NodeServices.layer),
);

const thread = (overrides: Partial<OrchestrationV2ThreadShell>) =>
  ({
    id: ThreadId.make("thread-1"),
    projectId,
    title: "Agent thread",
    worktreePath: null,
    branch: null,
    activeRunId: null,
    status: "idle",
    archivedAt: null,
    deletedAt: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    ...overrides,
  }) as OrchestrationV2ThreadShell;

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const repo = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "worktrees-repo-" }));
  yield* fs.makeDirectory(config.worktreesDir, { recursive: true });
  const worktreesDir = yield* fs.realPath(config.worktreesDir);
  const command = (cwd: string, args: ReadonlyArray<string>) =>
    git
      .execute({ operation: "worktrees-test", cwd, args })
      .pipe(Effect.map((result) => result.stdout.trim()));
  yield* command(repo, ["init", "-b", "main"]);
  yield* command(repo, ["config", "user.email", "worktrees@example.test"]);
  yield* command(repo, ["config", "user.name", "Worktrees test"]);
  yield* fs.writeFileString(`${repo}/tracked.txt`, "original\n");
  yield* fs.writeFileString(`${repo}/.gitignore`, ".env\n");
  yield* command(repo, ["add", "."]);
  yield* command(repo, ["commit", "-m", "initial"]);
  yield* command(repo, ["branch", "alpha"]);
  yield* command(repo, ["branch", "beta"]);

  const state = {
    threads: [] as OrchestrationV2ThreadShell[],
    watched: [] as string[],
    workspaceRoot: repo,
    closedIdle: [] as string[],
    terminalEvent: (_event: TerminalMetadataStreamEvent): Effect.Effect<void> => Effect.void,
  };
  const context = yield* Layer.build(projectWorktreeLayer).pipe(
    Effect.provideService(ProjectService.ProjectService, {
      getById: () => Effect.sync(() => Option.some({ workspaceRoot: state.workspaceRoot })),
    } as unknown as ProjectService.ProjectService["Service"]),
    Effect.provideService(WikiService.WikiService, {
      root: (wikiId: WikiId) =>
        wikiId === wikiIdOfRepo
          ? Effect.succeed(repo)
          : Effect.fail(
              new WikiError({ reason: "not-found", message: "No wiki has this id or name." }),
            ),
    } as unknown as WikiService.WikiService["Service"]),
    Effect.provideService(ProjectionStore.ProjectionStoreV2, {
      getShellSnapshot: () => Effect.sync(() => ({ threads: state.threads, archivedThreads: [] })),
    } as unknown as ProjectionStore.ProjectionStoreV2["Service"]),
    Effect.provideService(TerminalManager.TerminalManager, {
      subscribeMetadata: (listener: typeof state.terminalEvent) =>
        Effect.sync(() => {
          state.terminalEvent = listener;
          return () => undefined;
        }),
      closeIdle: (input: { threadId: string }) =>
        Effect.sync(() => void state.closedIdle.push(input.threadId)),
    } as unknown as TerminalManager.TerminalManager["Service"]),
    Effect.provideService(GitWorkflow.GitWorkflowService, {
      invalidateStatus: () => Effect.void,
      removeWorktree: (input: { cwd: string; path: string; force?: boolean }) =>
        git.removeWorktree(input),
    } as unknown as GitWorkflow.GitWorkflowService["Service"]),
    Effect.provideService(Settings.ServerSettingsService, {
      getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      subscribeChanges: Effect.succeed(Stream.empty),
    } as unknown as Settings.ServerSettingsService["Service"]),
    Effect.provideService(WorkspaceWatcher.WorkspaceWatcher, {
      changes: (root: string) =>
        Effect.sync(() => {
          state.watched.push(root);
          return Stream.empty;
        }),
    }),
  );
  const service = Context.get(context, ProjectWorktreeService);
  return { fs, repo, worktreesDir, command, service, state };
});

const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layerBase> | Scope.Scope>) =>
  effect.pipe(Effect.provide(layerBase), Effect.scoped);

describe("worktree numbers", () => {
  it("free a gone worktree's number, and give an opened one the lowest free", () => {
    const opened = { "/repo": { "/wt/a": 1, "/wt/b": 2, "/wt/c": 3 } };
    const kept = keepNumbers(opened, "/repo", ["/wt/a", "/wt/c", "/wt/d"]);
    expect(kept).toEqual({ "/repo": { "/wt/a": 1, "/wt/c": 3 } });
    expect(claimNumber(kept, "/repo", "/wt/d")).toEqual({
      "/repo": { "/wt/a": 1, "/wt/c": 3, "/wt/d": 2 },
    });
    expect(keepNumbers(opened, "/repo", ["/wt/a", "/wt/b", "/wt/c"])).toBe(opened);
    expect(claimNumber(opened, "/repo", "/wt/b")).toBe(opened);
  });

  it("are unique across repositories, so tabs from two projects never share one", () => {
    const opened = { "/shop": { "/wt/shop-1": 1, "/wt/shop-3": 3 } };
    expect(claimNumber(opened, "/handbook", "/wt/hb")).toEqual({
      ...opened,
      "/handbook": { "/wt/hb": 2 },
    });
  });

  it("renumber those an older store gave out once per repository", () => {
    const opened = {
      "/shop": { "/wt/shop-1": 1, "/wt/shop-2": 2 },
      "/handbook": { "/wt/hb-1": 1, "/wt/hb-4": 4 },
    };
    expect(distinctNumbers(opened)).toEqual({
      "/shop": { "/wt/shop-1": 1, "/wt/shop-2": 2 },
      "/handbook": { "/wt/hb-1": 3, "/wt/hb-4": 4 },
    });
    const distinct = { "/shop": { "/wt/a": 1 }, "/handbook": { "/wt/b": 2 } };
    expect(distinctNumbers(distinct)).toBe(distinct);
  });
});

describe("worktreeMaker", () => {
  it("tells which tool made a worktree by the folder it is in", () => {
    const context = { managed: false, home: "/Users/me" };
    expect(worktreeMaker("/data/worktrees/app/t3-1", { ...context, managed: true })).toBe(
      "astrolabe",
    );
    expect(worktreeMaker("/Users/me/.astrolabe/worktrees/app/t3-2", context)).toBe("astrolabe");
    expect(worktreeMaker("/Users/me/dev/app/.claude/worktrees/fix", context)).toBe("claude-code");
    expect(worktreeMaker("/Users/me/.codex/worktrees/10ee/app", context)).toBe("codex");
    expect(worktreeMaker("/Users/me/.t3/worktrees/app/t3-3", context)).toBe("t3-code");
    expect(worktreeMaker("/tmp/app-merge", context)).toBe("other");
  });
});

describe("ProjectWorktreeService", () => {
  it.live("opens a checked-out branch where it is, and makes a worktree when none is free", () =>
    run(
      Effect.gen(function* () {
        const { service, repo, worktreesDir } = yield* fixture;
        const main = yield* service.open({ projectId, branch: "main" });
        expect(main.worktree).toMatchObject({ path: repo, isMain: true, alias: "main" });

        const alpha = yield* service.open({ projectId, branch: "alpha" });
        expect(alpha.worktree.path.startsWith(worktreesDir)).toBe(true);
        expect(alpha.worktree).toMatchObject({ branch: "alpha", alias: "alpha", holds: [] });
      }),
    ),
  );

  it.live("reads a wiki's worktrees in its own folder, as a project's are read in its", () =>
    run(
      Effect.gen(function* () {
        const { service, worktreesDir } = yield* fixture;
        const alpha = yield* service.open({ wikiId: wikiIdOfRepo, branch: "alpha" });
        expect(alpha.worktree.path.startsWith(worktreesDir)).toBe(true);
        const listed = yield* service.list({ wikiId: wikiIdOfRepo });
        expect(listed.worktrees.map((worktree) => worktree.branch)).toEqual(["main", "alpha"]);
        expect(listed.worktrees.every((worktree) => worktree.isRepository)).toBe(true);

        const unknown = yield* Effect.flip(service.list({ wikiId: WikiId.make("wiki-2") }));
        expect(unknown.message).toBe("No wiki has this id or name.");
        const neither = yield* Effect.flip(service.list({}));
        expect(neither.message).toBe("Name a project or a wiki.");
      }),
    ),
  );

  it.live("lists a folder that is no repository as its one checkout, and follows it", () =>
    run(
      Effect.gen(function* () {
        const { service, fs, state } = yield* fixture;
        const folder = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "worktrees-plain-" }),
        );
        yield* fs.writeFileString(`${folder}/init.lua`, "-- no git here\n");
        state.workspaceRoot = folder;

        const listed = yield* service.list({ projectId });
        expect(listed.setAside).toEqual([]);
        expect(listed.worktrees).toHaveLength(1);
        expect(listed.worktrees[0]).toMatchObject({
          path: folder,
          isMain: true,
          isRepository: false,
          branch: null,
          head: null,
          alias: folder.slice(folder.lastIndexOf("/") + 1),
        });
        // Has changes waits for every count, so a folder git can't count must still answer.
        expect(yield* service.status({ projectId, path: folder })).toEqual({ changedFiles: 0 });
        yield* service.markOpened({ projectId, path: folder });
        yield* Stream.runDrain(service.changes({ projectId, path: folder }));
        expect(state.watched).toEqual([folder]);
      }),
    ),
  );

  it.live("reports a project folder it can't read, rather than listing it as a plain one", () =>
    run(
      Effect.gen(function* () {
        const { service, fs, state } = yield* fixture;
        const folder = yield* fs.makeTempDirectoryScoped({ prefix: "worktrees-gone-" });
        state.workspaceRoot = `${folder}/gone`;
        const failed = yield* Effect.flip(service.list({ projectId }));
        expect(failed._tag).toBe("ProjectWorktreeError");
      }),
    ),
  );

  it.live("reuses a free worktree, setting its work aside and bringing it back", () =>
    run(
      Effect.gen(function* () {
        const { service, fs, command, repo } = yield* fixture;
        const alpha = yield* service.open({ projectId, branch: "alpha" });
        yield* fs.writeFileString(`${alpha.worktree.path}/tracked.txt`, "alpha edit\n");
        yield* fs.writeFileString(`${alpha.worktree.path}/new.txt`, "untracked\n");
        yield* fs.writeFileString(`${alpha.worktree.path}/.env`, "SECRET=1\n");

        const beta = yield* service.open({ projectId, branch: "beta" });
        expect(beta.worktree.path).toBe(alpha.worktree.path);
        expect(beta.worktree.changedFiles).toBe(0);
        expect(yield* fs.exists(`${beta.worktree.path}/new.txt`)).toBe(false);
        // Ignored files stay with the folder.
        expect(yield* fs.readFileString(`${beta.worktree.path}/.env`)).toBe("SECRET=1\n");
        const listed = yield* service.list({ projectId });
        expect(listed.setAside.map((entry) => entry.branch)).toEqual(["alpha"]);

        const back = yield* service.open({ projectId, branch: "alpha" });
        expect(back.setAside).toBe("restored");
        expect(yield* fs.readFileString(`${back.worktree.path}/tracked.txt`)).toBe("alpha edit\n");
        expect(yield* fs.readFileString(`${back.worktree.path}/new.txt`)).toBe("untracked\n");
        expect(
          yield* command(repo, ["for-each-ref", "--format=%(refname)", SET_ASIDE_REF_PREFIX]),
        ).toBe("");
      }),
    ),
  );

  it.live("leaves set-aside work alone when its branch has moved on", () =>
    run(
      Effect.gen(function* () {
        const { service, fs, command, repo } = yield* fixture;
        const alpha = yield* service.open({ projectId, branch: "alpha" });
        yield* fs.writeFileString(`${alpha.worktree.path}/tracked.txt`, "alpha edit\n");
        yield* service.open({ projectId, branch: "beta" });
        yield* command(repo, ["commit", "--allow-empty", "-m", "main moves"]);
        yield* command(repo, ["branch", "-f", "alpha", "main"]);

        const reopened = yield* service.open({ projectId, branch: "alpha" });
        expect(reopened.setAside).toBe("stale");
        expect(yield* fs.readFileString(`${reopened.worktree.path}/tracked.txt`)).toBe(
          "original\n",
        );
        const listed = yield* service.list({ projectId });
        expect(listed.setAside.map((entry) => entry.branch)).toEqual(["alpha"]);

        yield* service.discardSetAside({ projectId, branch: "alpha" });
        expect((yield* service.list({ projectId })).setAside).toEqual([]);
      }),
    ),
  );

  it.live("opens a branch in a new worktree when asked, even with one free", () =>
    run(
      Effect.gen(function* () {
        const { service } = yield* fixture;
        const alpha = yield* service.open({ projectId, branch: "alpha" });
        const beta = yield* service.open({ projectId, branch: "beta", newWorktree: true });
        expect(beta.worktree.path).not.toBe(alpha.worktree.path);
        const listed = yield* service.list({ projectId });
        expect(listed.worktrees.map((worktree) => [worktree.branch, worktree.number])).toEqual([
          ["main", null],
          ["alpha", 1],
          ["beta", 2],
        ]);
      }),
    ),
  );

  it.live("lists another tool's worktree uncounted and unnumbered until it is opened", () =>
    run(
      Effect.gen(function* () {
        const { service, fs, command, repo, worktreesDir } = yield* fixture;
        const outside = `${worktreesDir}-outside`;
        yield* command(repo, ["worktree", "add", "--quiet", outside, "alpha"]);
        yield* fs.writeFileString(`${outside}/new.txt`, "untracked\n");

        const listed = yield* service.list({ projectId });
        const found = listed.worktrees.find((worktree) => worktree.path === outside);
        expect(found).toMatchObject({ number: null, changedFiles: null, madeBy: "other" });
        expect(found?.lastActiveAt).not.toBeNull();
        expect(yield* service.status({ projectId, path: outside })).toEqual({ changedFiles: 1 });

        yield* service.markOpened({ projectId, path: outside });
        const after = yield* service.list({ projectId });
        expect(after.worktrees.find((worktree) => worktree.path === outside)?.number).toBe(1);
        const stranger = yield* Effect.flip(service.status({ projectId, path: "/nowhere" }));
        expect(stranger.message).toBe("That worktree is not in this repository.");
      }),
    ),
  );

  it.live("does not take a worktree a thread uses or one marked Keep", () =>
    run(
      Effect.gen(function* () {
        const { service, state } = yield* fixture;
        const alpha = yield* service.open({ projectId, branch: "alpha" });
        state.threads = [thread({ worktreePath: alpha.worktree.path, branch: "alpha" })];
        const beta = yield* service.open({ projectId, branch: "beta" });
        expect(beta.worktree.path).not.toBe(alpha.worktree.path);

        state.threads = [];
        yield* service.setKept({ projectId, path: beta.worktree.path, kept: true });
        const listed = yield* service.list({ projectId });
        expect(listed.worktrees.find((entry) => entry.branch === "beta")?.holds).toEqual([
          { kind: "kept", label: "Kept" },
        ]);
        const created = yield* service.create({ projectId, branch: "gamma", base: "main" });
        expect(created.path).toBe(alpha.worktree.path);
      }),
    ),
  );

  it.live("lets an idle run terminal go with its worktree, but not a busy one", () =>
    run(
      Effect.gen(function* () {
        const { service, state } = yield* fixture;
        const { worktree } = yield* service.open({ projectId, branch: "alpha" });
        const threadId = runTerminalThreadId(worktree.path);
        const runTerminal = (hasRunningSubprocess: boolean) =>
          state.terminalEvent({
            type: "upsert",
            terminal: {
              threadId,
              terminalId: "run-1",
              cwd: worktree.path,
              worktreePath: worktree.path,
              status: "running",
              pid: 1,
              exitCode: null,
              exitSignal: null,
              hasRunningSubprocess,
              label: "tests::adds",
              updatedAt: "2026-06-10T12:00:00.000Z",
            },
          });
        const holds = () =>
          service
            .list({ projectId })
            .pipe(
              Effect.map(
                ({ worktrees }) =>
                  worktrees.find((entry) => entry.path === worktree.path)?.holds ?? [],
              ),
            );

        yield* runTerminal(true);
        expect(yield* holds()).toEqual([{ kind: "terminal", label: "A terminal is open here" }]);

        yield* runTerminal(false);
        expect(yield* holds()).toEqual([]);
        const removed = yield* service.remove({ projectId, path: worktree.path, confirmed: true });
        expect(removed.removed).toBe(true);
        expect(state.closedIdle).toEqual([threadId]);
      }),
    ),
  );

  it.live("asks before deleting a worktree with work in it, then sets the work aside", () =>
    run(
      Effect.gen(function* () {
        const { service, fs, repo } = yield* fixture;
        const mainRemoval = yield* service
          .remove({ projectId, path: repo, confirmed: true })
          .pipe(Effect.flip);
        expect(mainRemoval.message).toContain("own checkout");

        const alpha = yield* service.open({ projectId, branch: "alpha" });
        yield* fs.writeFileString(`${alpha.worktree.path}/tracked.txt`, "alpha edit\n");
        const asked = yield* service.remove({
          projectId,
          path: alpha.worktree.path,
          confirmed: false,
        });
        expect(asked).toEqual({
          removed: false,
          warnings: [
            "1 uncommitted file will be set aside on alpha and come back when it is opened.",
          ],
        });
        expect(yield* fs.exists(alpha.worktree.path)).toBe(true);

        const removed = yield* service.remove({
          projectId,
          path: alpha.worktree.path,
          confirmed: true,
        });
        expect(removed.removed).toBe(true);
        expect(yield* fs.exists(alpha.worktree.path)).toBe(false);
        const back = yield* service.open({ projectId, branch: "alpha" });
        expect(back.setAside).toBe("restored");
        expect(yield* fs.readFileString(`${back.worktree.path}/tracked.txt`)).toBe("alpha edit\n");
      }),
    ),
  );

  it.live("follows changes only in the repository's own worktrees", () =>
    run(
      Effect.gen(function* () {
        const { service, repo, fs, state } = yield* fixture;
        const alpha = yield* service.open({ projectId, branch: "alpha" });
        yield* Stream.runDrain(service.changes({ projectId, path: alpha.worktree.path }));
        yield* Stream.runDrain(service.changes({ projectId, path: repo }));
        expect(state.watched).toEqual([alpha.worktree.path, repo]);

        const elsewhere = yield* fs.makeTempDirectoryScoped({ prefix: "not-a-worktree-" });
        const refused = yield* Stream.runDrain(
          service.changes({ projectId, path: elsewhere }),
        ).pipe(Effect.flip);
        expect(refused.message).toBe("That worktree is not in this repository.");
        expect(state.watched).toHaveLength(2);
      }),
    ),
  );
});
