// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CheckpointRef, MercurianCommitId, MercurianRepositoryId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import * as LineBranchStore from "../commitTree/LineBranchStore.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import { lineSnapshotRef, make } from "./SnapshotChain.ts";

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

it.effect("captures a parented snapshot chain and derives branch state", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "snapshot-chain-"))),
    (cwd) =>
      Effect.gen(function* () {
        runGit(cwd, ["init", "--initial-branch=main"]);
        runGit(cwd, ["config", "user.email", "test@example.com"]);
        runGit(cwd, ["config", "user.name", "Test User"]);
        NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "base\n");
        runGit(cwd, ["add", "."]);
        runGit(cwd, ["commit", "-m", "base"]);
        runGit(cwd, ["checkout", "-b", "mercurian/line"]);
        const head = runGit(cwd, ["rev-parse", "HEAD"]);
        const lineRootCommitId = MercurianCommitId.make("line-root");
        const repositoryId = MercurianRepositoryId.make("repository");
        const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
          execute: (input) =>
            Effect.sync(() => {
              const result = NodeChildProcess.spawnSync("git", input.args, {
                cwd: input.cwd,
                encoding: "utf8",
                env: input.env,
              });
              if (result.status !== 0 && input.allowNonZeroExit !== true) {
                throw new Error(result.stderr);
              }
              return {
                exitCode: result.status ?? 1,
                stdout: result.stdout ?? "",
                stderr: result.stderr ?? "",
                stdoutTruncated: false,
                stderrTruncated: false,
              };
            }) as never,
        });
        const checkpointLayer = Layer.mock(CheckpointStore.CheckpointStore)({
          captureCheckpoint: (input) =>
            Effect.sync(() => {
              runGit(input.cwd, ["add", "-A", "--", "."]);
              const tree = runGit(input.cwd, ["write-tree"]);
              const oid = runGit(input.cwd, [
                "commit-tree",
                tree,
                ...(input.parents?.flatMap((parent) => ["-p", parent]) ?? []),
                "-m",
                input.message ?? `t3 checkpoint ref=${input.checkpointRef}`,
              ]);
              runGit(input.cwd, ["update-ref", input.checkpointRef, oid]);
              runGit(input.cwd, ["reset", "--mixed", "HEAD"]);
            }),
        });
        const lineLayer = Layer.mock(LineBranchStore.LineBranchStore)({
          get: () =>
            Effect.succeed(
              Option.some({
                lineRootCommitId,
                repositoryId,
                branch: "mercurian/line",
                baseOid: head,
                built: false,
                createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
              }),
            ),
        });
        const layer = Layer.mergeAll(gitLayer, checkpointLayer, lineLayer, NodeServices.layer);
        const chain = yield* make.pipe(Effect.provide(layer));

        const firstRef = CheckpointRef.make("refs/t3/test/first");
        const first = yield* chain.capture({
          cwd,
          lineRootCommitId,
          kind: "settled",
          ref: firstRef,
        });
        assert.strictEqual(first.previousOid, null);
        assert.strictEqual(runGit(cwd, ["rev-parse", `${firstRef}^1`]), head);

        NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "settled tree\n");
        const secondRef = CheckpointRef.make("refs/t3/test/second");
        const second = yield* chain.capture({
          cwd,
          lineRootCommitId,
          kind: "partial",
          ref: secondRef,
        });
        assert.strictEqual(runGit(cwd, ["rev-parse", `${secondRef}^1`]), first.oid);
        assert.strictEqual(runGit(cwd, ["rev-parse", `${secondRef}^2`]), head);
        assert.strictEqual(
          runGit(cwd, ["rev-parse", lineSnapshotRef(lineRootCommitId)]),
          second.oid,
        );
        assert.deepStrictEqual(
          yield* chain.branchMovement({
            cwd,
            previousOid: second.previousOid,
            lineRootCommitId,
            repositoryId,
            lineBranch: "mercurian/line",
          }),
          { kind: "unchanged" },
        );
        assert.strictEqual(
          yield* chain.isDrifted({
            cwd,
            lineRootCommitId,
            lineBranch: "mercurian/line",
          }),
          false,
        );
        NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "further edit\n");
        assert.strictEqual(
          yield* chain.isDrifted({
            cwd,
            lineRootCommitId,
            lineBranch: "mercurian/line",
          }),
          true,
        );
        runGit(cwd, ["restore", "--source", secondRef, "--worktree", "--", "."]);
        runGit(cwd, ["commit", "--allow-empty", "-m", "human commit"]);
        assert.strictEqual(
          yield* chain.isDrifted({
            cwd,
            lineRootCommitId,
            lineBranch: "mercurian/line",
          }),
          true,
        );
        assert.deepStrictEqual(
          yield* chain.branchMovement({
            cwd,
            previousOid: second.oid,
            lineRootCommitId,
            repositoryId,
            lineBranch: "mercurian/line",
          }),
          { kind: "added", count: 1 },
        );
        const rewritten = runGit(cwd, [
          "commit-tree",
          runGit(cwd, ["write-tree"]),
          "-m",
          "rewritten root",
        ]);
        runGit(cwd, ["reset", "--hard", rewritten]);
        assert.deepStrictEqual(
          yield* chain.branchMovement({
            cwd,
            previousOid: second.oid,
            lineRootCommitId,
            repositoryId,
            lineBranch: "mercurian/line",
          }),
          { kind: "rewritten" },
        );
        assert.strictEqual(
          chain.departure({ headRef: "refs/heads/other", lineBranch: "mercurian/line" }),
          "refs/heads/other",
        );
        assert.strictEqual(
          chain.departure({ headRef: null, lineBranch: "mercurian/line" }),
          "detached",
        );
      }),
    (cwd) => Effect.sync(() => NodeFS.rmSync(cwd, { recursive: true, force: true })),
  ),
);
