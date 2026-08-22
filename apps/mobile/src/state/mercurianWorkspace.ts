import { useAtomValue } from "@effect/atom-react";
import { createMercurianWorkspaceAtoms } from "@t3tools/client-runtime/state/mercurian-workspace";
import {
  type EnvironmentId,
  type PlanningModelResolution,
  type PlanningModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { derivePlanningModelState } from "./mercurianWorkspace.logic";
import { serverEnvironment } from "./server";
import { useEnvironmentQuery } from "./query";

export const mercurianWorkspace = createMercurianWorkspaceAtoms(connectionAtomRuntime);

const EMPTY_PROVIDERS_ATOM = Atom.make<ReadonlyArray<ServerProvider> | null>(null).pipe(
  Atom.withLabel("mobile:mercurian-workspace:empty-providers"),
);

export interface PlanningModelState {
  readonly setting: PlanningModelSelection | null;
  readonly resolution: PlanningModelResolution;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly isPending: boolean;
  readonly error: string | null;
}

export function usePlanningModel(environmentId: EnvironmentId | null): PlanningModelState {
  const query = useEnvironmentQuery(
    environmentId === null ? null : mercurianWorkspace.settings({ environmentId, input: {} }),
  );
  const providers =
    useAtomValue(
      environmentId === null
        ? EMPTY_PROVIDERS_ATOM
        : serverEnvironment.providersValueAtom(environmentId),
    ) ?? [];
  const derived = derivePlanningModelState(query.data?.snapshot.planningModel ?? null, providers);
  return {
    ...derived,
    isPending: environmentId !== null && query.data === null && query.isPending,
    error: query.error,
  };
}
