import { BranchMovement, OrchestrationCheckpointFile, SnapshotKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const CheckpointFiles = Schema.Array(OrchestrationCheckpointFile);

export const CheckpointFilesStorage = Schema.Union([
  CheckpointFiles,
  Schema.Struct({
    files: CheckpointFiles,
    partial: Schema.optional(Schema.Boolean),
    snapshotKind: Schema.optional(SnapshotKind),
    departedRef: Schema.optional(Schema.String),
    branchMovement: Schema.optional(BranchMovement),
  }),
]);
export type CheckpointFilesStorage = typeof CheckpointFilesStorage.Type;

export const toCheckpointFilesStorage = (
  files: ReadonlyArray<OrchestrationCheckpointFile>,
  partial?: boolean,
  snapshotKind?: SnapshotKind,
  departedRef?: string,
  branchMovement?: BranchMovement,
): CheckpointFilesStorage =>
  partial === undefined &&
  snapshotKind === undefined &&
  departedRef === undefined &&
  branchMovement === undefined
    ? files
    : {
        files,
        ...(partial === undefined ? {} : { partial }),
        ...(snapshotKind === undefined ? {} : { snapshotKind }),
        ...(departedRef === undefined ? {} : { departedRef }),
        ...(branchMovement === undefined ? {} : { branchMovement }),
      };

export const checkpointFilesFromStorage = (stored: CheckpointFilesStorage) =>
  "files" in stored ? stored.files : stored;

export const checkpointPartialFromStorage = (stored: CheckpointFilesStorage) =>
  "files" in stored ? stored.partial : undefined;

export const checkpointSnapshotKindFromStorage = (stored: CheckpointFilesStorage) =>
  "files" in stored ? stored.snapshotKind : undefined;

export const checkpointDepartedRefFromStorage = (stored: CheckpointFilesStorage) =>
  "files" in stored ? stored.departedRef : undefined;

export const checkpointBranchMovementFromStorage = (stored: CheckpointFilesStorage) =>
  "files" in stored ? stored.branchMovement : undefined;
