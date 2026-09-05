import * as Path from "effect/Path";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import { WorktreeSlotId } from "../worktreeSlots/schema.ts";
import {
  GitManagerError,
  MemoryMergeReview,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { ProcessRunner } from "../../processRunner.ts";
import { SlotRegistry } from "../worktreeSlots/SlotRegistry.ts";
import { lineSnapshotRef } from "../worktreeSlots/SnapshotChain.ts";

const Approval = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
  lineRootCommitId: MercurianCommitId,
  review: MemoryMergeReview,
  memoryRoot: Schema.String,
  sourceUpdatedAt: Schema.String,
  baseOid: Schema.String,
  reviewIds: Schema.Array(Schema.String),
});
const encodeApproval = Schema.encodeSync(Schema.fromJsonString(Approval));
const decodeApprovalJson = Schema.decodeUnknownSync(Schema.fromJsonString(Approval));
const isGitManagerError = Schema.is(GitManagerError);
export const repositoryExitApproval = (approval: typeof Approval.Type) =>
  `exit:v1:${Buffer.from(encodeApproval(approval)).toString("base64url")}`;
const decodeApproval = (key: string) =>
  decodeApprovalJson(Buffer.from(key.slice(8), "base64url").toString());
const Source = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
  path: Schema.String,
  memoryRoot: Schema.String,
  sourceUpdatedAt: Schema.String,
});
const Branch = Schema.Struct({
  lineRootCommitId: MercurianCommitId,
  branch: Schema.String,
  baseOid: Schema.String,
});

