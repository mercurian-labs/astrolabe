import { OrchestrationCheckpointFile } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const CheckpointFiles = Schema.Array(OrchestrationCheckpointFile);

export const CheckpointFilesStorage = Schema.Union([
  CheckpointFiles,
  Schema.Struct({
    files: CheckpointFiles,
    partial: Schema.optional(Schema.Boolean),
  }),
]);
export type CheckpointFilesStorage = typeof CheckpointFilesStorage.Type;

export const toCheckpointFilesStorage = (
  files: ReadonlyArray<typeof OrchestrationCheckpointFile.Type>,
  partial?: boolean,
): CheckpointFilesStorage => (partial === undefined ? files : { files, partial });

export const checkpointFilesFromStorage = (stored: CheckpointFilesStorage) =>
  "files" in stored ? stored.files : stored;

export const checkpointPartialFromStorage = (stored: CheckpointFilesStorage) =>
  "files" in stored ? stored.partial : undefined;
