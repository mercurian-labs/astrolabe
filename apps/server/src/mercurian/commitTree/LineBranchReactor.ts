import { MercurianCommitId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { forkParked } from "../../serverActivation.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { buildLineBranchName } from "../lineRuntimes/branch.ts";
import {
  PlanningStore,
  type PlanDetail,
  type PlanTimelineItem,
} from "../planning/PlanningStore.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { MemorySourceStore } from "../memory/MemorySourceStore.ts";
import { projectWorkingRepositories } from "../worktreeSlots/projectWorkingRepositories.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import { makeLineBranchEnsurer } from "./ensureLineBranch.ts";
import { LineBranchStore } from "./LineBranchStore.ts";

const planningItems = (detail: PlanDetail) =>
  detail.timeline.filter((item) => item._tag !== "coding-session");

export function lineRoots(detail: PlanDetail): ReadonlyArray<PlanTimelineItem> {
  const items = planningItems(detail);
  const children = new Map<string, Array<PlanTimelineItem>>();
  for (const item of items) {
    for (const parent of item.parents) {
      const existing = children.get(parent) ?? [];
      existing.push(item);
      children.set(parent, existing);
    }
  }
  const roots: Array<PlanTimelineItem> = items.filter((item) => item.parents.length === 0);
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.sequence - right.sequence);
    roots.push(...siblings.slice(1));
  }
  return roots.toSorted((left, right) => left.sequence - right.sequence);
}

export function lineRootCommitIdFor(detail: PlanDetail, commitId: string): MercurianCommitId {
  const roots = new Set(lineRoots(detail).map((item) => String(item.commitId)));
  const byId = new Map(detail.timeline.map((item) => [String(item.commitId), item]));
  let current = commitId;
  while (!roots.has(current)) {
    const parent = byId.get(current)?.parents[0];
    if (parent === undefined) break;
    current = String(parent);
  }
  return MercurianCommitId.make(current);
}

function ancestorsAt(detail: PlanDetail, commitId: string): ReadonlySet<string> {
  const byId = new Map(detail.timeline.map((item) => [String(item.commitId), item]));
  const seen = new Set<string>();
  const pending = [...(byId.get(commitId)?.parents ?? [])].map(String);
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...(byId.get(next)?.parents ?? []).map(String));
  }
  return seen;
}

/** Ancestor sessions on the line, newest first, with their records. */
function ancestorSessions(detail: PlanDetail, lineRootCommitId: string) {
  const ancestors = ancestorsAt(detail, lineRootCommitId);
  const records = new Map(
    detail.codingSessions.map((session) => [String(session.commitId), session]),
  );
  return detail.timeline
    .filter(
      (item): item is Extract<PlanTimelineItem, { readonly _tag: "coding-session" }> =>
        item._tag === "coding-session" && ancestors.has(String(item.commitId)),
    )
    .toSorted((left, right) => right.sequence - left.sequence)
    .map((item) => ({ item, record: records.get(String(item.commitId)) }));
}

function ancestorLineRuntimes(detail: PlanDetail, lineRootCommitId: string) {
  const ancestors = ancestorsAt(detail, lineRootCommitId);
  const sequenceById = new Map(
    detail.timeline.map((item) => [String(item.commitId), item.sequence]),
  );
  return (detail.lineRuntimes ?? [])
    .filter((runtime) => ancestors.has(String(runtime.lineRootCommitId)))
    .toSorted(
      (left, right) =>
        (sequenceById.get(String(right.lineRootCommitId)) ?? 0) -
        (sequenceById.get(String(left.lineRootCommitId)) ?? 0),
    );
}

// Where a new line's branch starts in a repository: the nearest ancestor
// session's recorded branch tip there. Sessions recorded before project
// scoping carry one repository's facts on the record itself.
function inheritedCommitOid(detail: PlanDetail, lineRootCommitId: string, repositoryId: string) {
  const runtimeOid = ancestorLineRuntimes(detail, lineRootCommitId)
    .map(
      (runtime) =>
        runtime.repositories?.find((repository) => repository.repositoryId === repositoryId)
          ?.branchTipOid,
    )
    .find((oid): oid is string => typeof oid === "string");
  return (
    runtimeOid ??
    ancestorSessions(detail, lineRootCommitId)
      .map(({ item, record }) => {
        const row = record?.repositories?.find(
          (repository) => repository.repositoryId === repositoryId,
        );
        if (row !== undefined) return row.branchTipOid ?? undefined;
        return item.repositoryId === repositoryId ? record?.settledCommitOid : undefined;
      })
      .find((oid): oid is string => typeof oid === "string")
  );
}

