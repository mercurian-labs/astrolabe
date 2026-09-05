import { assert, it } from "@effect/vitest";
import {
  MercurianCommitId,
  MercurianProjectId,
  MessageId,
  PlanId,
  ThreadId,
  type PlanCheckpointRecord,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { CommitId, HistoryId } from "../commitTree/schema.ts";
import type { PlanDetail } from "./PlanningStore.ts";
import { checkpointForkParent, recordedCheckpointAt } from "./checkpointTargets.ts";

const record: PlanCheckpointRecord = {
  ownerCommitId: MercurianCommitId.make("query-A"),
  planId: PlanId.make("plan"),
  projectId: MercurianProjectId.make("project"),
  request: {
    threadId: ThreadId.make("original"),
    messageId: MessageId.make("query-A"),
    state: "unknown",
  },
  revision: 1,
  updateSequence: 1,
  capture: {
    status: "ready",
    terminal: true,
    partial: true,
    files: [],
    repositories: ["code", "docs"].map((repositoryId) => ({
      repositoryId,
      repositoryName: repositoryId,
      captureStatus: "ready",
      summaryStatus: "error",
      files: [],
      beforeSnapshotOid: "1".repeat(40),
      afterSnapshotOid: "2".repeat(40),
      branchTipOid: "3".repeat(40),
    })),
  },
};

for (const partial of [true, false])
  it.effect(`forks a terminal capture without a reply (partial: ${partial}) at its owner`, () =>
    Effect.gen(function* () {
      const saved = { ...record, capture: { ...record.capture!, partial } };
      assert.strictEqual(yield* checkpointForkParent(saved, saved.revision), saved.ownerCommitId);
      assert.strictEqual(saved.request?.state, "unknown");
      assert.strictEqual(saved.responseCommitId, undefined);
    }),
  );

it.effect("selects the exact response when already attached", () =>
  Effect.gen(function* () {
    const saved = { ...record, responseCommitId: MercurianCommitId.make("reply-A") };
    assert.strictEqual(yield* checkpointForkParent(saved, saved.revision), saved.responseCommitId);
  }),
);

for (const [reason, capture] of [
  ["nonterminal", { ...record.capture!, terminal: false }],
  ["missing repositories", { ...record.capture!, repositories: undefined }],
  ["empty repositories", { ...record.capture!, repositories: [] }],
  [
    "failed member",
    {
      ...record.capture!,
      repositories: record.capture!.repositories!.map((member, i) =>
        i === 0 ? member : { ...member, captureStatus: "error" as const },
      ),
    },
  ],
  [
    "missing snapshot",
    {
      ...record.capture!,
      repositories: record.capture!.repositories!.map((member, i) =>
        i === 0 ? member : { ...member, afterSnapshotOid: undefined },
      ),
    },
  ],
  [
    "mutable HEAD",
    {
      ...record.capture!,
      repositories: record.capture!.repositories!.map((member) => ({
        ...member,
        branchTipOid: "HEAD",
      })),
    },
  ],
  [
    "duplicate member",
    {
      ...record.capture!,
      repositories: [record.capture!.repositories![0]!, record.capture!.repositories![0]!],
    },
  ],
] as const)
  it.effect(`rejects an unanswered captured turn with ${reason}`, () =>
    Effect.gen(function* () {
      const failure = yield* checkpointForkParent({ ...record, capture }, record.revision).pipe(
        Effect.flip,
      );
      assert.strictEqual(failure._tag, "HistoricalCheckpointUnavailable");
    }),
  );

it("keeps owner lookup after response attachment and respects the selected carrying parent", () => {
  const createdAt = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
  const previous = { ...record, ownerCommitId: MercurianCommitId.make("earlier") };
  const attached = { ...record, responseCommitId: MercurianCommitId.make("reply-A"), revision: 2 };
  const later = { ...record, ownerCommitId: MercurianCommitId.make("query-B") };
  const detail: PlanDetail = {
    plan: {
      planId: record.planId,
      projectId: record.projectId,
      historyId: HistoryId.make("history"),
      title: "History",
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
    },
    planText: "",
    spec: null,
    snapshotSequence: 6,
    codingSessions: [],
    lineRuntimes: [],
    checkpoints: [previous, attached, later],
    timeline: (
      [
        ["earlier", []],
        ["query-A", ["earlier"]],
        ["query-B", ["query-A"]],
        ["reply-A", ["query-A"]],
        ["fork-query", ["query-A"]],
        ["merge", ["query-A", "query-B"]],
      ] as const
    ).map(([id, parents], index) => ({
      _tag: "message",
      commitId: CommitId.make(id),
      parents: parents.map((parent) => CommitId.make(parent)),
      sequence: index + 1,
      authorKind: "human",
      text: String(id),
      published: false,
      createdAt,
    })),
  };
  assert.strictEqual(recordedCheckpointAt(detail, "query-A"), attached);
  assert.strictEqual(recordedCheckpointAt(detail, "reply-A"), attached);
  assert.strictEqual(recordedCheckpointAt(detail, "fork-query"), attached);
  assert.strictEqual(recordedCheckpointAt(detail, "merge"), attached);
  assert.strictEqual(recordedCheckpointAt(detail, "query-B"), later);
  // Query-edit callers select the query's parent, not its after-snapshot.
  const query = detail.timeline.find((item) => item.commitId === "query-A")!;
  assert.strictEqual(recordedCheckpointAt(detail, query.parents[0]), previous);
  for (const capture of [undefined, { status: "missing" as const, terminal: false, files: [] }]) {
    const empty = { ...attached, capture };
    assert.strictEqual(
      recordedCheckpointAt({ ...detail, checkpoints: [previous, empty, later] }, "merge"),
      previous,
    );
  }
  for (const capture of [
    { status: "error" as const, terminal: true, files: [] },
    { ...attached.capture!, repositories: [] },
    {
      ...attached.capture!,
      repositories: attached.capture!.repositories!.map((member) => ({
        ...member,
        captureStatus: "error" as const,
        afterSnapshotOid: undefined,
      })),
    },
    { ...attached.capture!, terminal: false },
  ]) {
    const incomplete = { ...attached, capture };
    assert.strictEqual(
      recordedCheckpointAt({ ...detail, checkpoints: [previous, incomplete, later] }, "merge"),
      incomplete,
    );
  }
});
