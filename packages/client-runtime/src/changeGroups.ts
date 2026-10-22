import {
  DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
  type ChangeGroupDecisions,
  type ChangeGroupGroupingSettings,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  changeGroupCandidates,
  deriveChangeGroups,
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
}): ReadonlyArray<EnvironmentChangeGroup> {
  const { environmentId } = input;
  const groups = deriveChangeGroups({
    ...groupInputs(input),
    decisions: input.decisions,
    settings: input.settings ?? DEFAULT_CHANGE_GROUP_GROUPING_SETTINGS,
  });
  return groups.map((group) => ({ ...group, environmentId }));
}
