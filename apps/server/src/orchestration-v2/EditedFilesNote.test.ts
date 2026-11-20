import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  ThreadId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointScope,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import {
  editedFileChange,
  editedFileUndone,
  editedFilesNote,
  editedFilesSince,
  latestTurnCheckpoint,
  readEditedFileChanges,
} from "./EditedFilesNote.ts";
import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);

it("tells the agent only the files the user edited since its last prompt, less those left out", () => {
  const since = at("2026-11-12T10:00:00Z");
  const files = [
    { path: "src/after.ts", editedAt: at("2026-11-12T11:00:00Z") },
    { path: "src/left.ts", editedAt: at("2026-11-12T11:30:00Z") },
    { path: "../outside.ts", editedAt: at("2026-11-12T11:30:00Z") },
    { path: "src/before.ts", editedAt: at("2026-11-12T09:00:00Z") },
  ];
  assert.deepStrictEqual(editedFilesSince(files, since), ["src/after.ts", "src/left.ts"]);
  assert.deepStrictEqual(editedFilesSince(files, since, ["src/left.ts"]), ["src/after.ts"]);
});

it("diffs from the last turn's file, and names the file instead when there is no diff to tell", () => {
  const change = editedFileChange("src/a.ts", "one\ntwo\n", "one\n2\n");
  assert.include(change?.diff ?? "", "--- a/src/a.ts\n+++ b/src/a.ts");
  assert.include(change?.diff ?? "", "-two\n+2");
  assert.strictEqual(change?.lines, 2);
  assert.include(editedFileChange("src/new.ts", null, "x\n")?.diff ?? "", "--- /dev/null");
  // No checkpoint to diff from, or a diff too long to tell: the agent reads the file instead.
  assert.deepStrictEqual(editedFileChange("src/a.ts", undefined, "one\n"), {
    path: "src/a.ts",
    diff: null,
    lines: 1,
  });
  assert.isNull(editedFileChange("src/a.ts", "", "x\n".repeat(5_000))?.diff);
  // The file reads as the last turn left it: nothing to tell.
  assert.isNull(editedFileChange("src/a.ts", "one\n", "one\n"));

  const note = editedFilesNote([
    change!,
    { path: "src/big.ts", diff: null, lines: 5_000 },
    { path: "src/gone.ts", diff: null, lines: null },
  ]);
  assert.include(note ?? "", '<file path="src/a.ts">\n```diff');
  assert.include(note ?? "", '<file path="src/big.ts" lines="5000">');
  assert.include(note ?? "", "Read the file");
  assert.include(note ?? "", '<file path="src/gone.ts">');
  assert.isNull(editedFilesNote([]));
});

it("diffs from the latest finished turn's checkpoint in the checkout", () => {
  const scope = (id: string, cwd: string) =>
    ({ id: CheckpointScopeId.make(id), cwd }) as OrchestrationV2CheckpointScope;
  const checkpoint = (id: string, scopeId: string, appRunOrdinal: number | null) =>
    ({
      id: CheckpointId.make(id),
      threadId: ThreadId.make("thread"),
      scopeId: CheckpointScopeId.make(scopeId),
      nodeId: NodeId.make("node"),
      appRunOrdinal,
      ref: CheckpointRef.make(`refs/t3/${id}`),
      status: "ready",
      capturedAt: at("2026-11-12T10:00:00Z"),
    }) as OrchestrationV2Checkpoint;
  const scopes = [scope("here", "/repo"), scope("elsewhere", "/other")];
  const checkpoints = [
    checkpoint("first", "here", 1),
    checkpoint("second", "here", 2),
    checkpoint("baseline", "here", null),
    checkpoint("current", "here", 3),
    checkpoint("other", "elsewhere", 2),
  ];
  assert.strictEqual(latestTurnCheckpoint(checkpoints, scopes, "/repo", 3)?.id, "second");
  assert.isUndefined(latestTurnCheckpoint(checkpoints, scopes, "/missing", 3));
});

/** A checkout whose files on disk are `files`, at a checkpoint where `src/a.ts` read "one\ntwo\n". */
const checkout = (files: Record<string, string>) => {
  const git = {
    execute: ({ args }: GitVcsDriver.ExecuteGitInput) =>
      Effect.succeed({
        exitCode: 0,
        stdout:
          args[0] === "ls-tree"
            ? args[3] === "./src/a.ts"
              ? "100644 blob abc123\tsrc/a.ts\n"
              : ""
            : "one\ntwo\n",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
  } as unknown as GitVcsDriver.GitVcsDriver["Service"];
  const layer = Layer.merge(
    FileSystem.layerNoop({
      stat: (file) =>
        file in files
          ? Effect.succeed({
              type: "File",
              size: BigInt(10),
            } as unknown as FileSystem.File.Info)
          : Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "stat",
                pathOrDescriptor: file,
              }),
            ),
      readFileString: (file) => Effect.succeed(files[file] ?? ""),
    }),
    Path.layer,
  );
  return { git, layer };
};
const turnCheckpoint = { ref: CheckpointRef.make("refs/t3/turn") } as OrchestrationV2Checkpoint;

it.effect("reads each file now and as the checkpoint had it", () =>
  Effect.gen(function* () {
    const { git, layer } = checkout({ "/repo/src/a.ts": "one\n2\n", "/repo/src/new.ts": "x\n" });
    const changes = yield* readEditedFileChanges(
      {
        cwd: "/repo",
        paths: ["src/a.ts", "src/new.ts", "src/gone.ts"],
        checkpoint: turnCheckpoint,
      },
      git,
    ).pipe(Effect.provide(layer));
    assert.include(changes[0]?.diff ?? "", "-two\n+2");
    assert.include(changes[1]?.diff ?? "", "--- /dev/null");
    // Neither in the checkpoint nor on disk: nothing to tell.
    assert.lengthOf(changes, 2);
  }),
);

it.effect("drops an edit only once the file reads as the last turn left it", () =>
  Effect.gen(function* () {
    const undone = (text: string, checkpoint: OrchestrationV2Checkpoint | undefined) => {
      const { git, layer } = checkout({ "/repo/src/a.ts": text });
      return editedFileUndone({ cwd: "/repo", path: "src/a.ts", checkpoint }, git).pipe(
        Effect.provide(layer),
      );
    };
    assert.isTrue(yield* undone("one\ntwo\n", turnCheckpoint));
    assert.isFalse(yield* undone("one\n2\n", turnCheckpoint));
    // No finished turn to compare with: the edit stands.
    assert.isFalse(yield* undone("one\ntwo\n", undefined));
  }),
);