// The snapshot a new line lays over its branch: the same ancestor's chain head
// in that repository.
function inheritedSnapshotOid(detail: PlanDetail, lineRootCommitId: string, repositoryId: string) {
  const runtimeOid = ancestorLineRuntimes(detail, lineRootCommitId)
    .map((runtime) => {
      const repository = runtime.repositories?.find(
        (candidate) => candidate.repositoryId === repositoryId,
      );
      if (repository !== undefined) return repository.snapshotOid ?? undefined;
      return runtime.homeRepositoryId === repositoryId
        ? (runtime.snapshotOid ?? undefined)
        : undefined;
    })
    .find((oid): oid is string => typeof oid === "string");
  return (
    runtimeOid ??
    ancestorSessions(detail, lineRootCommitId)
      .map(({ item, record }) => {
        const row = record?.repositories?.find(
          (repository) => repository.repositoryId === repositoryId,
        );
        if (row !== undefined) return row.snapshotOid ?? undefined;
        return item.repositoryId === repositoryId ? record?.snapshotOid : undefined;
      })
      .find((oid): oid is string => typeof oid === "string")
  );
}
export const make = Effect.gen(function* () {
  const planning = yield* PlanningStore;
  const repositories = yield* RepositoryStore;
  const branches = yield* LineBranchStore;
  const slots = yield* SlotStore;
  const git = yield* GitVcsDriver;
  const memorySources = yield* MemorySourceStore;
  const lineBranchEnsurer = yield* makeLineBranchEnsurer;

  const reconcile = Effect.fn("LineBranchReactor.reconcile")(function* () {
    const [tree, repositorySnapshot, allSlots, sourceSnapshot] = yield* Effect.all([
      planning.getTreeSnapshot,
      repositories.getSnapshot,
      slots.listAll,
      memorySources.getSnapshot,
    ]);
    for (const plan of tree.plans) {
      const detail = yield* planning.getPlanSnapshot({ planId: plan.planId });
      const workingRepositories = projectWorkingRepositories(
        repositorySnapshot,
        plan.projectId,
        sourceSnapshot.find((source) => source.projectId === plan.projectId) ?? null,
      );
      for (const root of lineRoots(detail)) {
        for (const repository of workingRepositories) {
          yield* Effect.gen(function* () {
            const repositoryId = repository.repositoryId;
            if (!repository.hasGit) return;
            const lineRootCommitId = MercurianCommitId.make(root.commitId);
            const start = yield* lineBranchEnsurer.resolveLineBranchStart({
              detail,
              lineRootCommitId,
              repository,
            });
            const current = yield* lineBranchEnsurer.ensureLineBranch({
              detail,
              lineRootCommitId,
              repository,
              start,
            });
            const key = { lineRootCommitId, repositoryId };
            if (!current.built && current.baseOid !== start.baseOid) {
              const checkedOut = allSlots.some((slot) =>
                slot.members.some(
                  (member) =>
                    member.repositoryId === repositoryId && member.currentBranch === current.branch,
                ),
              );
              if (checkedOut) {
                yield* branches.recordRepointHold({ ...key, reason: "checked-out" });
                yield* Effect.logDebug("line-branch re-point held", {
                  lineRootCommitId: key.lineRootCommitId,
                  repositoryId,
                  branch: current.branch,
                  hold: "checked-out",
                });
                return;
              }
              const namedRef = yield* git.execute({
                operation: "LineBranchReactor.verifyBranch",
                cwd: repository.path,
                args: ["rev-parse", "--verify", "--quiet", `refs/heads/${current.branch}`],
                allowNonZeroExit: true,
              });
              if (namedRef.exitCode !== 0) {
                yield* branches.recordRepointHold({ ...key, reason: "name-missing" });
                yield* Effect.logDebug("line-branch re-point held", {
                  lineRootCommitId: key.lineRootCommitId,
                  repositoryId,
                  branch: current.branch,
                  hold: "name-missing",
                });
                return;
              }
              yield* git.execute({
                operation: "LineBranchReactor.repointBranch",
                cwd: repository.path,
                args: ["branch", "-f", current.branch, start.baseOid],
              });
              yield* branches.repointIfUnbuilt({ ...key, baseOid: start.baseOid });
              yield* branches.recordRepointHold({ ...key, reason: null });
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.logWarning("line-branch reconciliation entry failed", {
                    planId: plan.planId,
                    lineRootCommitId: root.commitId,
                    repositoryId: repository.repositoryId,
                    cause: Cause.pretty(cause),
                  }),
            ),
          );
        }
      }
    }
  });

  return {
    reconcile,
    changes: Stream.merge(Stream.merge(planning.changes, repositories.changes), slots.changes),
  };
});

export const LineBranchReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const reactor = yield* make;
    yield* reactor.reconcile().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("line-branch initial reconciliation failed", {
          cause: Cause.pretty(cause),
        }),
      ),
    );
    yield* forkParked(
      reactor.changes.pipe(
        Stream.debounce("50 millis"),
        Stream.runForEach(() => reactor.reconcile()),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("line-branch reconciliation failed", {
                cause: Cause.pretty(cause),
              }),
        ),
      ),
    );
  }),
);
