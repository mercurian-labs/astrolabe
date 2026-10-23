import {
  environmentChangeGroups,
  environmentChangeRequests,
  type EnvironmentChangeGroup,
} from "@t3tools/client-runtime/changeGroups";
import type { ChangeGroupDecisions } from "@t3tools/contracts";
import type { ChangeGroupMember } from "@t3tools/shared/changeGroups";
import { createChangeGroupEnvironmentAtoms } from "@t3tools/client-runtime/state/changeGroups";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironments } from "./environments";
import { serverEnvironment } from "./server";
import { environmentThreadShells } from "./threads";
import { wikiEnvironment } from "./wiki";

/** Astrolabe: what people decided about each change group, and deciding more. */
export const changeGroupEnvironment = createChangeGroupEnvironmentAtoms(connectionAtomRuntime);

const EMPTY: ReadonlyArray<EnvironmentChangeGroup> = [];

/**
 * Every change group on the servers in `key` (a JSON array of environment ids), derived once
 * for every view that shows them: the Change Requests list, a group's tab, a thread's pill.
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
      });
    });
    return groups.length === 0 ? EMPTY : groups;
  }).pipe(Atom.withLabel(`change-groups:${key}`)),
);

/** Every change group on the connected servers. */
export function useChangeGroups(): ReadonlyArray<EnvironmentChangeGroup> {
  const { environments } = useEnvironments();
  const key = JSON.stringify(environments.map((environment) => environment.environmentId));
  return useAtomValue(changeGroupsAtom(key));
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
