import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import {
  CheckpointScopeId,
  ThreadId,
  VcsBaseTextError,
  type OrchestrationV2DomainEvent,
  type VcsBaseTextInput,
  type VcsBaseTextResult,
} from "@t3tools/contracts";

import { checkpointRefForScopeOrdinal } from "../orchestration-v2/CheckpointService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "./VcsStatusBroadcaster.ts";

// The same limit as reading the file itself: a file bigger than this opens read only.
const BASE_TEXT_MAX_BYTES = 1024 * 1024;
const EMPTY_BLOB_ID = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
// Runs that have started and not yet settled; `waiting` includes waiting for their checkpoint.
const UNSETTLED_RUN_STATUSES = ["starting", "running", "waiting"];

/**
 * Astrolabe: the text an open file's change markers compare against, read once and again as it
 * changes: its committed text (`head`), or the file at the start of the latest turn in its
 * checkout that changed it (`turn`).
 */
export class VcsBaseText extends Context.Service<
  VcsBaseText,
  {
    readonly read: (input: VcsBaseTextInput) => Effect.Effect<VcsBaseTextResult, VcsBaseTextError>;
    /**
     * The base text now, then each time it changes: for `head` on a status change that gives the
     * file another commit, for `turn` as turns in the checkout start, write the file, and end.
     */
    readonly stream: (
      input: VcsBaseTextInput,
    ) => Stream.Stream<VcsBaseTextResult, VcsBaseTextError>;
  }
>()("t3/vcs/VcsBaseText") {}

/** Events that can change which turn last changed a file in the checkout, or the file itself. */
function touchesTurns(
  event: OrchestrationV2DomainEvent,
  cwd: string,
  threads: ReadonlySet<string>,
): boolean {
  if (event.type === "checkpoint-scope.created") return event.payload.cwd === cwd;
  if (!threads.has(event.threadId)) return false;
  switch (event.type) {
    case "run.created":
    case "run.updated":
    case "checkpoint.captured":
    case "checkpoint.rollback-requested":
      return true;
    case "turn-item.updated":
      return (
        event.payload.status === "completed" &&
        (event.payload.type === "file_change" || event.payload.type === "command_execution")
      );
    default:
      return false;
  }
}

