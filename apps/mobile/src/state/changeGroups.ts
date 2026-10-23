import { useAtomValue } from "@effect/atom-react";
import {
  environmentChangeGroups,
  type EnvironmentChangeGroup,
} from "@t3tools/client-runtime/changeGroups";
import { createChangeGroupEnvironmentAtoms } from "@t3tools/client-runtime/state/changeGroups";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { serverEnvironment } from "./server";
import { environmentThreadShells } from "./threads";
import { wikiEnvironment } from "./wiki";
import { useWorkspaceState } from "./workspace";

/** Astrolabe: what people decided about each change group, and deciding more. */
export const changeGroupEnvironment = createChangeGroupEnvironmentAtoms(connectionAtomRuntime);

const EMPTY: ReadonlyArray<EnvironmentChangeGroup> = [];

/** Every change group on the servers in `key` (a JSON array of environment ids), as web derives them. */
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
  const { environments } = useWorkspaceState();
  const key = JSON.stringify(
    environments
      .filter((environment) => environment.connectionState === "connected")
      .map((environment) => environment.environmentId),
  );
  return useAtomValue(changeGroupsAtom(key));
}
