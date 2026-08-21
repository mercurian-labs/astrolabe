import { useAtomValue } from "@effect/atom-react";
import { createMercurianPlanningAtoms } from "@t3tools/client-runtime/state/mercurian-planning";
import type {
  EnvironmentId,
  MercurianUnarchivePlanInput,
  MercurianVisitPlanInput,
  PlanningTreeSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "./use-atom-command";

export const mercurianPlanning = createMercurianPlanningAtoms(connectionAtomRuntime);

const EMPTY_TREE_ATOM = Atom.make(
  AsyncResult.initial<
    { readonly kind: "snapshot"; readonly snapshot: PlanningTreeSnapshot },
    never
  >(false),
);

const EMPTY_TREE_SNAPSHOT: PlanningTreeSnapshot = { projects: [], plans: [] };

function errorMessage<A>(result: AsyncResult.AsyncResult<A, unknown>, fallback: string) {
  if (result._tag !== "Failure") return null;
  const cause = Cause.squash(result.cause);
  return cause instanceof Error ? cause.message : fallback;
}

export interface MercurianTreeState {
  readonly snapshot: PlanningTreeSnapshot;
  readonly isPending: boolean;
  readonly error: string | null;
}

export function useMercurianTree(environmentId: EnvironmentId | null): MercurianTreeState {
  const atom =
    environmentId === null ? EMPTY_TREE_ATOM : mercurianPlanning.tree({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const item = Option.getOrNull(AsyncResult.value(result));
  return {
    snapshot: item?.snapshot ?? EMPTY_TREE_SNAPSHOT,
    isPending: item === null && environmentId !== null,
    error: errorMessage(result, "Could not load the project tree."),
  };
}

export function useVisitPlan(environmentId: EnvironmentId | null) {
  const run = useAtomCommand(mercurianPlanning.visitPlan);
  return useCallback(
    (input: MercurianVisitPlanInput) =>
      environmentId === null ? Promise.resolve(null) : run({ environmentId, input }),
    [environmentId, run],
  );
}

export function useUnarchivePlan(environmentId: EnvironmentId | null) {
  const run = useAtomCommand(mercurianPlanning.unarchivePlan);
  return useCallback(
    (input: MercurianUnarchivePlanInput) =>
      environmentId === null ? Promise.resolve(null) : run({ environmentId, input }),
    [environmentId, run],
  );
}
