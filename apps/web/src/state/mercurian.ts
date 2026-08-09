import { useAtomValue } from "@effect/atom-react";
import { createMercurianPlanningAtoms } from "@t3tools/client-runtime/state/mercurian-planning";
import type {
  MercurianAppendPlanMessageInput,
  MercurianCommitId,
  MercurianCreatePlanInput,
  MercurianSavePlanRevisionInput,
  PlanDetail,
  PlanId,
  PlanningTreeSnapshot,
  PlanTurnRefusalReason,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentBoundCommand } from "./useEnvironmentBoundCommand";

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
    {
      readonly detail: PlanDetail | null;
      readonly synchronized: boolean;
      readonly turnRefusal: PlanTurnRefusalReason | null;
    },
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
  /** Why the last message got no reply — transient, cleared as a turn starts. */
  readonly turnRefusal: PlanTurnRefusalReason | null;
}

/**
 * The planning space, live. There is no refresh: the artifact and the history
 * are one subscription over the plan's commits, so an edit or a message —
 * from this window or another — arrives as it lands. The streaming turn rides
 * the same subscription as `detail.inFlightTurn`.
 */
export function usePlanDetail(planId: PlanId | null): PlanDetailState {
  const environmentId = usePrimaryEnvironmentId();
  const atom =
    environmentId === null || planId === null
      ? EMPTY_PLAN_ATOM
      : mercurianPlanning.plan({ environmentId, input: { planId } });
  const result = useAtomValue(atom);
  const state = Option.getOrNull(AsyncResult.value(result));
  const detail = state?.detail ?? null;
  return {
    detail,
    isPending: detail === null && environmentId !== null && planId !== null,
    error: errorMessage(result, "Could not load this plan."),
    turnRefusal: state?.turnRefusal ?? null,
  };
}

export function useCreateMercurianProject() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.createProject);
  return useCallback((name: string) => run({ name }), [run]);
}

/**
 * The birth act. A plan exists from the moment its first message lands, so
 * this is the only way to make one — and that first message composes with the
 * same powers as every later one, images included.
 */
export function useCreatePlan() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.createPlan);
  return useCallback((input: MercurianCreatePlanInput) => run(input), [run]);
}

/**
 * Say something in a plan, from wherever you are standing. `parentCommitId` is
 * that place: naming a commit that already has a child lands a fork whose
 * first commit is this message, which is the only way a fork is made.
 */
export function useAppendPlanMessage() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.appendPlanMessage);
  return useCallback((input: MercurianAppendPlanMessageInput) => run(input), [run]);
}

/**
 * A direct edit of the plan. The text is the artifact's whole new body — a
 * revision is a snapshot, and an empty one is a legal edit. It lands on the
 * branch its author was standing on, for the same reason a message does.
 */
export function useSavePlanRevision() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.savePlanRevision);
  return useCallback((input: MercurianSavePlanRevisionInput) => run(input), [run]);
}

/**
 * Record that you are looking at a plan. Unguarded on purpose: the server
 * writes only when the visit changes seen-ness, so a redundant call costs
 * nothing — no write, and no re-emit of the tree.
 */
export function useVisitPlan() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.visitPlan);
  return useCallback((planId: PlanId) => run({ planId }), [run]);
}

/**
 * Put a plan back in front of you. Server-side state, so it re-arms in every
 * window at once rather than in the one you clicked in.
 */
export function useMarkPlanUnread() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.markPlanUnread);
  return useCallback((planId: PlanId) => run({ planId }), [run]);
}

/**
 * Stop the reply streaming in a plan. The partial lands as a commit marked
 * interrupted, arriving on the same subscription as everything else.
 */
export function useStopPlanningTurn() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.stopPlanningTurn);
  return useCallback((planId: PlanId) => run({ planId }), [run]);
}

/** Answer the structured question a plan is waiting on, keyed by question id. */
export function useAnswerPlanningQuestion() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.answerPlanningQuestion);
  return useCallback(
    (planId: PlanId, answers: Readonly<Record<string, unknown>>) =>
      run({ planId, answers: answers as Record<string, unknown> }),
    [run],
  );
}

/**
 * The plan as it read at an earlier commit. The timeline's revisions travel
 * without their text — re-sending every historical snapshot would grow the
 * subscription with the square of editing activity — so looking back asks
 * once. The answer cannot go stale: history above a commit never changes.
 */
export function useGetPlanTextAt() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.getPlanTextAt);
  return useCallback(
    (planId: PlanId, commitId: MercurianCommitId) => run({ planId, commitId }),
    [run],
  );
}
