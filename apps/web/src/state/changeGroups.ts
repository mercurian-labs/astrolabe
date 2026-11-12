import {
  changeGroupsByBranch,
  environmentChangeGroups,
  environmentChangeRequests,
  threadChangeGroups,
  type EnvironmentChangeGroup,
} from "@t3tools/client-runtime/changeGroups";
import type { ChangeGroupDecisions } from "@t3tools/contracts";
import type { ChangeGroupMember } from "@t3tools/shared/changeGroups";
import { createChangeGroupEnvironmentAtoms } from "@t3tools/client-runtime/state/changeGroups";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironments } from "./environments";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";
import { environmentThreadShells } from "./threads";
import { wikiEnvironment } from "./wiki";

/** Astrolabe: what people decided about each change group, and deciding more. */
export const changeGroupEnvironment = createChangeGroupEnvironmentAtoms(connectionAtomRuntime);

const EMPTY: ReadonlyArray<EnvironmentChangeGroup> = [];

/**
 * Every change group on the servers in `key` (a JSON array of environment ids), derived once
 * for every view that shows them: the Change Requests list, a group's tab, a thread's details.
 */
const changeGroupsAtom = Atom.family((key: string) =>
  Atom.make((get): ReadonlyArray<EnvironmentChangeGroup> => {
    const threads = get(environmentThreadShells.threadShellsAtom);
    const groups = (JSON.parse(key) as EnvironmentId[]).flatMap((environmentId) => {
      const decisions = Option.getOrNull(
        AsyncResult.value(get(changeGroupEnvironment.decisions({ environmentId, input: {} }))),
      );
      const settings = get(serverEnvironment.settingsValueAtom(environmentId));
      return environmentChangeGroups({
        environmentId,
        threads,
        overviews: get(wikiEnvironment.overview(environmentId)) ?? [],
        decisions: decisions?.decisions ?? [],
        settings: settings?.changeGroupGrouping ?? null,
        threadBranches: decisions?.threadBranches ?? {},
      });
    });
    return groups.length === 0 ? EMPTY : groups;
  }).pipe(Atom.withLabel(`change-groups:${key}`)),
);

const changeGroupsByBranchAtom = Atom.family((key: string) =>
  Atom.make((get) =>
    changeGroupsByBranch({
      groups: get(changeGroupsAtom(key)),
      threads: get(environmentThreadShells.threadShellsAtom),
      threadBranches: (environmentId) =>
        Option.getOrNull(
          AsyncResult.value(get(changeGroupEnvironment.decisions({ environmentId, input: {} }))),
        )?.threadBranches ?? {},
    }),
  ).pipe(Atom.withLabel(`change-groups-by-branch:${key}`)),
);

const useEnvironmentsKey = () => {
  const { environments } = useEnvironments();
  return JSON.stringify(environments.map((environment) => environment.environmentId));
};

/** Every change group on the connected servers. */
export function useChangeGroups(): ReadonlyArray<EnvironmentChangeGroup> {
  return useAtomValue(changeGroupsAtom(useEnvironmentsKey()));
}

/** Every change group on the connected servers while `active`, else none, deriving nothing. */
export function useChangeGroupsWhile(active: boolean): ReadonlyArray<EnvironmentChangeGroup> {
  const key = useEnvironmentsKey();
  return useAtomValue(changeGroupsAtom(active ? key : "[]"));
}

/** Every change group on the connected servers, read once rather than followed. */
export function readChangeGroups(): ReadonlyArray<EnvironmentChangeGroup> {
  const ids = [...appAtomRegistry.get(environmentPresentations.presentationsAtom).keys()];
  return appAtomRegistry.get(changeGroupsAtom(JSON.stringify(ids)));
}

/** A thread's first change group's id (`threadChangeGroups`), so a change elsewhere rerenders nothing. */
const threadChangeGroupIdAtom = Atom.family((key: string) =>
  Atom.make((get): string | null => {
    const [environmentsKey, environmentId, threadId] = JSON.parse(key) as [
      string,
      EnvironmentId | null,
      string | null,
    ];
    if (environmentId === null || threadId === null) return null;
    return (
      threadChangeGroups(get(changeGroupsAtom(environmentsKey)), environmentId, threadId)[0]
        ?.groupId ?? null
    );
  }).pipe(Atom.withLabel(`thread-change-group:${key}`)),
);

export function useThreadChangeGroupId(threadRef: ScopedThreadRef | null): string | null {
  const environmentsKey = useEnvironmentsKey();
  return useAtomValue(
    threadChangeGroupIdAtom(
      JSON.stringify([
        environmentsKey,
        threadRef?.environmentId ?? null,
        threadRef?.threadId ?? null,
      ]),
    ),
  );
}

/** The change groups each branch's work is in, by `branchGroupKey`. */
export function useChangeGroupsByBranch(): ReadonlyMap<
  string,
  ReadonlyArray<EnvironmentChangeGroup>
> {
  return useAtomValue(changeGroupsByBranchAtom(useEnvironmentsKey()));
}

const NO_DECISIONS: ReadonlyArray<ChangeGroupDecisions> = [];

/** What people decided about each group on an environment. */
export function useChangeGroupDecisions(
  environmentId: EnvironmentId,
): ReadonlyArray<ChangeGroupDecisions> {
  const result = useAtomValue(changeGroupEnvironment.decisions({ environmentId, input: {} }));
  return Option.getOrNull(AsyncResult.value(result))?.decisions ?? NO_DECISIONS;
}

/** Every change request on an environment, as a group would show it. */
const changeRequestsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<ChangeGroupMember> =>
    environmentChangeRequests({
      environmentId,
      threads: get(environmentThreadShells.threadShellsAtom),
      overviews: get(wikiEnvironment.overview(environmentId)) ?? [],
    }),
  ).pipe(Atom.withLabel(`change-requests:${environmentId}`)),
);

export function useEnvironmentChangeRequests(
  environmentId: EnvironmentId,
): ReadonlyArray<ChangeGroupMember> {
  return useAtomValue(changeRequestsAtom(environmentId));
}
