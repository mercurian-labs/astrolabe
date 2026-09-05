import {
  MercurianRepositoryId,
  type OrchestrationCheckpointFile,
  type OrchestrationCheckpointRepository,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  CheckpointFilesStorage,
  checkpointFilesFromStorage,
  checkpointRepositoriesFromStorage,
  checkpointSummaryErrorFromStorage,
  checkpointSummaryStatusFromStorage,
  toCheckpointFilesStorage,
} from "./CheckpointFilesStorage.ts";

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(CheckpointFilesStorage));

it("decodes legacy flat checkpoint file arrays without inventing availability", () => {
  const stored = decodeJson(
    JSON.stringify([{ path: "README.md", kind: "modified", additions: 1, deletions: 0 }]),
  );
  assert.deepStrictEqual(checkpointFilesFromStorage(stored), [
    { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
  ]);
  assert.strictEqual(checkpointRepositoriesFromStorage(stored), undefined);
  assert.strictEqual(checkpointSummaryStatusFromStorage(stored), undefined);
  assert.strictEqual(checkpointSummaryErrorFromStorage(stored), undefined);
});

it("round trips repository snapshot facts and exact raw paths through the JSON envelope", () => {
  const files: ReadonlyArray<OrchestrationCheckpointFile> = [
    {
      path: " new 路径.txt ",
      previousPath: " old ü.txt ",
      kind: "renamed",
      additions: 2,
      deletions: 1,
      beforeDocumentRole: "plan",
      afterDocumentRole: "spec",
    },
  ];
  const repositories: ReadonlyArray<OrchestrationCheckpointRepository> = [
    {
      repositoryId: MercurianRepositoryId.make("repository-1"),
      repositoryName: "code",
      files,
      beforeSnapshotOid: "1111111111111111111111111111111111111111",
      afterSnapshotOid: "2222222222222222222222222222222222222222",
      branchName: "mercurian/line",
      branchTipOid: "3333333333333333333333333333333333333333",
      captureStatus: "ready",
      summaryStatus: "ready",
      branchMovement: { kind: "unchanged" },
    },
  ];
  const encoded = toCheckpointFilesStorage(
    files,
    false,
    "settled",
    undefined,
    { kind: "unchanged" },
    repositories,
    "error",
    "another repository summary failed",
  );
  const stored = decodeJson(JSON.stringify(encoded));

  assert.deepStrictEqual(checkpointFilesFromStorage(stored), files);
  assert.deepStrictEqual(checkpointRepositoriesFromStorage(stored), repositories);
  assert.strictEqual(checkpointSummaryStatusFromStorage(stored), "error");
  assert.strictEqual(
    checkpointSummaryErrorFromStorage(stored),
    "another repository summary failed",
  );
});
