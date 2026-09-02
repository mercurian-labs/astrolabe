import { MercurianCommitId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { forkParked } from "../../serverActivation.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { buildLineBranchName } from "../codingSessions/branch.ts";
import {
  PlanningStore,
  type PlanDetail,
  type PlanTimelineItem,
} from "../planning/PlanningStore.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { lineSnapshotRef } from "../worktreeSlots/SnapshotChain.ts";
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

function inheritedCommitOid(detail: PlanDetail, lineRootCommitId: string, repositoryId: string) {
  const ancestors = ancestorsAt(detail, lineRootCommitId);
  const records = new Map(
    detail.codingSessions.map((session) => [String(session.commitId), session]),
  );
  return detail.timeline
    .filter(
      (item) =>
        item._tag === "coding-session" &&
        item.repositoryId === repositoryId &&
        ancestors.has(String(item.commitId)) &&
        records.get(String(item.commitId))?.settledCommitOid !== null,
    )
    .toSorted((left, right) => right.sequence - left.sequence)
    .map((item) => records.get(String(item.commitId))?.settledCommitOid)
    .find((oid): oid is string => typeof oid === "string");
}

function inheritedSnapshotOid(detail: PlanDetail, lineRootCommitId: string, repositoryId: string) {
  const ancestors = ancestorsAt(detail, lineRootCommitId);
  const records = new Map(
    detail.codingSessions.map((session) => [String(session.commitId), session]),
  );
  return detail.timeline
    .filter(
      (item) =>
        item._tag === "coding-session" &&
        item.repositoryId === repositoryId &&
        ancestors.has(String(item.commitId)) &&
        records.get(String(item.commitId))?.snapshotOid !== null,
    )
    .toSorted((left, right) => right.sequence - left.sequence)
    .map((item) => records.get(String(item.commitId))?.snapshotOid)
    .find((oid): oid is string => typeof oid === "string");
}

export const make = Effect.gen(function* () {
  const planning = yield* PlanningStore;
  const repositories = yield* RepositoryStore;
  const branches = yield* LineBranchStore;
  const git = yield* GitVcsDriver;
  const settings = yield* ServerSettingsService;

  const repositoryDefaultOid = Effect.fn("LineBranchReactor.repositoryDefaultOid")(function* (
    path: string,
  ) {
    const startFromOrigin = (yield* settings.getSettings).newWorktreesStartFromOrigin;
    const remoteHead = startFromOrigin
      ? yield* git.execute({
          operation: "LineBranchReactor.defaultRemote",
          cwd: path,
          args: ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
          allowNonZeroExit: true,
        })
      : undefined;
    const ref = remoteHead?.exitCode === 0 ? remoteHead.stdout.trim() : "HEAD";
    const resolved = yield* git.execute({
      operation: "LineBranchReactor.resolveBase",
      cwd: path,
      args: ["rev-parse", "--verify", `${ref}^{commit}`],
    });
    return resolved.stdout.trim();
  });

  const reconcile = Effect.fn("LineBranchReactor.reconcile")(function* () {
    const [tree, repositorySnapshot] = yield* Effect.all([
      planning.getTreeSnapshot,
      repositories.getSnapshot,
    ]);
    for (const plan of tree.plans) {
      const detail = yield* planning.getPlanSnapshot({ planId: plan.planId });
      const linkedRepositoryIds = repositorySnapshot.projectRepositories
        .filter((link) => link.projectId === plan.projectId)
        .map((link) => link.repositoryId);
      for (const root of lineRoots(detail)) {
        for (const repositoryId of linkedRepositoryIds) {
          const repository = repositorySnapshot.repositories.find(
            (candidate) => candidate.repositoryId === repositoryId,
          );
          if (repository === undefined || !repository.hasGit) continue;
          const inherited = inheritedCommitOid(detail, String(root.commitId), repositoryId);
          const inheritedSnapshot = inheritedSnapshotOid(
            detail,
            String(root.commitId),
            repositoryId,
          );
          const baseOid = inherited ?? (yield* repositoryDefaultOid(repository.path));
          const key = {
            lineRootCommitId: MercurianCommitId.make(root.commitId),
            repositoryId,
          };
          const current = yield* branches.get(key);
          if (Option.isNone(current)) {
            const branch = buildLineBranchName(detail.plan.title, String(root.commitId));
            yield* git.execute({
              operation: "LineBranchReactor.createBranch",
              cwd: repository.path,
              args: ["branch", branch, baseOid],
            });
            if (inheritedSnapshot !== undefined) {
              yield* git.execute({
                operation: "LineBranchReactor.inheritSnapshot",
                cwd: repository.path,
                args: [
                  "update-ref",
                  lineSnapshotRef(MercurianCommitId.make(String(root.commitId))),
                  inheritedSnapshot,
                ],
              });
            }
            yield* branches.create({
              ...key,
              branch,
              baseOid,
              built: false,
              createdAt: root.createdAt,
            });
          } else if (!current.value.built && current.value.baseOid !== baseOid) {
            yield* git.execute({
              operation: "LineBranchReactor.repointBranch",
              cwd: repository.path,
              args: ["branch", "-f", current.value.branch, baseOid],
            });
            yield* branches.repointIfUnbuilt({ ...key, baseOid });
          }
        }
      }
    }
  });

  return { reconcile, changes: Stream.merge(planning.changes, repositories.changes) };
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
