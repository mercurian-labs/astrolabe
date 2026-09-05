import type {
  MercurianCommitId,
  OrchestrationCheckpointDocumentRole,
  OrchestrationCheckpointFile,
  PlanCheckpointRecord,
  PlanTimelineItem,
} from "@t3tools/contracts";

export type CheckpointEffect = "code" | "memory" | "plan" | "spec";

/** Recorded roles are historical facts; current location settings have no part in this read. */
export function checkpointFileEffects(
  file: OrchestrationCheckpointFile,
): ReadonlyArray<CheckpointEffect> {
  const roles = new Set(
    [file.beforeDocumentRole, file.afterDocumentRole].filter((role) => role !== undefined),
  );
  const effects: CheckpointEffect[] = [];
  if (roles.has("plan")) effects.push("plan");
  if (roles.has("spec")) effects.push("spec");
  if (effects.length === 0 && roles.has("memory")) effects.push("memory");
  if (effects.length === 0) effects.push("code");
  return effects;
}

/** Snapshot availability gates historical forks; a failed summary alone does not. */
export function checkpointEffects(record: PlanCheckpointRecord) {
  const capture = record.capture;
  const groups = capture?.repositories;
  const files =
    groups === undefined ? (capture?.files ?? []) : groups.flatMap((group) => group.files);
  const categories = new Set(files.flatMap(checkpointFileEffects));
  const summaryReady =
    capture?.terminal === true &&
    (groups === undefined
      ? capture.summaryStatus === "ready"
      : groups.length > 0 && groups.every((group) => group.summaryStatus === "ready"));
  const snapshotsAvailable =
    capture?.terminal === true &&
    groups !== undefined &&
    groups.length > 0 &&
    groups.every(
      (group) =>
        group.captureStatus === "ready" &&
        group.afterSnapshotOid !== undefined &&
        group.branchTipOid !== undefined,
    );
  const saving =
    capture?.terminal !== true &&
    (["preparing", "submitted", "completed"].includes(record.request?.state ?? "") ||
      (record.request?.state === "interrupted" && record.request.turnId !== undefined));
  const failed =
    record.request?.state === "failed" ||
    (capture?.terminal === true &&
      (capture.status === "error" ||
        groups?.some(
          (group) => group.captureStatus === "error" || group.summaryStatus === "error",
        ) === true));
  return {
    categories: (["code", "memory", "plan", "spec"] as const).filter((category) =>
      categories.has(category),
    ),
    branchMovements:
      groups === undefined
        ? capture?.branchMovement === undefined || capture.branchMovement.kind === "unchanged"
          ? []
          : [{ movement: capture.branchMovement }]
        : groups
            .filter(
              (group) =>
                group.branchMovement !== undefined && group.branchMovement.kind !== "unchanged",
            )
            .map((group) => ({
              repositoryId: group.repositoryId,
              movement: group.branchMovement!,
            })),
    plain:
      summaryReady &&
      categories.size === 0 &&
      capture?.status !== "error" &&
      (capture?.status === "ready" ||
        groups?.every((group) => group.captureStatus === "ready") === true) &&
      (capture?.branchMovement === undefined || capture.branchMovement.kind === "unchanged") &&
      (groups?.every(
        (group) => group.branchMovement === undefined || group.branchMovement.kind === "unchanged",
      ) ??
        true),
    status: {
      saving,
      failed,
      partial: capture?.partial === true,
      unanswered: record.request?.state === "unanswered" || record.request?.state === "cancelled",
      interrupted: record.request?.state === "interrupted" || record.request?.state === "cancelled",
      captureUnknown: capture?.terminal !== true && !saving,
      summaryReady,
      snapshotsAvailable,
    },
  };
}

export interface CheckpointDocumentChange {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly path: string;
  readonly previousPath?: string;
  readonly role: OrchestrationCheckpointDocumentRole;
  readonly kind: string;
  readonly deleted: boolean;
  readonly ownerCommitId: MercurianCommitId;
  readonly carryingCommitId: MercurianCommitId;
  readonly file: OrchestrationCheckpointFile;
}

/**
 * Follow carrying (first-parent) ancestry through the selected position, stopping
 * at the line's fork boundary. Source parents of a merge contribute only its
 * recorded delta. Renames and deletions remain reviewable on that path.
 */
export function checkpointDocumentHistory(input: {
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  readonly records: ReadonlyArray<PlanCheckpointRecord>;
  readonly selectedCommitId: MercurianCommitId;
  readonly lineRootCommitId: MercurianCommitId;
  readonly forkParentCommitId?: MercurianCommitId;
}): ReadonlyArray<CheckpointDocumentChange> {
  const commits = new Map(input.timeline.map((item) => [item.commitId, item]));
  const path: MercurianCommitId[] = [];
  const seen = new Set<MercurianCommitId>();
  let cursor: MercurianCommitId | undefined = input.selectedCommitId;
  while (cursor !== undefined && cursor !== input.forkParentCommitId && !seen.has(cursor)) {
    seen.add(cursor);
    path.push(cursor);
    if (cursor === input.lineRootCommitId) break;
    cursor = commits.get(cursor)?.parents[0];
  }
  if (!path.includes(input.lineRootCommitId)) return [];
  const onPath = new Set(path);
  const byCarrying = new Map<MercurianCommitId, PlanCheckpointRecord[]>();
  for (const record of input.records) {
    if (record.lineRootCommitId !== input.lineRootCommitId) continue;
    const carrying = record.responseCommitId ?? record.ownerCommitId;
    if (!onPath.has(carrying)) continue;
    const peers = byCarrying.get(carrying) ?? [];
    peers.push(record);
    byCarrying.set(carrying, peers);
  }
  const documents = new Map<string, CheckpointDocumentChange>();
  const key = (repository: string, path: string) => JSON.stringify([repository, path]);
  for (const carryingCommitId of path.toReversed()) {
    for (const record of byCarrying.get(carryingCommitId) ?? []) {
      for (const repository of record.capture?.repositories ?? []) {
        for (const file of repository.files) {
          const role = file.afterDocumentRole ?? file.beforeDocumentRole;
          if (role === undefined) continue;
          if (file.previousPath !== undefined)
            documents.delete(key(repository.repositoryId, file.previousPath));
          documents.set(key(repository.repositoryId, file.path), {
            repositoryId: repository.repositoryId,
            repositoryName: repository.repositoryName,
            path: file.path,
            ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
            role,
            kind: file.kind,
            deleted: file.kind === "deleted",
            ownerCommitId: record.ownerCommitId,
            carryingCommitId,
            file,
          });
        }
      }
    }
  }
  return [...documents.values()];
}
