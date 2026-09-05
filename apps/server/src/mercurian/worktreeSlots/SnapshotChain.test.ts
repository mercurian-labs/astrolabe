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
import * as SlotStore from "./SlotStore.ts";
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
        const builtMarks: Array<string> = [];
        let built = false;
        const gitLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
          execute: (input) =>
            Effect.sync(() => {
              const result = NodeChildProcess.spawnSync("git", input.args, {
                cwd: input.cwd,
                encoding: "utf8",
                env: input.env,
                input: input.stdin,
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
                built,
                repointHold: null,
                createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
              }),
            ),
          markBuilt: ({ repositoryId }) =>
            Effect.sync(() => {
              built = true;
              builtMarks.push(repositoryId);
            }),
        });
        const slotLayer = Layer.mock(SlotStore.SlotStore)({
          listAll: Effect.succeed([]),
        });
        const layer = Layer.mergeAll(
          gitLayer,
          checkpointLayer,
          lineLayer,
          slotLayer,
          NodeServices.layer,
        );
        const chain = yield* make.pipe(Effect.provide(layer));

        const firstRef = CheckpointRef.make("refs/t3/test/first");
        const first = yield* chain.capture({
          cwd,
          lineRootCommitId,
          repositoryId,
          lineBranch: "mercurian/line",
          kind: "settled",
          ref: firstRef,
        });
        assert.strictEqual(first.previousOid, null);
        assert.strictEqual(first.built, false);
        assert.deepStrictEqual(builtMarks, []);
        assert.strictEqual(runGit(cwd, ["rev-parse", `${firstRef}^1`]), head);
        assert.deepStrictEqual(
          yield* chain.readStanding({
            cwd,
            lineRootCommitId,
            repositoryId,
            lineBranch: "mercurian/line",
          }),
          { _tag: "on-line" },
        );
        NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "changed tree\n");
        const changed = yield* chain.capture({
          cwd,
          lineRootCommitId,
          repositoryId,
          lineBranch: "mercurian/line",
          kind: "settled",
          ref: CheckpointRef.make("refs/t3/test/changed"),
        });
        assert.strictEqual(changed.built, true);
        assert.deepStrictEqual(builtMarks, [repositoryId]);
        runGit(cwd, ["restore", "--source", "HEAD", "--worktree", "--", "."]);
        built = false;
        builtMarks.length = 0;

        runGit(cwd, ["branch", "-m", "renamed-line"]);
        assert.deepStrictEqual(
          yield* chain.readStanding({
            cwd,
            lineRootCommitId,
            repositoryId,
            lineBranch: "mercurian/line",
          }),
          { _tag: "renamed", branch: "renamed-line" },
        );
        runGit(cwd, ["branch", "-m", "mercurian/line"]);
        runGit(cwd, ["checkout", "-b", "same-commit-name"]);
        assert.deepStrictEqual(
          yield* chain.readStanding({
            cwd,
            lineRootCommitId,
            repositoryId,
            lineBranch: "mercurian/line",
          }),
          {
            _tag: "departed",
            ref: "refs/heads/same-commit-name",
            recordedMissing: false,
          },
        );
        runGit(cwd, ["commit", "--allow-empty", "-m", "manual commit"]);
        assert.deepStrictEqual(
          yield* chain.readStanding({
            cwd,
            lineRootCommitId,
            repositoryId,
            lineBranch: "mercurian/line",
          }),
          { _tag: "departed", ref: "refs/heads/same-commit-name", recordedMissing: false },
        );
        runGit(cwd, ["checkout", "mercurian/line"]);
        runGit(cwd, ["branch", "-D", "same-commit-name"]);
        runGit(cwd, ["branch", "-m", "deleted-line"]);
        runGit(cwd, ["checkout", "--detach", head]);
        runGit(cwd, ["branch", "-D", "deleted-line"]);
        assert.deepStrictEqual(
          yield* chain.readStanding({
            cwd,
            lineRootCommitId,
            repositoryId,
            lineBranch: "mercurian/line",
          }),
          { _tag: "departed", ref: "detached", recordedMissing: true },
        );
        runGit(cwd, ["branch", "mercurian/line", head]);
        runGit(cwd, ["checkout", "mercurian/line"]);

        runGit(cwd, ["commit", "--allow-empty", "-m", "branch-only movement"]);
        const movedHead = runGit(cwd, ["rev-parse", "HEAD"]);
        const movedRef = CheckpointRef.make("refs/t3/test/moved");
        const moved = yield* chain.capture({
          cwd,
          lineRootCommitId,
          repositoryId,
          lineBranch: "mercurian/line",
          kind: "settled",
          ref: movedRef,
        });
        assert.strictEqual(moved.built, true);
        assert.deepStrictEqual(builtMarks, [repositoryId]);

        NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "settled tree\n");
        const secondRef = CheckpointRef.make("refs/t3/test/second");
        const second = yield* chain.capture({
          cwd,
          lineRootCommitId,
          repositoryId,
          lineBranch: "mercurian/line",
          kind: "partial",
          ref: secondRef,
        });
        assert.strictEqual(second.built, true);
        assert.deepStrictEqual(builtMarks, [repositoryId]);
        assert.strictEqual(runGit(cwd, ["rev-parse", `${secondRef}^1`]), moved.oid);
        assert.strictEqual(runGit(cwd, ["rev-parse", `${secondRef}^2`]), movedHead);
        runGit(cwd, ["add", "-A", "--", "."]);
        const curatedTree = runGit(cwd, ["write-tree"]);
        runGit(cwd, ["reset", "--mixed", "HEAD"]);
        const curated = yield* chain.captureTree({
          cwd,
          lineRootCommitId,
          repositoryId,
          lineBranch: "mercurian/line",
          kind: "curated",
          treeOid: curatedTree,
        });
        assert.strictEqual(runGit(cwd, ["rev-parse", `${curated.oid}^1`]), second.oid);
        assert.strictEqual(runGit(cwd, ["rev-parse", `${curated.oid}^2`]), movedHead);
        assert.strictEqual(runGit(cwd, ["rev-parse", `${curated.oid}^{tree}`]), curatedTree);
        assert.strictEqual(curated.built, true);
        assert.strictEqual(
          runGit(cwd, ["rev-parse", lineSnapshotRef(lineRootCommitId)]),
          curated.oid,
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
      }),
    (cwd) => Effect.sync(() => NodeFS.rmSync(cwd, { recursive: true, force: true })),
  ),
);
