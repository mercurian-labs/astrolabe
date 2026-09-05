import type { GitCommandError } from "@t3tools/contracts";
import type * as PlatformError from "effect/PlatformError";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import * as NodeCrypto from "node:crypto";
import {
  MemoryNotDesignatedError,
  MemoryReadUnavailableError,
  MercurianMemoryError,
  type MercurianProjectId,
  type MemoryLineRef,
  type PlanId,
  type MemoryReadingPosition,
  type MemoryPosition,
  type MemoryUnavailable,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as Option from "effect/Option";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { lineRootCommitIdFor } from "../commitTree/LineBranchReactor.ts";
import { LineBranchStore } from "../commitTree/LineBranchStore.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import { LegacySessionStore } from "../lineRuntimes/LegacySessionStore.ts";
import { resolveThreadLine } from "../lineRuntimes/resolveThreadLine.ts";
import { PlanningStore } from "../planning/PlanningStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { MemorySourceStore } from "./MemorySourceStore.ts";
import { lineSnapshotRef } from "../worktreeSlots/SnapshotChain.ts";

export const makeMemoryLineIdentity = Effect.gen(function* () {
  const lineRuntimes = yield* LineRuntimeStore;
  const legacySessions = yield* LegacySessionStore;
  const planning = yield* PlanningStore;
  const planTurns = yield* PlanTurnRegistry;
  const branches = yield* LineBranchStore;
  const sources = yield* MemorySourceStore;
  const requireSource = Effect.fn("MemoryPosition.requireSource")(function* (
    projectId: MercurianProjectId,
  ) {
    const source = yield* sources.getResolvedSource(projectId);
    if (Option.isNone(source)) return yield* new MemoryNotDesignatedError({ projectId });
    return source.value;
  });
  const lineIdentity = Effect.fn("MemoryIndex.lineIdentity")(function* (input: {
    readonly projectId: MercurianProjectId;
    readonly line: MemoryLineRef;
  }) {
    let planId: PlanId;
    let commitId: string;
    if ("threadId" in input.line) {
      const resolved = yield* resolveThreadLine(lineRuntimes, legacySessions, input.line.threadId);
      if (Option.isSome(resolved) && resolved.value.lineRootCommitId !== null) {
        planId = resolved.value.planId;
        commitId = resolved.value.lineRootCommitId;
      } else {
        const active = yield* planTurns.getByThread(input.line.threadId);
        if (Option.isNone(active)) {
          return yield* new MemoryReadUnavailableError({ reason: "line-missing" });
        }
        planId = active.value.planId;
        commitId = active.value.tipCommitId;
      }
    } else {
      planId = input.line.planId;
      commitId = input.line.commitId;
    }
    const detail = yield* planning.getPlanSnapshot({ planId });
    if (detail.plan.projectId !== input.projectId) {
      return yield* new MercurianMemoryError({
        operation: "readLineMemoryChanges",
        cause: new Error("The thread is not part of this project"),
      });
    }
    const lineRootCommitId = lineRootCommitIdFor(detail, commitId);
    const source = yield* requireSource(input.projectId);
    const branch = yield* branches.get({
      lineRootCommitId,
      repositoryId: source.repositoryId,
    });
    return {
      planId,
      detail,
      lineRootCommitId,
      source,
      branch: Option.getOrNull(branch),
    };
  });

  return lineIdentity;
});
export type MemoryLineContext = Effect.Success<
  ReturnType<Effect.Success<typeof makeMemoryLineIdentity>>
>;

/** Planning DAG ancestry, never wall-clock correspondence. */
export function memoryAncestors(context: MemoryLineContext, commitId: string) {
  const byId = new Map(context.detail.timeline.map((item) => [String(item.commitId), item]));
  const result: (typeof context.detail.timeline)[number][] = [];
  const pending = [commitId];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const item = byId.get(id);
    if (!item) continue;
    result.push(item);
    pending.push(...item.parents);
  }
  return result.sort((a, b) => b.sequence - a.sequence);
}

