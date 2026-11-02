/**
 * What the server and a code index worker say to each other: a job on stdin, one output line per
 * commit on stdout. Kept apart from the worker's code so the server never loads the parser.
 */
import * as Schema from "effect/Schema";

export const WorkerFile = Schema.Struct({
  path: Schema.String,
  /** The blob the server expects; a file read from disk is stored under its own hash. */
  blob: Schema.String,
  /** The file on disk for an uncommitted file; null to read the blob from git. */
  disk: Schema.NullOr(Schema.String),
});
export type WorkerFile = typeof WorkerFile.Type;

export const WorkerJob = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("parse"),
    db: Schema.String,
    projectId: Schema.String,
    /** Where git reads blobs from: any checkout of the repository. */
    repo: Schema.String,
    maxBytes: Schema.Number,
    files: Schema.Array(WorkerFile),
  }),
  Schema.Struct({
    op: Schema.Literal("delete"),
    db: Schema.String,
    versionIds: Schema.optionalKey(Schema.Array(Schema.Number)),
    projectIds: Schema.optionalKey(Schema.Array(Schema.String)),
    all: Schema.optionalKey(Schema.Boolean),
  }),
]);
export type WorkerJob = typeof WorkerJob.Type;

/** One line of a worker's output: what a commit wrote, or how many versions went. */
export const WorkerOutput = Schema.Union([
  Schema.Struct({
    written: Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        path: Schema.String,
        blob: Schema.String,
        state: Schema.Literals([0, 1]),
        language: Schema.NullOr(Schema.String),
        lines: Schema.Number,
      }),
    ),
  }),
  Schema.Struct({ deleted: Schema.Number }),
]);
export type WorkerOutput = typeof WorkerOutput.Type;
