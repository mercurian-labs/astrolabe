import {
  DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
  type ChangeGroupDecisions,
  type ChangeGroupGroupingSettings,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import {
  changeGroupCandidates,
  deriveChangeGroups,
  isSharedBranch,
  type ChangeGroup,
  type ChangeGroupMember,
} from "@t3tools/shared/changeGroups";

import type { EnvironmentThreadShell } from "./state/models.ts";
import type { WikiOverview } from "./state/wiki.ts";

/** Astrolabe: a change group, with the environment it lives on. */
export interface EnvironmentChangeGroup extends ChangeGroup {
  readonly environmentId: EnvironmentId;
}

/**
 * One environment's change groups, from what a client already holds: its threads' shells (their
 * lineage and pull requests), its wikis' change requests, and the environment's decisions and
 * Grouping settings, as the server derives them.
 */
/** One environment's change requests, as a group would show each: candidates to add. */
export function environmentChangeRequests(input: {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly overviews: ReadonlyArray<WikiOverview>;
}): ReadonlyArray<ChangeGroupMember> {
  return changeGroupCandidates(groupInputs(input));
}

function groupInputs(input: {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly threadBranches?: Readonly<Record<string, ReadonlyArray<string>>>;
}) {
  const { environmentId } = input;
  return {
    threads: input.threads
      .filter((thread) => thread.environmentId === environmentId && thread.archivedAt === null)
      .map((thread) => ({
        id: thread.id,
        title: thread.title,
        lineage: thread.lineage,
        pullRequests: thread.pullRequests,
        branch: thread.branch,
        ...(input.threadBranches?.[thread.id] === undefined
          ? {}
          : { branches: input.threadBranches[thread.id] }),
      })),
    wikiChanges: input.overviews
      .filter((overview) => overview.environmentId === environmentId)
      .flatMap((overview) =>
        (overview.changeRequests ?? []).map((changeRequest) => ({
          wikiName: overview.wiki.name,
          changeRequest,
        })),
      ),
  };
}

export function environmentChangeGroups(input: {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly decisions: ReadonlyArray<ChangeGroupDecisions>;
  readonly settings: ChangeGroupGroupingSettings | null;
  /** Every branch each thread has worked on, as the environment's change groups list says. */
  readonly threadBranches?: Readonly<Record<string, ReadonlyArray<string>>>;
}): ReadonlyArray<EnvironmentChangeGroup> {
  const { environmentId } = input;
  const groups = deriveChangeGroups({
    ...groupInputs(input),
    decisions: input.decisions,
    settings: input.settings ?? DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
  });
  return groups.map((group) => ({ ...group, environmentId }));
}

/** A branch of one environment's project, as `changeGroupsByBranch` keys it. */
export const branchGroupKey = (
  environmentId: EnvironmentId,
  projectId: ProjectId,
  branch: string,
) => `${environmentId}\u0000${projectId}\u0000${branch}`;

/**
 * The change groups each branch's work is in (`branchGroupKey`): those of every thread that worked
 * on it in that project. A shared branch such as main is in none, as it names no one effort.
 */
export function changeGroupsByBranch(input: {
  readonly groups: ReadonlyArray<EnvironmentChangeGroup>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /** Every branch each thread has worked on, by environment, then thread id. */
  readonly threadBranches: (
    environmentId: EnvironmentId,
  ) => Readonly<Record<string, ReadonlyArray<string>>>;
}): ReadonlyMap<string, ReadonlyArray<EnvironmentChangeGroup>> {
  const threads = new Map(
    input.threads.map((thread) => [`${thread.environmentId}\u0000${thread.id}`, thread]),
  );
  const byBranch = new Map<string, EnvironmentChangeGroup[]>();
  for (const group of input.groups) {
    const worked = input.threadBranches(group.environmentId);
    const keys = new Set<string>();
    for (const threadId of group.threadIds) {
      const thread = threads.get(`${group.environmentId}\u0000${threadId}`);
      if (thread === undefined) continue;
      for (const branch of [thread.branch, ...(worked[threadId] ?? [])]) {
        if (branch === null || isSharedBranch(branch)) continue;
        keys.add(branchGroupKey(group.environmentId, thread.projectId, branch));
      }
    }
    for (const key of keys) byBranch.set(key, [...(byBranch.get(key) ?? []), group]);
  }
  return byBranch;
}