/** App-mediated repository exits. Provider shells and external Git processes are outside this boundary. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const runner = yield* ProcessRunner;
  const registry = yield* SlotRegistry;
  const sources = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Source,
    execute: () => sql`
    SELECT s.project_id AS "projectId", s.repository_id AS "repositoryId", r.path,
      coalesce(s.subpath, '') AS "memoryRoot", s.updated_at AS "sourceUpdatedAt"
    FROM project_storage_sources s JOIN repositories r ON r.repository_id = s.repository_id
    WHERE s.kind = 'memory' AND (s.subpath IS NOT NULL OR EXISTS (
      SELECT 1 FROM project_repositories p WHERE p.project_id = s.project_id AND p.repository_id = s.repository_id
    ))
  `,
  });
  const branches = SqlSchema.findAll({
    Request: MercurianRepositoryId,
    Result: Branch,
    execute: (id) => sql`
    SELECT line_root_commit_id AS "lineRootCommitId", branch, base_oid AS "baseOid" FROM line_branches WHERE repository_id = ${id}
  `,
  });
  const slotRows = SqlSchema.findAll({
    Request: MercurianCommitId,
    Result: Schema.Struct({ slotId: WorktreeSlotId }),
    execute: (id) => sql`
      SELECT slot_id AS "slotId" FROM worktree_slots WHERE current_line_root_commit_id = ${id}
    `,
  });
  const reviewRows = SqlSchema.findAll({
    Request: Schema.Struct({
      repositoryId: MercurianRepositoryId,
      lineRootCommitId: MercurianCommitId,
    }),
    Result: Schema.Struct({ key: Schema.String }),
    execute: (i) => sql`
      SELECT commit_oid AS key FROM memory_amendment_reviews
      WHERE repository_id = ${i.repositoryId} AND line_root_commit_id = ${i.lineRootCommitId}
    `,
  });
  const run = Effect.fn("MemoryRepositoryExitGate.git")(function* (
    cwd: string,
    args: readonly string[],
  ) {
    const result = yield* runner.run({ command: "git", args: ["-C", cwd, ...args] });
    if (result.code !== 0)
      return yield* new GitManagerError({
        operation: "memoryRepositoryExit",
        cwd,
        detail: result.stderr,
      });
    return result.stdout.trim();
  });
  const fail = (cwd: string) =>
    new GitManagerError({
      operation: "memoryRepositoryExit",
      cwd,
      detail:
        "Review this repository's current memory changes and confirm Merge home before pushing or publishing a PR. Commit pending work first; an optional commit invalidates the previous approval.",
    });
  const matching = Effect.fn("MemoryRepositoryExitGate.matching")(function* (cwd: string) {
    const all = yield* sources(undefined);
    if (!all.length) return [];
    // Ask only the addressed repository for its registered worktrees. A missing
    // source checkout still matches its linked worktrees; unrelated offline roots
    // never need a Git subprocess and cannot prevent this repository's exit.
    const listing = yield* run(cwd, ["worktree", "list", "--porcelain", "-z"]);
    const canonical = (value: string): Effect.Effect<string> =>
      fs.realPath(value).pipe(
        Effect.catch(() => {
          // Resolve the nearest surviving ancestor too: on macOS /var and /private/var
          // remain aliases after a registered worktree itself has disappeared.
          const absolute = path.resolve(value);
          const parent = path.dirname(absolute);
          return parent === absolute
            ? Effect.succeed(absolute)
            : canonical(parent).pipe(
                Effect.map((root) => path.join(root, path.basename(absolute))),
              );
        }),
      );
    const roots = yield* Effect.forEach(
      listing.split("\0").filter((field) => field.startsWith("worktree ")),
      (field) => canonical(field.slice(9)),
    );
    return yield* Effect.filter(all, (source) =>
      canonical(source.path).pipe(Effect.map((root) => roots.includes(root))),
    );
  });
  const check = Effect.fn("MemoryRepositoryExitGate.check")(function* (
    cwd: string,
    target?: { branch: string; headOid: string },
  ) {
    for (const source of yield* matching(cwd)) {
      const branchName =
        target?.branch ?? (yield* run(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]));
      const line = (yield* branches(source.repositoryId)).find((b) => b.branch === branchName);
      if (!line)
        return yield* new GitManagerError({
          operation: "memoryRepositoryExit",
          cwd,
          detail:
            "App push and PR publishing are unavailable from an unregistered branch (including main) in a shared memory repository. Use a registered line and review its memory changes, or use external Git outside the app review boundary.",
        });
      for (const slot of yield* slotRows(line.lineRootCommitId)) {
        const lease = yield* registry.lease(slot.slotId);
        if (Option.isSome(lease) && lease.value.holders.some((h) => h.kind === "turn"))
          return yield* fail(cwd);
      }
      const rows = (yield* reviewRows({
        repositoryId: source.repositoryId,
        lineRootCommitId: line.lineRootCommitId,
      })).map((r) => r.key);
      const reviewIds = rows.filter((r) => !r.startsWith("exit:")).sort();
      const headOid = yield* run(cwd, ["rev-parse", `refs/heads/${line.branch}`]);
      if (target && target.headOid !== headOid) return yield* fail(cwd);
      const treeOid = yield* run(cwd, ["rev-parse", `${headOid}^{tree}`]);
      // Push transports commits only. Pending work must be committed, captured and reviewed again.
      if (!target && (yield* run(cwd, ["status", "--porcelain", "--untracked-files=all"])))
        return yield* fail(cwd);
      let approved = false;
      for (const row of rows.filter((r) => r.startsWith("exit:v1:"))) {
        const approval = yield* Effect.try({
          try: () => decodeApproval(row),
          catch: () => fail(cwd),
        });
        if (
          approval.sourceUpdatedAt !== source.sourceUpdatedAt ||
          approval.baseOid !== line.baseOid ||
          approval.projectId !== source.projectId ||
          approval.repositoryId !== source.repositoryId ||
          approval.lineRootCommitId !== line.lineRootCommitId ||
          approval.memoryRoot !== source.memoryRoot ||
          approval.reviewIds.length !== reviewIds.length ||
          approval.reviewIds.some((id, i) => id !== reviewIds[i])
        )
          continue;
        const r = approval.review;
        if (r.headOid !== headOid || r.treeOid !== treeOid || r.unreviewedIds.length) continue;
        const snapshot = yield* runner.run({
          command: "git",
          args: [
            "-C",
            cwd,
            "rev-parse",
            "--verify",
            "--quiet",
            lineSnapshotRef(line.lineRootCommitId),
          ],
        });
        if ((snapshot.code === 0 ? snapshot.stdout.trim() : null) !== r.snapshotOid) continue;
        if ((yield* run(cwd, ["rev-parse", r.homeRef])) !== r.homeOid) continue;
        approved = true;
        break;
      }
      if (!approved) return yield* fail(cwd);
    }
  });
  const normalize = (cwd: string) => (cause: unknown) =>
    isGitManagerError(cause)
      ? cause
      : new GitManagerError({
          operation: "memoryRepositoryExit",
          cwd,
          detail: "Could not validate the memory review for this repository exit.",
          cause,
        });
  const withLock = <A, E, R>(cwd: string, effect: Effect.Effect<A, E, R>) =>
    matching(cwd).pipe(
      Effect.mapError(normalize(cwd)),
      Effect.flatMap((matches) =>
        [...new Set(matches.map((s) => s.projectId))]
          .sort()
          .reduceRight((locked, projectId) => registry.withProjectLock(projectId, locked), effect),
      ),
    );
  return {
    checkRemoteAction: (cwd: string, action: "merge" | "enable-auto-merge" | "revert" = "merge") =>
      matching(cwd).pipe(
        Effect.flatMap((matches) =>
          matches.length
            ? Effect.fail(
                new GitManagerError({
                  operation: "memoryRepositoryExit",
                  cwd,
                  detail:
                    action === "revert"
                      ? "Host revert publishes a new remote commit and PR that this memory review has not approved. Create and review the inverse on a local line before publishing it."
                      : "This host action cannot bind memory approval to an immutable remote head. Merge and auto-merge are unavailable for this shared memory repository.",
                }),
              )
            : Effect.void,
        ),
        Effect.mapError(normalize(cwd)),
      ),
    check: (cwd: string, target?: { branch: string; headOid: string }) =>
      check(cwd, target).pipe(Effect.asVoid, Effect.mapError(normalize(cwd))),
    withLock,
    withExit: <A, E, R>(
      cwd: string,
      effect: Effect.Effect<A, E, R>,
      target?: { branch: string; headOid: string },
    ) =>
      withLock(
        cwd,
        check(cwd, target).pipe(Effect.mapError(normalize(cwd)), Effect.andThen(effect)),
      ),
  };
});
export class MemoryRepositoryExitGate extends Context.Service<
  MemoryRepositoryExitGate,
  Effect.Success<typeof make>
>()("t3/mercurian/memory/MemoryRepositoryExitGate") {}
export const layer = Layer.effect(MemoryRepositoryExitGate, make);
