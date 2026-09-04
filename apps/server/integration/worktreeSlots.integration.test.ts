// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { MercurianCommitId, MercurianProjectId, MercurianRepositoryId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as CheckpointStore from "../src/checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../src/config.ts";
import * as GitWorkflowService from "../src/git/GitWorkflowService.ts";
import * as LineBranchStore from "../src/mercurian/commitTree/LineBranchStore.ts";
import * as MemorySourceStore from "../src/mercurian/memory/MemorySourceStore.ts";
import * as RepositoryStore from "../src/mercurian/repositories/RepositoryStore.ts";
import * as SlotRegistry from "../src/mercurian/worktreeSlots/SlotRegistry.ts";
import { make, slotMemberWorktreePath } from "../src/mercurian/worktreeSlots/SlotService.ts";
import * as SlotStore from "../src/mercurian/worktreeSlots/SlotStore.ts";
import { lineSnapshotRef, SnapshotChain } from "../src/mercurian/worktreeSlots/SnapshotChain.ts";
import type { WorktreeSlot } from "../src/mercurian/worktreeSlots/schema.ts";
import * as ServerSettings from "../src/serverSettings.ts";
import * as GitVcsDriver from "../src/vcs/GitVcsDriver.ts";
import * as Path from "effect/Path";

const runGit = (cwd: string, args: ReadonlyArray<string>, allowFailure = false) => {
  const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
};

