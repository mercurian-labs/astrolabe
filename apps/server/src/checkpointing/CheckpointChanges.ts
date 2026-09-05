import { type GitCommandError, type OrchestrationCheckpointFile } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";

const STRUCTURED_DIFF_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const RENAME_SETTING = "--find-renames=50%";

export class CheckpointChangesError extends Schema.TaggedErrorClass<CheckpointChangesError>()(
  "CheckpointChangesError",
  {
    availability: Schema.Literals(["unavailable", "error"]),
    detail: Schema.String,
  },
) {}

interface NameStatusEntry {
  readonly status: string;
  readonly path: string;
  readonly previousPath?: string;
}

interface NumstatEntry {
  readonly path: string;
  readonly previousPath?: string;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

const entryKey = (entry: { readonly path: string; readonly previousPath?: string }) =>
  JSON.stringify([entry.previousPath ?? null, entry.path]);

function nulFields(stdout: string): Array<string> {
  if (stdout.length === 0) return [];
  if (!stdout.endsWith("\0")) {
    throw new Error("Git structured diff output did not end at a NUL field boundary.");
  }
  return stdout.slice(0, -1).split("\0");
}

function parseNameStatus(stdout: string): ReadonlyArray<NameStatusEntry> {
  const fields = nulFields(stdout);
  const entries: Array<NameStatusEntry> = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status === undefined || status.length === 0) {
      throw new Error("Git name-status output contained an empty status.");
    }
    const code = status[0];
    if (code === "R") {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (!previousPath || !path) {
        throw new Error("Git rename output omitted one of its paths.");
      }
      entries.push({ status, path, previousPath });
      continue;
    }
    if (code !== "A" && code !== "D" && code !== "M" && code !== "T") {
      throw new Error(`Unsupported Git name-status code: ${status}`);
    }
    const path = fields[index++];
    if (!path) {
      throw new Error(`Git ${status} output omitted its path.`);
    }
    entries.push({ status, path });
  }
  return entries;
}

function parseCount(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid Git numstat count: ${raw}`);
  }
  return Number(raw);
}

function parseNumstat(stdout: string): ReadonlyArray<NumstatEntry> {
  const fields = nulFields(stdout);
  const entries: Array<NumstatEntry> = [];
  for (let index = 0; index < fields.length;) {
    const header = fields[index++];
    if (header === undefined) {
      throw new Error("Git numstat output ended before an entry header.");
    }
    const firstTab = header.indexOf("\t");
    const secondTab = header.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throw new Error("Git numstat output contained an invalid entry header.");
    }
    const additionsRaw = header.slice(0, firstTab);
    const deletionsRaw = header.slice(firstTab + 1, secondTab);
    const binary = additionsRaw === "-" && deletionsRaw === "-";
    if ((additionsRaw === "-") !== (deletionsRaw === "-")) {
      throw new Error("Git numstat output contained inconsistent binary counts.");
    }
    const additions = binary ? 0 : parseCount(additionsRaw);
    const deletions = binary ? 0 : parseCount(deletionsRaw);
    const inlinePath = header.slice(secondTab + 1);
    if (inlinePath.length > 0) {
      entries.push({ path: inlinePath, additions, deletions, binary });
      continue;
    }
    const previousPath = fields[index++];
    const path = fields[index++];
    if (!previousPath || !path) {
      throw new Error("Git rename numstat output omitted one of its paths.");
    }
    entries.push({ path, previousPath, additions, deletions, binary });
  }
  return entries;
}

function fileKind(
  status: string,
  stats: Pick<NumstatEntry, "additions" | "deletions" | "binary">,
): OrchestrationCheckpointFile["kind"] {
  switch (status[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "T":
      return "type-changed";
    case "M":
      return !stats.binary && stats.additions === 0 && stats.deletions === 0
        ? "mode-changed"
        : "modified";
    default:
      throw new Error(`Unsupported Git name-status code: ${status}`);
  }
}

function combineStructuredDiffs(
  nameStatusStdout: string,
  numstatStdout: string,
): ReadonlyArray<OrchestrationCheckpointFile> {
  const names = parseNameStatus(nameStatusStdout);
  const statsByFile = new Map(parseNumstat(numstatStdout).map((entry) => [entryKey(entry), entry]));
  const files = names.map((entry) => {
    const key = entryKey(entry);
    const stats = statsByFile.get(key);
    if (stats === undefined) {
      throw new Error(`Git numstat output omitted the name-status entry for ${entry.path}.`);
    }
    statsByFile.delete(key);
    return {
      path: entry.path,
      ...(entry.previousPath === undefined ? {} : { previousPath: entry.previousPath }),
      kind: fileKind(entry.status, stats),
      additions: stats.additions,
      deletions: stats.deletions,
      ...(stats.binary ? { binary: true } : {}),
    } satisfies OrchestrationCheckpointFile;
  });
  if (statsByFile.size > 0) {
    throw new Error("Git numstat output contained entries absent from name-status output.");
  }
  return files;
}

export const enumerateCheckpointChanges = Effect.fn("enumerateCheckpointChanges")(
  function* (input: {
    readonly cwd: string;
    readonly beforeSnapshotOid: string;
    readonly afterSnapshotOid: string;
  }): Effect.fn.Return<
    ReadonlyArray<OrchestrationCheckpointFile>,
    GitCommandError | CheckpointChangesError,
    GitVcsDriver
  > {
    const git = yield* GitVcsDriver;
    const commonArgs = [
      "diff",
      "-z",
      RENAME_SETTING,
      input.beforeSnapshotOid,
      input.afterSnapshotOid,
      "--",
    ] as const;
    const [nameStatus, numstat] = yield* Effect.all([
      git.execute({
        operation: "CheckpointChanges.nameStatus",
        cwd: input.cwd,
        args: [commonArgs[0], "--name-status", ...commonArgs.slice(1)],
        maxOutputBytes: STRUCTURED_DIFF_MAX_OUTPUT_BYTES,
        appendTruncationMarker: false,
      }),
      git.execute({
        operation: "CheckpointChanges.numstat",
        cwd: input.cwd,
        args: [commonArgs[0], "--numstat", ...commonArgs.slice(1)],
        maxOutputBytes: STRUCTURED_DIFF_MAX_OUTPUT_BYTES,
        appendTruncationMarker: false,
      }),
    ]);
    if (nameStatus.stdoutTruncated || numstat.stdoutTruncated) {
      return yield* new CheckpointChangesError({
        availability: "unavailable",
        detail: "Git truncated structured checkpoint change output.",
      });
    }
    return yield* Effect.try({
      try: () => combineStructuredDiffs(nameStatus.stdout, numstat.stdout),
      catch: (cause) =>
        new CheckpointChangesError({
          availability: "error",
          detail: String(cause),
        }),
    });
  },
);
