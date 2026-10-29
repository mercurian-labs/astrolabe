import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
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
import {
  countStatusFiles,
  parseWorktreeList,
  ProjectWorktreeService,
  layer as projectWorktreeLayer,
  SET_ASIDE_REF_PREFIX,
} from "./ProjectWorktreeService.ts";

const projectId = ProjectId.make("project-1");

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

  const state = { threads: [] as OrchestrationV2ThreadShell[] };
  const context = yield* Layer.build(projectWorktreeLayer).pipe(
    Effect.provideService(ProjectService.ProjectService, {
      getById: () => Effect.succeedSome({ workspaceRoot: repo }),
    } as unknown as ProjectService.ProjectService["Service"]),
    Effect.provideService(ProjectionStore.ProjectionStoreV2, {
      getShellSnapshot: () => Effect.sync(() => ({ threads: state.threads, archivedThreads: [] })),
    } as unknown as ProjectionStore.ProjectionStoreV2["Service"]),
    Effect.provideService(TerminalManager.TerminalManager, {
      subscribeMetadata: () => Effect.succeed(() => undefined),
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
  );
  const service = Context.get(context, ProjectWorktreeService);
  return { fs, repo, worktreesDir, command, service, state };
});

const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layerBase> | Scope.Scope>) =>
  effect.pipe(Effect.provide(layerBase), Effect.scoped);

describe("parseWorktreeList", () => {
  it("reads branches and detached heads, first record as the main checkout", () => {
    const stdout = [
      "worktree /repo\0HEAD aaa\0branch refs/heads/main\0",
      "worktree /wt/one\0HEAD bbb\0detached\0",
      "worktree /wt/gone\0HEAD ccc\0branch refs/heads/old\0prunable gitdir file points to non-existent location\0",
      "",
    ].join("\0");
    expect(parseWorktreeList(stdout)).toEqual([
      { path: "/repo", isMain: true, branch: "main", head: "aaa" },
      { path: "/wt/one", isMain: false, branch: null, head: "bbb" },
    ]);
  });

  it("counts a rename once", () => {
    expect(countStatusFiles("R  new.txt\0old.txt\0?? added.txt\0")).toBe(2);
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
});
