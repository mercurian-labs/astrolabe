import { MercurianCommitId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ServerSettingsService } from "../../serverSettings.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { buildLineBranchName } from "../codingSessions/branch.ts";
import type { PlanDetail, PlanTimelineItem } from "../planning/PlanningStore.ts";
import type { RepositoryView } from "../repositories/schema.ts";
import { lineSnapshotRef } from "../worktreeSlots/SnapshotChain.ts";
import { LineBranchStore, type LineBranch } from "./LineBranchStore.ts";
import { resolveRepositoryDefault } from "./repositoryDefault.ts";

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

function inheritedCommitOid(detail: PlanDetail, lineRootCommitId: string, repositoryId: string) {
  return ancestorSessions(detail, lineRootCommitId)
    .map(({ item, record }) => {
      const row = record?.repositories?.find(
        (repository) => repository.repositoryId === repositoryId,
      );
      if (row !== undefined) return row.branchTipOid ?? undefined;
      return item.repositoryId === repositoryId ? record?.settledCommitOid : undefined;
    })
    .find((oid): oid is string => typeof oid === "string");
}

function inheritedSnapshotOid(detail: PlanDetail, lineRootCommitId: string, repositoryId: string) {
  return ancestorSessions(detail, lineRootCommitId)
    .map(({ item, record }) => {
      const row = record?.repositories?.find(
        (repository) => repository.repositoryId === repositoryId,
      );
      if (row !== undefined) return row.snapshotOid ?? undefined;
      return item.repositoryId === repositoryId ? record?.snapshotOid : undefined;
    })
    .find((oid): oid is string => typeof oid === "string");
}

export interface LineBranchStart {
  readonly baseOid: string;
  readonly inheritedSnapshotOid: string | undefined;
}

class LineBranchEnsureError extends Schema.TaggedErrorClass<LineBranchEnsureError>()(
  "LineBranchEnsureError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export const makeLineBranchEnsurer = Effect.gen(function* () {
  const branches = yield* LineBranchStore;
  const git = yield* GitVcsDriver;
  const settings = yield* ServerSettingsService;

  const resolveLineBranchStart = Effect.fn("resolveLineBranchStart")(function* (input: {
    readonly detail: PlanDetail;
    readonly lineRootCommitId: MercurianCommitId;
    readonly repository: RepositoryView;
  }) {
    const inherited = inheritedCommitOid(
      input.detail,
      input.lineRootCommitId,
      input.repository.repositoryId,
    );
    const inheritedSnapshot = inheritedSnapshotOid(
      input.detail,
      input.lineRootCommitId,
      input.repository.repositoryId,
    );
    if (inherited !== undefined) {
      return {
        baseOid: inherited,
        inheritedSnapshotOid: inheritedSnapshot,
      } satisfies LineBranchStart;
    }
    const startFromOrigin = (yield* settings.getSettings).newWorktreesStartFromOrigin;
    const repositoryDefault = yield* resolveRepositoryDefault({
      git,
      path: input.repository.path,
      startFromOrigin,
    });
    return {
      baseOid: repositoryDefault.oid,
      inheritedSnapshotOid: inheritedSnapshot,
    } satisfies LineBranchStart;
  });

  /** Ensure one line branch exists; concurrent callers converge on the stored row. */
  const ensureLineBranch = Effect.fn("ensureLineBranch")(function* (input: {
    readonly detail: PlanDetail;
    readonly lineRootCommitId: MercurianCommitId;
    readonly repository: RepositoryView;
    readonly start?: LineBranchStart;
  }) {
    const current = yield* branches.get({
      lineRootCommitId: input.lineRootCommitId,
      repositoryId: input.repository.repositoryId,
    });
    if (Option.isSome(current)) return current.value;

    const start = input.start ?? (yield* resolveLineBranchStart(input));
    const root = input.detail.timeline.find(
      (item) => String(item.commitId) === String(input.lineRootCommitId),
    );
    if (root === undefined) {
      return yield* new LineBranchEnsureError({
        operation: "EnsureLineBranch.findRoot",
        cause: new Error(
          `Line root ${input.lineRootCommitId} is not part of plan ${input.detail.plan.planId}`,
        ),
      });
    }
    const branch = buildLineBranchName(input.detail.plan.title, String(input.lineRootCommitId));
    const createdBranch = yield* git.execute({
      operation: "EnsureLineBranch.createBranch",
      cwd: input.repository.path,
      args: ["branch", branch, start.baseOid],
      allowNonZeroExit: true,
    });
    if (createdBranch.exitCode !== 0) {
      const existingBranch = yield* git.execute({
        operation: "EnsureLineBranch.verifyConcurrentBranch",
        cwd: input.repository.path,
        args: ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`],
        allowNonZeroExit: true,
      });
      if (existingBranch.exitCode !== 0) {
        return yield* new LineBranchEnsureError({
          operation: "EnsureLineBranch.createBranch",
          cause: new Error(createdBranch.stderr || `Could not create line branch ${branch}`),
        });
      }
    }
    if (start.inheritedSnapshotOid !== undefined) {
      yield* git.execute({
        operation: "EnsureLineBranch.inheritSnapshot",
        cwd: input.repository.path,
        args: ["update-ref", lineSnapshotRef(input.lineRootCommitId), start.inheritedSnapshotOid],
      });
    }
    const created = {
      lineRootCommitId: input.lineRootCommitId,
      repositoryId: input.repository.repositoryId,
      branch,
      baseOid: start.baseOid,
      built: false,
      repointHold: null,
      createdAt: root.createdAt,
    } satisfies LineBranch;
    yield* branches.create(created);
    return Option.getOrElse(
      yield* branches.get({
        lineRootCommitId: input.lineRootCommitId,
        repositoryId: input.repository.repositoryId,
      }),
      () => created,
    );
  });

  return {
    ensureLineBranch,
    resolveLineBranchStart,
  };
});