function sameBase(a: VcsBaseTextResult, b: VcsBaseTextResult): boolean {
  return (
    a?.hash === b?.hash &&
    a?.turn?.threadId === b?.turn?.threadId &&
    a?.turn?.running === b?.turn?.running
  );
}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const statusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const threadManagement = yield* ThreadManagement.ThreadManagementService;
  const sql = yield* SqlClient.SqlClient;
  const digest = yield* Digest.Digest;

  const failure = (input: VcsBaseTextInput, detail: string) => (cause: unknown) =>
    new VcsBaseTextError({ cwd: input.cwd, path: input.path, detail, cause });

  const runGit = (input: VcsBaseTextInput, operation: string, args: ReadonlyArray<string>) =>
    git
      .execute({
        operation: `VcsBaseText.${operation}`,
        cwd: input.cwd,
        args,
        allowNonZeroExit: true,
        maxOutputBytes: BASE_TEXT_MAX_BYTES + 1,
      })
      .pipe(Effect.mapError(failure(input, "Git could not read it.")));

  const assertKnown = (input: VcsBaseTextInput) =>
    knownWorkspaces
      .assertContains(input.cwd)
      .pipe(Effect.mapError(failure(input, "Not a known workspace.")));

  /** The base's blob id, or null when the file has no base (untracked, or no repository). */
  const blobId = Effect.fn("VcsBaseText.blobId")(function* (input: VcsBaseTextInput) {
    yield* assertKnown(input);
    // `./` makes the path relative to `cwd`, not to the repository's root.
    const result = yield* runGit(input, "blobId", [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `HEAD:./${input.path}`,
    ]);
    const id = result.stdout.trim();
    return result.exitCode === 0 && id.length > 0 ? id : null;
  });

  const readBlob = Effect.fn("VcsBaseText.readBlob")(function* (
    input: VcsBaseTextInput,
    id: string | null,
  ) {
    if (id === null) return null;
    if (id === EMPTY_BLOB_ID) return { text: "", hash: id };
    const size = yield* runGit(input, "size", ["cat-file", "-s", id]);
    if (size.exitCode !== 0 || Number(size.stdout.trim()) > BASE_TEXT_MAX_BYTES) return null;
    const blob = yield* runGit(input, "text", ["cat-file", "blob", id]);
    if (blob.exitCode !== 0 || blob.stdout.includes("\0")) return null;
    return { text: blob.stdout, hash: id };
  });

  /** The file's blob id at the start of a scope's turn: null when the turn created it. */
  const startBlobId = Effect.fn("VcsBaseText.startBlobId")(function* (
    input: VcsBaseTextInput,
    scopeId: string,
    ordinal: number,
  ) {
    const ref = yield* checkpointRefForScopeOrdinal({
      scopeId: CheckpointScopeId.make(scopeId),
      ordinalWithinScope: Math.max(0, ordinal - 1),
    }).pipe(Effect.provideService(Digest.Digest, digest));
    const result = yield* runGit(input, "startBlobId", ["ls-tree", ref, "--", `./${input.path}`]);
    // The checkpoint was never captured, or was deleted.
    if (result.exitCode !== 0) return undefined;
    const [mode, type, id] = result.stdout.split("\t")[0]?.split(" ") ?? [];
    return mode !== undefined && type === "blob" && id !== undefined ? id : null;
  });

  /** The file's blob id on disk, null when it is not there. */
  const fileBlobId = Effect.fn("VcsBaseText.fileBlobId")(function* (input: VcsBaseTextInput) {
    const result = yield* runGit(input, "fileBlobId", ["hash-object", "--", `./${input.path}`]);
    const id = result.stdout.trim();
    return result.exitCode === 0 && id.length > 0 ? id : null;
  });

  /**
   * The `turn` base and the threads with turns in the checkout. A running turn wins once the file
   * differs from how it started; otherwise the turn whose checkpoint last listed the file.
   */
  const resolveTurn = Effect.fn("VcsBaseText.resolveTurn")(function* (input: VcsBaseTextInput) {
    yield* assertKnown(input);
    const queryFailure = failure(input, "Could not read the checkout's turns.");
    const scopes = yield* sql<{ readonly scope_id: string; readonly thread_id: string }>`
      SELECT scope.scope_id, scope.thread_id
      FROM orchestration_v2_projection_checkpoint_scopes AS scope
      JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = scope.thread_id
      WHERE thread.deleted_at IS NULL AND json_extract(scope.payload_json, '$.cwd') = ${input.cwd}
    `.pipe(Effect.mapError(queryFailure));
    const threads: ReadonlySet<string> = new Set(scopes.map((scope) => scope.thread_id));
    if (scopes.length === 0) return { base: null, threads };
    const scopeIds = scopes.map((scope) => scope.scope_id);

    const running = yield* sql<{
      readonly thread_id: string;
      readonly scope_id: string;
      readonly ordinal: number;
    }>`
      SELECT run.thread_id, json_extract(node.payload_json, '$.checkpointScopeId') AS scope_id,
        run.ordinal
      FROM orchestration_v2_projection_runs AS run
      JOIN orchestration_v2_projection_nodes AS node
        ON node.node_id = json_extract(run.payload_json, '$.rootNodeId')
      WHERE run.thread_id IN ${sql.in([...threads])}
        AND run.status IN ${sql.in(UNSETTLED_RUN_STATUSES)}
        -- Upstream no longer fills the node's checkpoint_scope_id column.
        AND json_extract(node.payload_json, '$.checkpointScopeId') IN ${sql.in(scopeIds)}
      ORDER BY json_extract(run.payload_json, '$.startedAt') DESC, run.requested_at DESC
    `.pipe(Effect.mapError(queryFailure));
    if (running.length > 0) {
      const fileHash = yield* fileBlobId(input);
      for (const run of running) {
        const start = yield* startBlobId(input, run.scope_id, run.ordinal);
        if (start === undefined || start === fileHash) continue;
        const text = yield* readBlob(input, start ?? EMPTY_BLOB_ID);
        if (text === null) return { base: null, threads };
        const turn = { threadId: ThreadId.make(run.thread_id), running: true };
        return { base: { ...text, turn }, threads };
      }
    }

    const [changed] = yield* sql<{
      readonly thread_id: string;
      readonly scope_id: string;
      readonly ordinal: number;
    }>`
      SELECT checkpoint.thread_id, checkpoint.scope_id, checkpoint.ordinal_within_scope AS ordinal
      FROM orchestration_v2_projection_checkpoints AS checkpoint
      WHERE checkpoint.scope_id IN ${sql.in(scopeIds)}
        AND checkpoint.status = 'ready'
        AND checkpoint.run_id IS NOT NULL
        AND checkpoint.ordinal_within_scope > 0
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_runs AS run
          WHERE run.run_id = checkpoint.run_id AND run.status = 'rolled_back'
        )
        AND EXISTS (
          SELECT 1 FROM json_each(checkpoint.payload_json, '$.files') AS file
          WHERE json_extract(file.value, '$.path') = ${input.path}
        )
      ORDER BY checkpoint.captured_at DESC
      LIMIT 1
    `.pipe(Effect.mapError(queryFailure));
    if (changed === undefined) return { base: null, threads };
    const start = yield* startBlobId(input, changed.scope_id, changed.ordinal);
    if (start === undefined) return { base: null, threads };
    const text = yield* readBlob(input, start ?? EMPTY_BLOB_ID);
    if (text === null) return { base: null, threads };
    const turn = { threadId: ThreadId.make(changed.thread_id), running: false };
    return { base: { ...text, turn }, threads };
  });

  const read: VcsBaseText["Service"]["read"] = Effect.fn("VcsBaseText.read")(function* (input) {
    if (input.base === "turn") return (yield* resolveTurn(input)).base;
    return yield* readBlob(input, yield* blobId(input));
  });

  const headStream = (input: VcsBaseTextInput) =>
    statusBroadcaster.streamStatus({ cwd: input.cwd, includeRemote: false }).pipe(
      Stream.mapError(failure(input, "The checkout's status stopped.")),
      Stream.filter((event) => event._tag !== "remoteUpdated"),
      Stream.mapEffect(() => blobId(input)),
      Stream.changes,
      Stream.mapEffect((id) => readBlob(input, id)),
    );

  const turnStream = (input: VcsBaseTextInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const threads = yield* Ref.make<ReadonlySet<string>>(new Set());
        const resolve = resolveTurn(input).pipe(
          Effect.tap((resolved) => Ref.set(threads, resolved.threads)),
          Effect.map((resolved) => resolved.base),
        );
        const changes = threadManagement.streamDomainEvents.pipe(
          Stream.mapError(failure(input, "The checkout's turns stopped.")),
          Stream.filterEffect((event) =>
            Ref.get(threads).pipe(Effect.map((ids) => touchesTurns(event, input.cwd, ids))),
          ),
        );
        return Stream.concat(Stream.make(null), changes).pipe(
          Stream.mapEffect(() => resolve),
          Stream.changesWith(sameBase),
        );
      }),
    );

  const stream: VcsBaseText["Service"]["stream"] = (input) =>
    input.base === "turn" ? turnStream(input) : headStream(input);

  return VcsBaseText.of({ read, stream });
});

export const layer = Layer.effect(VcsBaseText, make);