export const makeMemoryPosition = Effect.gen(function* () {
  const git = yield* GitVcsDriver;
  const projection = yield* ProjectionSnapshotQuery;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolve = Effect.fn("MemoryPosition.object")(function* (cwd: string, ref: string) {
    const r = yield* git.execute({
      operation: "MemoryPosition.object",
      cwd,
      args: ["rev-parse", "--verify", "--quiet", ref],
      allowNonZeroExit: true,
    });
    return r.exitCode === 0 ? r.stdout.trim() : null;
  });
  const read = Effect.fn("MemoryPosition.read")(function* (
    context: MemoryLineContext,
    reading: MemoryReadingPosition,
  ): Effect.fn.Return<
    MemoryPosition | MemoryUnavailable,
    GitCommandError | ProjectionRepositoryError | PlatformError.PlatformError,
    Scope.Scope
  > {
    if (!context.branch) return { kind: "unavailable", reason: "line-missing" };
    const cwd = context.source.repositoryPath;
    const threads = [
      ...new Set([
        ...context.detail.lineRuntimes
          .filter((r) => r.lineRootCommitId === context.lineRootCommitId)
          .map((r) => r.threadId),
        ...context.detail.codingSessions
          .filter(
            (r) => lineRootCommitIdFor(context.detail, r.commitId) === context.lineRootCommitId,
          )
          .map((r) => r.threadId),
      ]),
    ];
    const checkpoints = yield* Effect.forEach(
      threads,
      Effect.fn(function* (threadId: ThreadId) {
        const result = yield* projection.getThreadCheckpointContext(threadId);
        return { threadId, checkpoints: Option.isSome(result) ? result.value.checkpoints : [] };
      }),
    );
    const snapshotRef = lineSnapshotRef(context.lineRootCommitId);
    const chainTip = yield* resolve(cwd, `${snapshotRef}^{commit}`);
    if (!chainTip && checkpoints.some((c) => c.checkpoints.some((p) => p.status === "ready")))
      return { kind: "unavailable", reason: "object-missing" };
    const ownSnapshot = (ref: string) =>
      ref.startsWith(snapshotRef.replace(/\/snapshot$/u, "/snapshots/")) ||
      threads.some((thread) =>
        ref.startsWith(checkpointRefForThreadTurn(thread, 0).replace(/0$/u, "")),
      );
    // The chain boundary preserves the fork's actual inherited tree even if its parent advances.
    let baselineSnapshotOid = chainTip;
    while (baselineSnapshotOid) {
      const info = yield* git.execute({
        operation: "MemoryPosition.baseline",
        cwd,
        args: ["show", "-s", "--format=%P%x00%B", baselineSnapshotOid],
      });
      const [parents = "", message = ""] = info.stdout.split("\0");
      const ref = /ref=(\S+)/u.exec(message)?.[1];
      if (!ref || !ownSnapshot(ref)) break;
      const ids = parents.trim().split(" ");
      baselineSnapshotOid = ids.length > 1 ? ids[0]! : null;
    }
    const latestSnapshot = reading.kind === "latest" ? chainTip : null;
    const baselineTreeOid = yield* resolve(
      cwd,
      `${baselineSnapshotOid ?? context.branch.baseOid}^{tree}`,
    );
    if (!baselineTreeOid) return { kind: "unavailable", reason: "baseline-missing" };
    const checkpointSnapshot = Effect.fn("MemoryPosition.checkpointSnapshot")(function* (
      threadId: ThreadId,
      count: number,
    ) {
      const records = checkpoints.find((c) => c.threadId === threadId)?.checkpoints ?? [];
      const home =
        context.detail.lineRuntimes.find((r) => r.threadId === threadId)?.homeRepositoryId ??
        context.detail.codingSessions.find((r) => r.threadId === threadId)?.repositoryId;
      const candidates = records
        .filter((c) => c.checkpointTurnCount <= count)
        .toSorted((a, b) => b.checkpointTurnCount - a.checkpointTurnCount);
      if (count === 0) {
        const oid = yield* resolve(cwd, `${checkpointRefForThreadTurn(threadId, 0)}^{commit}`);
        return oid
          ? { snapshotOid: oid }
          : ({ kind: "unavailable", reason: "object-missing" } as const);
      }
      for (const candidate of candidates) {
        const oid = yield* resolve(
          cwd,
          `${checkpointRefForThreadTurn(threadId, candidate.checkpointTurnCount)}^{commit}`,
        );
        if (oid) return { snapshotOid: oid };
        const capturedHere = candidate.repositories
          ? candidate.repositories.some((r) => r.repositoryId === context.source.repositoryId)
          : home === undefined || home === context.source.repositoryId;
        if (capturedHere) return { kind: "unavailable", reason: "object-missing" } as const;
      }
      return { snapshotOid: baselineSnapshotOid };
    });
    let snapshotOid: string | null = latestSnapshot;
    let selectedCommit: string | null = null;
    if (reading.kind === "turn") {
      const checkpoint = checkpoints
        .find((c) => c.threadId === reading.threadId)
        ?.checkpoints.find((c) => c.checkpointTurnCount === reading.turnCount);
      if (
        !threads.includes(reading.threadId) ||
        (reading.turnCount !== 0 && (!checkpoint || checkpoint.status !== "ready"))
      )
        return { kind: "unavailable", reason: "checkpoint-missing" };
      const capture = yield* checkpointSnapshot(reading.threadId, reading.turnCount);
      if (capture.kind === "unavailable") return capture;
      snapshotOid = capture.snapshotOid;
      selectedCommit = snapshotOid ? null : context.branch.baseOid;
    } else if (reading.kind === "checkpoint") {
      if (
        lineRootCommitIdFor(context.detail, reading.commitId) !== context.lineRootCommitId ||
        !context.detail.timeline.some((i) => String(i.commitId) === String(reading.commitId))
      )
        return { kind: "unavailable", reason: "checkpoint-missing" };
      for (const item of memoryAncestors(context, reading.commitId)) {
        const all = checkpoints.flatMap((c) =>
          c.checkpoints.map((checkpoint) => ({ threadId: c.threadId, checkpoint })),
        );
        let userMessageId = item._tag === "message" ? item.sourceUserMessageId : undefined;
        // Older unified replies have random planning IDs, but their first-parent path
        // still names the exact human send recorded in projection_turns.pending_message_id.
        if (
          item._tag === "message" &&
          item.authorKind === "assistant" &&
          !item.memoryAmendment &&
          !userMessageId
        ) {
          let parent = item.parents.length === 1 ? item.parents[0] : undefined;
          const seen = new Set<string>();
          while (parent && !seen.has(parent)) {
            seen.add(parent);
            const ancestor = context.detail.timeline.find((entry) => entry.commitId === parent);
            if (!ancestor) break;
            if (ancestor._tag === "message" && ancestor.authorKind === "human") {
              userMessageId = ancestor.commitId;
              break;
            }
            if (
              ancestor._tag === "message" &&
              ancestor.authorKind === "assistant" &&
              !ancestor.memoryAmendment
            )
              break;
            parent = ancestor.parents.length === 1 ? ancestor.parents[0] : undefined;
          }
        }
        const owners = all.filter(
          (c) =>
            c.checkpoint.assistantMessageId === String(item.commitId) ||
            (userMessageId !== undefined && c.checkpoint.userMessageId === String(userMessageId)),
        );
        if (owners.length > 1) return { kind: "unavailable", reason: "checkpoint-missing" };
        const owner = owners[0];
        if (owner) {
          if (owner.checkpoint.status !== "ready")
            return { kind: "unavailable", reason: "checkpoint-missing" };
          const capture = yield* checkpointSnapshot(
            owner.threadId,
            owner.checkpoint.checkpointTurnCount,
          );
          if (capture.kind === "unavailable") return capture;
          snapshotOid = capture.snapshotOid;
          if (!snapshotOid) selectedCommit ??= context.branch.baseOid;
          break;
        }
        if (item._tag === "message" && item.memoryAmendment?.memoryCommitSha) {
          selectedCommit ??= item.memoryAmendment.memoryCommitSha;
          continue;
        }
        if (item._tag === "message" && item.authorKind === "assistant")
          return { kind: "unavailable", reason: "checkpoint-missing" };
        if (String(item.commitId) === String(context.lineRootCommitId)) {
          snapshotOid = baselineSnapshotOid;
          selectedCommit ??= context.branch.baseOid;
          break;
        }
      }
      if (!snapshotOid && !selectedCommit)
        return { kind: "unavailable", reason: "checkpoint-missing" };
    }
    const recordedHeadOid = snapshotOid
      ? ((yield* resolve(cwd, `${snapshotOid}^2`)) ?? (yield* resolve(cwd, `${snapshotOid}^1`)))
      : (selectedCommit ?? (yield* resolve(cwd, `refs/heads/${context.branch.branch}^{commit}`)));
    if (!recordedHeadOid) return { kind: "unavailable", reason: "object-missing" };
    const headOid =
      reading.kind === "latest" && snapshotOid
        ? yield* resolve(cwd, `refs/heads/${context.branch.branch}^{commit}`)
        : (selectedCommit ?? recordedHeadOid);
    let treeOid = yield* resolve(cwd, `${snapshotOid ?? selectedCommit ?? headOid}^{tree}`);
    if (!headOid || !treeOid) return { kind: "unavailable", reason: "object-missing" };
    if (snapshotOid && headOid !== recordedHeadOid) {
      const version = yield* git.gitVersion;
      if (version.major < 2 || (version.major === 2 && version.minor < 38))
        return { kind: "unavailable", reason: "git-too-old" };
      const temp = path.join(
        yield* fs.makeTempDirectoryScoped({ prefix: "memory-position-" }),
        NodeCrypto.randomUUID(),
      );
      const env = { ...process.env, GIT_INDEX_FILE: temp };
      let snapshotTree = treeOid;
      if (context.source.subpath !== null) {
        yield* git.execute({
          operation: "MemoryPosition.scopeBase",
          cwd,
          args: ["read-tree", recordedHeadOid],
          env,
        });
        const oldEntries = yield* git.execute({
          operation: "MemoryPosition.scopePaths",
          cwd,
          args: [
            "ls-tree",
            "-r",
            "--name-only",
            "-z",
            recordedHeadOid,
            "--",
            context.source.subpath,
          ],
        });
        const paths = oldEntries.stdout.split("\0").filter(Boolean);
        if (paths.length)
          yield* git.execute({
            operation: "MemoryPosition.scopeRemove",
            cwd,
            args: ["update-index", "--force-remove", "--", ...paths],
            env,
          });
        const entries = yield* git.execute({
          operation: "MemoryPosition.scopeEntries",
          cwd,
          args: ["ls-tree", "-r", "-z", snapshotOid, "--", context.source.subpath],
        });
        if (entries.stdout)
          yield* git.execute({
            operation: "MemoryPosition.scopeOverlay",
            cwd,
            args: ["update-index", "-z", "--index-info"],
            stdin: entries.stdout,
            env,
          });
        snapshotTree = (yield* git.execute({
          operation: "MemoryPosition.scopeTree",
          cwd,
          args: ["write-tree"],
          env,
        })).stdout.trim();
      }
      // Synthetic siblings force the recorded HEAD as the exact merge base, even after a rewrite.
      // They are unreachable objects; no shared branch, slot or checkout is modified.
      const currentTree = yield* resolve(cwd, `${headOid}^{tree}`);
      const sibling = Effect.fn(function* (tree: string) {
        return (yield* git.execute({
          operation: "MemoryPosition.comparisonParent",
          cwd,
          args: [
            "commit-tree",
            tree,
            "-p",
            recordedHeadOid,
            "-m",
            "t3 immutable memory comparison",
          ],
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "T3 Code",
            GIT_AUTHOR_EMAIL: "t3@localhost",
            GIT_COMMITTER_NAME: "T3 Code",
            GIT_COMMITTER_EMAIL: "t3@localhost",
            GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
            GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
          },
        })).stdout.trim();
      });
      const left = yield* sibling(currentTree!);
      const right = yield* sibling(snapshotTree);
      const merged = yield* git.execute({
        operation: "MemoryPosition.overlay",
        cwd,
        args: ["merge-tree", "--write-tree", left, right],
        allowNonZeroExit: true,
      });
      if (merged.exitCode !== 0) return { kind: "unavailable", reason: "effective-tree-conflict" };
      treeOid = merged.stdout.split("\n")[0]!.trim();
    }
    const captureMessage = snapshotOid
      ? (yield* git.execute({
          operation: "MemoryPosition.captureKind",
          cwd,
          args: ["show", "-s", "--format=%B", snapshotOid],
        })).stdout
      : "";
    const captureKind = /kind=(\S+)/u.exec(captureMessage)?.[1] ?? null;
    return {
      captureKind,
      projectId: context.source.projectId,
      repositoryId: context.source.repositoryId,
      memoryRoot: context.source.subpath ?? "",
      lineRootCommitId: context.lineRootCommitId,
      reading,
      baselineTreeOid,
      baselineSnapshotOid,
      baseCommitOid: context.branch.baseOid,
      snapshotOid,
      treeOid,
      recordedHeadOid,
      headOid,
    };
  });
  return {
    read: (context: MemoryLineContext, reading: MemoryReadingPosition) =>
      read(context, reading).pipe(
        Effect.mapError(
          (cause) => new MercurianMemoryError({ operation: "readMemoryDashboard", cause }),
        ),
      ),
    resolve,
  };
});
