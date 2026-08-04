import { useAtomValue } from "@effect/atom-react";
import { createMercurianPlanningAtoms } from "@t3tools/client-runtime/state/mercurian-planning";
import type {
  EnvironmentId,
  MercurianProjectId,
  PlanDetail,
  PlanId,
  PlanningTreeSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { useAtomCommand } from "./use-atom-command";

export const mercurianPlanning = createMercurianPlanningAtoms(connectionAtomRuntime);

/**
 * Mercurian's store lives on the primary environment. Plan routes therefore
 * carry no environment id — cross-environment planning is a later question,
 * and environments-as-navigation is exactly what this reshaping removes.
 */
const EMPTY_TREE_ATOM = Atom.make(
  AsyncResult.initial<
    { readonly kind: "snapshot"; readonly snapshot: PlanningTreeSnapshot },
    never
  >(false),
);
const EMPTY_PLAN_ATOM = Atom.make(
  AsyncResult.initial<
    { readonly detail: PlanDetail | null; readonly synchronized: boolean },
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
  /** `true` until the first snapshot lands; the tree renders its empty state meanwhile. */
  readonly isPending: boolean;
  readonly error: string | null;
}

export function useMercurianTree(): MercurianTreeState {
  const environmentId = usePrimaryEnvironmentId();
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

export interface PlanDetailState {
  readonly detail: PlanDetail | null;
  readonly isPending: boolean;
  readonly error: string | null;
}

/**
 * The planning space, live. There is no refresh: the artifact and the history
 * are one subscription over the plan's commits, so an edit or a message —
 * from this window or another — arrives as it lands.
 */
export function usePlanDetail(planId: PlanId | null): PlanDetailState {
  const environmentId = usePrimaryEnvironmentId();
  const atom =
    environmentId === null || planId === null
      ? EMPTY_PLAN_ATOM
      : mercurianPlanning.plan({ environmentId, input: { planId } });
  const result = useAtomValue(atom);
  const detail = Option.getOrNull(AsyncResult.value(result))?.detail ?? null;
  return {
    detail,
    isPending: detail === null && environmentId !== null && planId !== null,
    error: errorMessage(result, "Could not load this plan."),
  };
}

function useEnvironmentBoundCommand<Input, Output>(
  command: Parameters<
    typeof useAtomCommand<Output, unknown, { environmentId: EnvironmentId; input: Input }>
  >[0],
) {
  const environmentId = usePrimaryEnvironmentId();
  const run = useAtomCommand(command);
  return useCallback(
    (input: Input) => {
      if (environmentId === null) {
        return Promise.resolve(null);
      }
      return run({ environmentId, input }).then((result) =>
        result._tag === "Success" ? result.value : null,
      );
    },
    [environmentId, run],
  );
}

export function useCreateMercurianProject() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.createProject);
  return useCallback((name: string) => run({ name }), [run]);
}

/**
 * The birth act. A plan exists from the moment its first message lands, so
 * this is the only way to make one.
 */
export function useCreatePlan() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.createPlan);
  return useCallback(
    (projectId: MercurianProjectId, message: string) => run({ projectId, message }),
    [run],
  );
}

export function useAppendPlanMessage() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.appendPlanMessage);
  return useCallback((planId: PlanId, text: string) => run({ planId, text }), [run]);
}

/**
 * A direct edit of the plan. The text is the artifact's whole new body — a
 * revision is a snapshot, and an empty one is a legal edit.
 */
export function useSavePlanRevision() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.savePlanRevision);
  return useCallback((planId: PlanId, text: string) => run({ planId, text }), [run]);
}
