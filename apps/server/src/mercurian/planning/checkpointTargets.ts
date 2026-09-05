import type { PlanCheckpointRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import type { PlanDetail } from "./PlanningStore.ts";

export class HistoricalCheckpointUnavailable extends Schema.TaggedErrorClass<HistoricalCheckpointUnavailable>()(
  "HistoricalCheckpointUnavailable",
  { reason: Schema.String },
) {}

/** Only immutable object IDs may reach Git through recorded capture facts. */
export const isSnapshotOid = Schema.is(
  Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u)),
);

/** The nearest act on the carrying path, never a merge's other parent or a later runtime tip. */
export function recordedCheckpointAt(detail: PlanDetail, commitId: string | undefined) {
  const byId = new Map(detail.timeline.map((item) => [String(item.commitId), item]));
  const records = new Map<string, PlanCheckpointRecord>();
  for (const record of detail.checkpoints ?? []) {
    // A pending fork can already carry through the owner when a response arrives.
    records.set(record.ownerCommitId, record);
    if (record.responseCommitId !== undefined) records.set(record.responseCommitId, record);
  }
  const visited = new Set<string>();
  let current = commitId;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const record = records.get(current);
    if (record !== undefined) return record;
    current = byId.get(current)?.parents[0];
  }
  return undefined;
}

/** Terminal snapshots survive a lost reply or failed summary; incomplete capture blocks forks. */
export const capturedRepositories = Effect.fn("checkpointTargets.capturedRepositories")(function* (
  record: PlanCheckpointRecord,
) {
  const repositories = record.capture?.repositories;
  if (
    record.capture?.terminal !== true ||
    repositories === undefined ||
    repositories.length === 0 ||
    new Set(repositories.map((repository) => repository.repositoryId)).size !==
      repositories.length ||
    repositories.some(
      (repository) =>
        repository.captureStatus !== "ready" ||
        !isSnapshotOid(repository.afterSnapshotOid) ||
        !isSnapshotOid(repository.branchTipOid),
    )
  ) {
    return yield* new HistoricalCheckpointUnavailable({
      reason: "The selected checkpoint has no complete repository snapshot.",
    });
  }
  return repositories;
});

export const checkpointForkParent = Effect.fn("checkpointTargets.forkParent")(function* (
  record: PlanCheckpointRecord | null,
  revision: number,
) {
  if (record === null || record.revision !== revision) {
    return yield* new HistoricalCheckpointUnavailable({
      reason: "The selected checkpoint changed or is unavailable. Refresh the plan.",
    });
  }
  yield* capturedRepositories(record);
  return record.responseCommitId ?? record.ownerCommitId;
});

/** Preflight the whole saved set before the existing branch/slot path can modify a workspace. */
export const validateCheckpointRestoration = Effect.fn("checkpointTargets.validateRestoration")(
  function* (
    record: PlanCheckpointRecord,
    repositories: ReadonlyArray<{
      readonly repositoryId: string;
      readonly path: string;
      readonly hasGit: boolean;
    }>,
  ) {
    const saved = yield* capturedRepositories(record);
    if (
      saved.length !== repositories.length ||
      repositories.some(
        (repository) =>
          !repository.hasGit ||
          !saved.some((member) => member.repositoryId === repository.repositoryId),
      )
    ) {
      return yield* new HistoricalCheckpointUnavailable({
        reason: "The project's repositories differ from the selected checkpoint.",
      });
    }
    const git = yield* GitVcsDriver;
    for (const member of saved) {
      const repository = repositories.find(
        (candidate) => candidate.repositoryId === member.repositoryId,
      )!;
      for (const oid of [member.branchTipOid!, member.afterSnapshotOid!]) {
        const result = yield* git.execute({
          operation: "checkpointTargets.verifySnapshot",
          cwd: repository.path,
          args: ["cat-file", "-e", `${oid}^{commit}`],
          allowNonZeroExit: true,
        });
        if (result.exitCode !== 0) {
          return yield* new HistoricalCheckpointUnavailable({
            reason: `Saved snapshot for ${member.repositoryName} is missing.`,
          });
        }
      }
    }
  },
);
