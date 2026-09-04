import { MercurianCommitId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { forkParked } from "../../serverActivation.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
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
