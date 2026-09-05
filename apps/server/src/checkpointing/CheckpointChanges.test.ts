// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { CheckpointChangesError, enumerateCheckpointChanges } from "./CheckpointChanges.ts";

const TestLayer = GitVcsDriver.layer.pipe(
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-checkpoint-changes-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTmpDir = (): Effect.Effect<string, never, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem
      .makeTempDirectoryScoped({ prefix: "checkpoint-changes-" })
      .pipe(Effect.orDie);
  });

const git = Effect.fn("CheckpointChanges.test.git")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const result = yield* driver.execute({
    operation: "CheckpointChanges.test.git",
    cwd,
    args,
    timeoutMs: 10_000,
  });
  return result.stdout.trim();
});

const initializeRepository = Effect.fn("CheckpointChanges.test.initializeRepository")(function* (
  cwd: string,
) {
  yield* git(cwd, ["init", "-q"]);
  yield* git(cwd, ["config", "user.email", "test@test.com"]);
  yield* git(cwd, ["config", "user.name", "Test"]);
});

const commitAll = Effect.fn("CheckpointChanges.test.commitAll")(function* (
  cwd: string,
  message: string,
) {
  yield* git(cwd, ["add", "-A"]);
  yield* git(cwd, ["commit", "-qm", message]);
  return yield* git(cwd, ["rev-parse", "HEAD^{commit}"]);
});

it.layer(TestLayer)("enumerateCheckpointChanges", (it) => {
  it.effect("enumerates exact kinds, counts, binary data, modes, and raw rename paths", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTmpDir();
      yield* initializeRepository(cwd);
      const oldPath = " old ü.txt ";
      const newPath = " new 路径.txt ";
      NodeFS.writeFileSync(NodePath.join(cwd, oldPath), "rename me\n");
      NodeFS.writeFileSync(NodePath.join(cwd, "deleted.txt"), "gone\n");
      NodeFS.writeFileSync(NodePath.join(cwd, "modified.txt"), "before\n");
      NodeFS.writeFileSync(NodePath.join(cwd, "binary.dat"), Buffer.from([0, 1, 2, 3]));
      NodeFS.writeFileSync(NodePath.join(cwd, "mode.sh"), "#!/bin/sh\n");
      const beforeSnapshotOid = yield* commitAll(cwd, "before");

      NodeFS.renameSync(NodePath.join(cwd, oldPath), NodePath.join(cwd, newPath));
      NodeFS.rmSync(NodePath.join(cwd, "deleted.txt"));
      NodeFS.writeFileSync(NodePath.join(cwd, "modified.txt"), "after\n");
      NodeFS.writeFileSync(NodePath.join(cwd, "binary.dat"), Buffer.from([0, 9, 8, 7]));
      NodeFS.chmodSync(NodePath.join(cwd, "mode.sh"), 0o755);
      NodeFS.writeFileSync(NodePath.join(cwd, "added.txt"), "added\n");
      NodeFS.writeFileSync(NodePath.join(cwd, "empty.txt"), "");
      const afterSnapshotOid = yield* commitAll(cwd, "after");

      const changes = yield* enumerateCheckpointChanges({
        cwd,
        beforeSnapshotOid,
        afterSnapshotOid,
      });
      const byPath = new Map(changes.map((change) => [change.path, change]));

      assert.deepStrictEqual(byPath.get("added.txt"), {
        path: "added.txt",
        kind: "added",
        additions: 1,
        deletions: 0,
      });
      assert.deepStrictEqual(byPath.get("empty.txt"), {
        path: "empty.txt",
        kind: "added",
        additions: 0,
        deletions: 0,
      });
      assert.deepStrictEqual(byPath.get("deleted.txt"), {
        path: "deleted.txt",
        kind: "deleted",
        additions: 0,
        deletions: 1,
      });
      assert.deepStrictEqual(byPath.get(newPath), {
        path: newPath,
        previousPath: oldPath,
        kind: "renamed",
        additions: 0,
        deletions: 0,
      });
      assert.deepStrictEqual(byPath.get("binary.dat"), {
        path: "binary.dat",
        kind: "modified",
        additions: 0,
        deletions: 0,
        binary: true,
      });
      assert.deepStrictEqual(byPath.get("mode.sh"), {
        path: "mode.sh",
        kind: "mode-changed",
        additions: 0,
        deletions: 0,
      });
      assert.deepStrictEqual(byPath.get("modified.txt"), {
        path: "modified.txt",
        kind: "modified",
        additions: 1,
        deletions: 1,
      });
    }),
  );

  it.effect("keeps identical relative paths scoped to their repository snapshot pair", () =>
    Effect.gen(function* () {
      const first = yield* makeTmpDir();
      const second = yield* makeTmpDir();
      const capture = Effect.fn("CheckpointChanges.test.captureRepository")(function* (
        cwd: string,
        contents: string,
      ) {
        yield* initializeRepository(cwd);
        NodeFS.writeFileSync(NodePath.join(cwd, "same path.txt"), "before\n");
        const beforeSnapshotOid = yield* commitAll(cwd, "before");
        NodeFS.writeFileSync(NodePath.join(cwd, "same path.txt"), contents);
        const afterSnapshotOid = yield* commitAll(cwd, "after");
        return yield* enumerateCheckpointChanges({ cwd, beforeSnapshotOid, afterSnapshotOid });
      });

      const [firstChanges, secondChanges] = yield* Effect.all([
        capture(first, "first\n"),
        capture(second, "second\nextra\n"),
      ]);
      assert.deepStrictEqual(firstChanges, [
        { path: "same path.txt", kind: "modified", additions: 1, deletions: 1 },
      ]);
      assert.deepStrictEqual(secondChanges, [
        { path: "same path.txt", kind: "modified", additions: 2, deletions: 1 },
      ]);
    }),
  );

  it.effect("returns no files for an unchanged snapshot pair", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTmpDir();
      yield* initializeRepository(cwd);
      NodeFS.writeFileSync(NodePath.join(cwd, "README.md"), "unchanged\n");
      const snapshotOid = yield* commitAll(cwd, "snapshot");
      assert.deepStrictEqual(
        yield* enumerateCheckpointChanges({
          cwd,
          beforeSnapshotOid: snapshotOid,
          afterSnapshotOid: snapshotOid,
        }),
        [],
      );
    }),
  );
});

it.effect("reports truncated structured output as unavailable", () => {
  const layer = Layer.mock(GitVcsDriver.GitVcsDriver)({
    execute: () =>
      Effect.succeed({
        exitCode: ChildProcessSpawner.ExitCode(0),
        stdout: "M\0partial",
        stderr: "",
        stdoutTruncated: true,
        stderrTruncated: false,
      }),
  });
  return Effect.gen(function* () {
    const result = yield* Effect.result(
      enumerateCheckpointChanges({
        cwd: "/repo",
        beforeSnapshotOid: "before",
        afterSnapshotOid: "after",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.instanceOf(result.failure, CheckpointChangesError);
      assert.strictEqual(result.failure.availability, "unavailable");
    }
  }).pipe(Effect.provide(layer));
});
