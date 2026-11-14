import {
  DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
  type ChangeGroupDecisions,
  type ChangeGroupGroupingSettings,
  type EnvironmentId,
  type ProjectId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import {
  CHANGE_GROUP_STATE_LABELS,
  changeGroupCandidates,
  deriveChangeGroups,
  isSharedBranch,
  type ChangeGroup,
  type ChangeGroupMember,
} from "@t3tools/shared/changeGroups";

import type { EnvironmentThreadShell } from "./state/models.ts";
import type { WikiOverview } from "./state/wiki.ts";
import { resolveThreadCurrentPullRequestLink } from "./threadPullRequests.ts";

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

/** The change groups a thread works in, those holding its own change requests first. */
export function threadChangeGroups(
  groups: ReadonlyArray<EnvironmentChangeGroup>,
  environmentId: EnvironmentId,
  threadId: string,
): ReadonlyArray<EnvironmentChangeGroup> {
  const owns = (group: EnvironmentChangeGroup) =>
    group.members.some((member) => member.threadId === threadId);
  return groups
    .filter((group) => group.environmentId === environmentId && group.threadIds.includes(threadId))
    .sort((left, right) => Number(owns(right)) - Number(owns(left)));
}

export type ThreadChangeRequestsTarget =
  | { readonly kind: "group"; readonly group: EnvironmentChangeGroup }
  | { readonly kind: "pull-request"; readonly link: ThreadPullRequestLink };

/**
 * Where a thread's change requests open: its change group when it is in one, else its pull
 * request. Several pull requests in no group (grouping off, members removed) open the current
 * one; the thread details list reaches the rest.
 */
export function threadChangeRequestsTarget(input: {
  readonly groups: ReadonlyArray<EnvironmentChangeGroup>;
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
}): ThreadChangeRequestsTarget | null {
  const group = threadChangeGroups(input.groups, input.environmentId, input.threadId)[0];
  if (group !== undefined) return { kind: "group", group };
  const link = resolveThreadCurrentPullRequestLink(input.pullRequests);
  return link === null ? null : { kind: "pull-request", link };
}

const COMPOSER_CHANGE_GROUP_RESULT_LIMIT = 3;

export interface ComposerChangeGroupItem {
  readonly id: string;
  readonly type: "change-group";
  readonly group: EnvironmentChangeGroup;
  readonly label: string;
  readonly description: string;
}

/**
 * Change groups to mention from a composer: those on its environment, where its agent reads
 * them, whose title, a member's title or a pull request's number matches. The thread's own
 * groups come first, then the rest by their latest activity, as they are derived.
 */
export function matchComposerChangeGroupItems(input: {
  readonly groups: ReadonlyArray<EnvironmentChangeGroup>;
  readonly environmentId: EnvironmentId;
  readonly threadId: string | null;
  readonly query: string;
}): ComposerChangeGroupItem[] {
  const query = input.query.trim().toLowerCase();
  if (query.length === 0) return [];
  const number = /^#?(\d+)$/u.exec(query)?.[1];
  const matches = (group: EnvironmentChangeGroup) =>
    group.title.toLowerCase().includes(query) ||
    group.members.some(
      (member) =>
        member.title.toLowerCase().includes(query) ||
        (number !== undefined &&
          member.ref.kind === "pull-request" &&
          String(member.ref.number) === number),
    );
  const found = input.groups.filter(
    (group) => group.environmentId === input.environmentId && matches(group),
  );
  const own = (group: EnvironmentChangeGroup) =>
    input.threadId !== null && group.threadIds.includes(input.threadId);
  return [...found.filter(own), ...found.filter((group) => !own(group))]
    .slice(0, COMPOSER_CHANGE_GROUP_RESULT_LIMIT)
    .map((group) => ({
      id: `change-group:${group.environmentId}:${group.groupId}`,
      type: "change-group",
      group,
      label: group.title,
      description: `Change group · ${CHANGE_GROUP_STATE_LABELS[group.state]}`,
    }));
}
