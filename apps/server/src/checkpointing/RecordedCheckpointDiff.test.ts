import { assert, it } from "@effect/vitest";
import {
  CheckpointRef,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  type PlanCheckpointRecord,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CheckpointRecordStore } from "../mercurian/planning/CheckpointRecordStore.ts";
import { LegacySessionStore } from "../mercurian/lineRuntimes/LegacySessionStore.ts";
import { LineRuntimeStore } from "../mercurian/lineRuntimes/LineRuntimeStore.ts";
import { LineBranchStore } from "../mercurian/commitTree/LineBranchStore.ts";
import { RepositoryStore } from "../mercurian/repositories/RepositoryStore.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { CheckpointStore, type DiffCheckpointsInput } from "./CheckpointStore.ts";
import { make } from "./CheckpointDiffQuery.ts";

const planId = PlanId.make("plan");
const ownerCommitId = MercurianCommitId.make("act");
const repositoryId = MercurianRepositoryId.make("repo");
const record: PlanCheckpointRecord = {
  planId,
  ownerCommitId,
  projectId: MercurianProjectId.make("project"),
  revision: 1,
  updateSequence: 1,
  capture: {
    terminal: true,
    status: "error",
    partial: true,
    files: [],
    repositories: [
      {
        repositoryId,
        repositoryName: "Repo",
        beforeSnapshotOid: "1".repeat(40),
        afterSnapshotOid: "2".repeat(40),
        files: [],
        captureStatus: "ready",
        summaryStatus: "error",
      },
      { repositoryId: "other", repositoryName: "Other", files: [], captureStatus: "error" },
    ],
  },
};

it.effect(
  "reads a successful member of a partial standalone capture and retries stronger revisions",
  () =>
    Effect.gen(function* () {
      let current: PlanCheckpointRecord | null = null;
      let exists = true;
      const calls: DiffCheckpointsInput[] = [];
      const query = yield* make.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(CheckpointRecordStore)({
              get: (plan, owner) =>
                Effect.sync(() => (plan === planId && owner === ownerCommitId ? current : null)),
            }),
            Layer.mock(LegacySessionStore)({}),
            Layer.mock(LineRuntimeStore)({}),
            Layer.mock(LineBranchStore)({}),
            Layer.mock(ProjectionSnapshotQuery)({}),
            Layer.mock(RepositoryStore)({
              getSnapshot: Effect.succeed({
                repositories: [{ repositoryId, path: "/repo", hasGit: true }],
                projectRepositories: [],
              } as never),
            }),
            Layer.mock(CheckpointStore)({
              hasCheckpointRef: () => Effect.sync(() => exists),
              diffCheckpoints: (input) =>
                Effect.sync(() => {
                  calls.push(input);
                  return "exact patch";
                }),
            }),
          ),
        ),
      );
      const target = { planId, ownerCommitId, repositoryId, checkpointRevision: 0 };
      assert.deepStrictEqual(yield* query.getCheckpointDiff(target), {
        status: "unavailable",
        checkpointRevision: 0,
        reason: "record-missing",
      });
      current = record;
      assert.deepStrictEqual(yield* query.getCheckpointDiff(target), {
        status: "unavailable",
        checkpointRevision: 1,
        reason: "record-changed",
      });
      const saved = { ...target, checkpointRevision: 1 };
      assert.deepStrictEqual(yield* query.getCheckpointDiff(saved), {
        ...saved,
        status: "ready",
        diff: "exact patch",
      });
      assert.deepStrictEqual(calls, [
        {
          cwd: "/repo",
          fromCheckpointRef: CheckpointRef.make("1".repeat(40)),
          toCheckpointRef: CheckpointRef.make("2".repeat(40)),
          fallbackFromToHead: false,
          ignoreWhitespace: false,
        },
      ]);
      assert.strictEqual(
        (yield* query.getCheckpointDiff({
          ...saved,
          repositoryId: MercurianRepositoryId.make("not-captured"),
        })).status,
        "unavailable",
      );
      assert.strictEqual(
        (yield* query.getCheckpointDiff({ ...saved, planId: PlanId.make("other-plan") })).status,
        "unavailable",
      );
      exists = false;
      assert.deepStrictEqual(yield* query.getCheckpointDiff(saved), {
        status: "unavailable",
        checkpointRevision: 1,
        reason: "snapshot-missing",
      });
      current = {
        ...record,
        capture: {
          ...record.capture!,
          repositories: [{ ...record.capture!.repositories![0]!, beforeSnapshotOid: "HEAD" }],
        },
      };
      exists = true;
      assert.strictEqual((yield* query.getCheckpointDiff(saved)).status, "unavailable");
      assert.strictEqual(calls.length, 1);
    }),
);