it.effect(
  "keeps a bounded project pool warm while switching every repository to a third line",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "astrolabe-slots-"))),
      (root) =>
        Effect.gen(function* () {
          const repositoriesRoot = NodePath.join(root, "repositories");
          const repositoryPaths = [
            NodePath.join(repositoriesRoot, "a"),
            NodePath.join(repositoriesRoot, "b"),
          ];
          const repositoryIds = [
            MercurianRepositoryId.make("repository-a"),
            MercurianRepositoryId.make("repository-b"),
          ];
          const worktreesDir = NodePath.join(root, "worktrees");
          const projectId = MercurianProjectId.make("project");
          const now = DateTime.makeUnsafe("2026-08-31T12:00:00.000Z");
          const lines = ["line-a", "line-b", "line-c"].map((line) => MercurianCommitId.make(line));
          for (const repositoryPath of repositoryPaths) {
            NodeFS.mkdirSync(repositoryPath, { recursive: true });
            runGit(repositoryPath, ["init", "--initial-branch=main"]);
            runGit(repositoryPath, ["config", "user.email", "test@example.com"]);
            runGit(repositoryPath, ["config", "user.name", "Test User"]);
            NodeFS.writeFileSync(NodePath.join(repositoryPath, ".gitignore"), "node_modules/\n");
            NodeFS.writeFileSync(NodePath.join(repositoryPath, "README.md"), "base\n");
            runGit(repositoryPath, ["add", "."]);
            runGit(repositoryPath, ["commit", "-m", "base"]);
            for (const line of lines) runGit(repositoryPath, ["branch", `mercurian/${line}`]);
          }
          const rows: WorktreeSlot[] = [];

          const dependencies = Layer.mergeAll(
            Layer.mock(SlotStore.SlotStore)({
              list: (id) => Effect.sync(() => rows.filter((row) => row.projectId === id)),
              listAll: Effect.sync(() => [...rows]),
              get: (slotId) =>
                Effect.sync(() => Option.fromNullishOr(rows.find((row) => row.slotId === slotId))),
              create: (slot) => Effect.sync(() => rows.push(slot)),
              assign: (assignment) =>
                Effect.sync(() => {
                  const index = rows.findIndex((row) => row.slotId === assignment.slotId);
                  const branches = new Map(
                    assignment.members.map((member) => [member.repositoryId, member.currentBranch]),
                  );
                  rows[index] = {
                    ...rows[index]!,
                    currentLineRootCommitId: assignment.lineRootCommitId,
                    members: rows[index]!.members.map((member) => ({
                      ...member,
                      currentBranch: branches.get(member.repositoryId) ?? null,
                    })),
                    lastUsedAt: assignment.lastUsedAt,
                  };
                }),
              changes: Stream.empty,
            }),
            SlotRegistry.layer,
            Layer.mock(MemorySourceStore.MemorySourceStore)({
              getSnapshot: Effect.succeed([]),
              getSource: () => Effect.succeed(Option.none()),
            }),
            Layer.mock(LineBranchStore.LineBranchStore)({
              get: ({ lineRootCommitId, repositoryId }) =>
                Effect.succeed(
                  Option.some({
                    lineRootCommitId,
                    repositoryId,
                    branch: `mercurian/${lineRootCommitId}`,
                    baseOid: "base",
                    built: false,
                    repointHold: null,
                    createdAt: now,
                  }),
                ),
            }),
            Layer.mock(RepositoryStore.RepositoryStore)({
              getSnapshot: Effect.succeed({
                repositories: repositoryPaths.map((repositoryPath, index) => ({
                  repositoryId: repositoryIds[index]!,
                  name: `repository-${index}`,
                  path: repositoryPath,
                  scripts: [],
                  hasGit: true,
                  hosting: null,
                  createdAt: now,
                  updatedAt: now,
                })),
                projectRepositories: repositoryIds.map((repositoryId) => ({
                  projectId,
                  repositoryId,
                })),
              }),
              changes: Stream.empty,
            }),
            Layer.mock(ServerSettings.ServerSettingsService)({
              getSettings: Effect.succeed({ worktreePoolSize: 2 } as never),
            }),
            Layer.mock(ServerConfig.ServerConfig)({
              worktreesDir,
            } as ServerConfig.ServerConfig["Service"]),
            Layer.mock(GitWorkflowService.GitWorkflowService)({
              createWorktree: ({ cwd, path, refName }) =>
                Effect.sync(
                  () => runGit(cwd, ["worktree", "add", path!, refName ?? "HEAD"]) as never,
                ),
              removeWorktree: ({ cwd, path, force }) =>
                Effect.sync(
                  () =>
                    runGit(cwd, [
                      "worktree",
                      "remove",
                      ...(force ? ["--force"] : []),
                      path,
                    ]) as never,
                ),
            }),
            Layer.mock(GitVcsDriver.GitVcsDriver)({
              execute: (input) =>
                Effect.sync(() => runGit(input.cwd, input.args, input.allowNonZeroExit) as never),
            }),
            Layer.mock(CheckpointStore.CheckpointStore)({
              captureCheckpoint: () => Effect.die("clean integration slots must not snapshot"),
              hasCheckpointRef: ({ cwd, checkpointRef }) =>
                Effect.sync(
                  () =>
                    runGit(
                      cwd,
                      ["rev-parse", "--verify", "--quiet", `${checkpointRef}^{commit}`],
                      true,
                    ).exitCode === 0,
                ),
              restoreCheckpoint: ({ cwd, checkpointRef }) =>
                Effect.sync(() => {
                  runGit(cwd, [
                    "restore",
                    "--source",
                    checkpointRef,
                    "--worktree",
                    "--staged",
                    "--",
                    ".",
                  ]);
                  runGit(cwd, ["clean", "-fd", "--", "."]);
                  runGit(cwd, ["reset", "--quiet", "--", "."]);
                  return true;
                }),
            }),
            Layer.mock(SnapshotChain)({
              capture: (input) =>
                Effect.sync(() => {
                  runGit(input.cwd, ["update-ref", input.ref, "HEAD"]);
                  return {
                    oid: runGit(input.cwd, ["rev-parse", "HEAD"]).stdout.trim(),
                    previousOid: null,
                    headOid: runGit(input.cwd, ["rev-parse", "HEAD"]).stdout.trim(),
                    headRef: runGit(input.cwd, ["symbolic-ref", "-q", "HEAD"]).stdout.trim(),
                    built: true,
                  };
                }),
              branchMovement: () => Effect.succeed({ kind: "unchanged" }),
              readStanding: () => Effect.succeed({ _tag: "on-line" }),
              lineCommit: () => Effect.succeed("head"),
              adoptRename: () => Effect.void,
              isDrifted: ({ cwd }) =>
                Effect.sync(() => NodeFS.existsSync(NodePath.join(cwd, "between-turns.txt"))),
            }),
          );
          const service = yield* make.pipe(
            Effect.provide(Layer.merge(dependencies, NodeServicesLayer)),
          );
          const path = yield* Path.Path;
          const holder = (threadId: string) => ({ kind: "turn" as const, threadId });

          const first = yield* service.claim({
            projectId,
            lineRootCommitId: lines[0]!,
            holder: holder("thread-a"),
          });
          assert.deepStrictEqual(
            first.members.map((member) => member.relativePath),
            ["a", "b"],
          );
          const firstRepositoryPath = slotMemberWorktreePath(path, first, repositoryIds[0]!)!;
          const marker = NodePath.join(firstRepositoryPath, "node_modules", ".warm-slot");
          NodeFS.mkdirSync(NodePath.dirname(marker), { recursive: true });
          NodeFS.writeFileSync(marker, "warm\n");
          assert.notStrictEqual(
            runGit(firstRepositoryPath, ["checkout", "main"], true).exitCode,
            0,
          );
          const second = yield* service.claim({
            projectId,
            lineRootCommitId: lines[1]!,
            holder: holder("thread-b"),
          });
          assert.notStrictEqual(first.path, second.path);
          assert.strictEqual(rows.length, 2);

          for (const repositoryPath of repositoryPaths) {
            NodeFS.writeFileSync(
              NodePath.join(repositoryPath, "inherited.txt"),
              "ancestor uncommitted work\n",
            );
            runGit(repositoryPath, ["add", "-A", "--", "."]);
            const tree = runGit(repositoryPath, ["write-tree"]).stdout.trim();
            const branchTip = runGit(repositoryPath, [
              "rev-parse",
              "mercurian/line-c",
            ]).stdout.trim();
            const snapshot = runGit(repositoryPath, [
              "commit-tree",
              tree,
              "-p",
              branchTip,
              "-m",
              "t3 snapshot kind=settled ref=test",
            ]).stdout.trim();
            runGit(repositoryPath, ["update-ref", lineSnapshotRef(lines[2]!), snapshot]);
            runGit(repositoryPath, ["reset", "--hard", "HEAD"]);
          }

          yield* service.release(first.slotId, holder("thread-a"));
          const third = yield* service.claim({
            projectId,
            lineRootCommitId: lines[2]!,
            holder: holder("thread-c"),
          });
          assert.strictEqual(third.path, first.path);
          for (const repositoryId of repositoryIds) {
            const worktreePath = slotMemberWorktreePath(path, third, repositoryId)!;
            assert.strictEqual(
              runGit(worktreePath, ["branch", "--show-current"]).stdout.trim(),
              "mercurian/line-c",
            );
            assert.strictEqual(
              NodeFS.readFileSync(NodePath.join(worktreePath, "inherited.txt"), "utf8"),
              "ancestor uncommitted work\n",
            );
            assert.match(runGit(worktreePath, ["status", "--porcelain"]).stdout, /inherited\.txt/u);
          }
          assert.deepStrictEqual(
            repositoryPaths.flatMap((repositoryPath) =>
              runGit(repositoryPath, ["for-each-ref", "--format=%(refname)", "refs/t3/lines/"])
                .stdout.split("\n")
                .filter((ref) => ref.includes("/snapshots/recovery-")),
            ),
            [],
          );
          assert.isTrue(NodeFS.existsSync(marker));

          yield* service.release(third.slotId, holder("thread-c"));
          const betweenTurnsPath = NodePath.join(
            slotMemberWorktreePath(path, third, repositoryIds[0]!)!,
            "between-turns.txt",
          );
          NodeFS.writeFileSync(betweenTurnsPath, "edited between turns\n");
          const affinity = yield* service.claim({
            projectId,
            lineRootCommitId: lines[2]!,
            holder: holder("thread-c-next"),
          });
          assert.strictEqual(affinity.slotId, third.slotId);
          assert.strictEqual(
            NodeFS.readFileSync(betweenTurnsPath, "utf8"),
            "edited between turns\n",
          );
          assert.match(
            runGit(NodePath.dirname(betweenTurnsPath), ["status", "--porcelain"]).stdout,
            /^\?\? between-turns\.txt$/mu,
          );
          assert.deepStrictEqual(
            repositoryPaths.flatMap((repositoryPath) =>
              runGit(repositoryPath, ["for-each-ref", "--format=%(refname)", "refs/t3/lines/"])
                .stdout.split("\n")
                .filter((ref) => ref.includes("/snapshots/recovery-")),
            ),
            [],
          );
        }).pipe(Effect.provide(NodeServicesLayer)),
      (root) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
    ),
);
