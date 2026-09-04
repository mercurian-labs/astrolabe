import { useAtomValue } from "@effect/atom-react";
import { createMercurianPlanningAtoms } from "@t3tools/client-runtime/state/mercurian-planning";
import type {
  EnvironmentId,
  MercurianCommitId,
  MercurianEnsureProjectRuntimeInput,
  MercurianForkLineInput,
  MercurianImportPlanInput,
  MercurianOpenLineInput,
  MercurianCancelMemoryAmendmentInput,
  MercurianConfirmMemoryAmendmentInput,
  MercurianSavePlanRevisionInput,
  MercurianSaveSpecRevisionInput,
  MercurianRefreshSpecInput,
  MercurianRecreateLineBranchInput,
  PlanDetail,
  PlanId,
  PlanningTreeSnapshot,
  PlanTurnRefusalReason,
  PlanStreamItem,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "./environments";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import {
  useEnvironmentBoundCommand,
  useEnvironmentBoundCommandResult,
} from "./useEnvironmentBoundCommand";

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
      readonly codingSessions: ReadonlyMap<
        MercurianCommitId,
        import("@t3tools/contracts").PlanCodingSessionRecord
      >;
      readonly lineRuntimes: ReadonlyMap<
        MercurianCommitId,
        import("@t3tools/contracts").PlanLineRuntimeRecord
      >;
      readonly synchronized: boolean;
      readonly turnRefusal: PlanTurnRefusalReason | null;
      readonly memoryAmendmentFailure: Extract<
        PlanStreamItem,
        { readonly kind: "memory-amendment-failed" }
      > | null;
    },
    never
  >(false),
);

const EMPTY_TREE_SNAPSHOT: PlanningTreeSnapshot = { projects: [], plans: [], threadPlanLinks: [] };

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

export function resolveMercurianQueryPending(
  environmentId: EnvironmentId | null,
  pendingForKnownEnvironment: boolean,
): boolean {
  return environmentId === null || pendingForKnownEnvironment;
}

export function useMercurianTree(): MercurianTreeState {
  const environmentId = usePrimaryEnvironmentId();
  const atom =
    environmentId === null ? EMPTY_TREE_ATOM : mercurianPlanning.tree({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const item = Option.getOrNull(AsyncResult.value(result));
  return {
    snapshot: item?.snapshot ?? EMPTY_TREE_SNAPSHOT,
    isPending: resolveMercurianQueryPending(environmentId, item === null),
    error: errorMessage(result, "Could not load the project tree."),
  };
}

function readMercurianTreeSnapshot(): PlanningTreeSnapshot {
  const environmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
  if (environmentId === null) return EMPTY_TREE_SNAPSHOT;
  const result = appAtomRegistry.get(mercurianPlanning.tree({ environmentId, input: {} }));
  return Option.getOrNull(AsyncResult.value(result))?.snapshot ?? EMPTY_TREE_SNAPSHOT;
}

export function threadPlanLinkForThread(
  threadId: ThreadId,
  snapshot: PlanningTreeSnapshot = readMercurianTreeSnapshot(),
) {
  return snapshot.threadPlanLinks.find((link) => link.threadId === threadId) ?? null;
}

export function planForThread(
  threadId: ThreadId,
  snapshot: PlanningTreeSnapshot = readMercurianTreeSnapshot(),
): PlanId | null {
  return threadPlanLinkForThread(threadId, snapshot)?.planId ?? null;
}

export function usePlanForThread(threadId: ThreadId | null): PlanId | null {
  const { snapshot } = useMercurianTree();
  return useMemo(
    () => (threadId === null ? null : planForThread(threadId, snapshot)),
    [snapshot, threadId],
  );
}

export interface PlanDetailState {
  readonly detail: PlanDetail | null;
  readonly isPending: boolean;
  readonly error: string | null;
  /** Why the last message got no reply — transient, cleared as a turn starts. */
  readonly turnRefusal: PlanTurnRefusalReason | null;
  readonly memoryAmendmentFailure: Extract<
    PlanStreamItem,
    { readonly kind: "memory-amendment-failed" }
  > | null;
}

/**
 * The planning space, live. There is no refresh: the artifact and the history
 * are one subscription over the plan's commits, so an edit or a message —
 * from this window or another — arrives as it lands. The streaming turn rides
 * the same subscription as `detail.inFlightTurns`.
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
    isPending:
      planId !== null &&
      resolveMercurianQueryPending(environmentId, detail === null && result._tag !== "Failure"),
    error: errorMessage(result, "Could not load this plan."),
    turnRefusal: state?.turnRefusal ?? null,
    memoryAmendmentFailure: state?.memoryAmendmentFailure ?? null,
  };
}

export function useCreateMercurianProject() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.createProject);
  return useCallback((name: string) => run({ name }), [run]);
}

export function useEnsureProjectRuntime() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.ensureProjectRuntime);
  return useCallback((input: MercurianEnsureProjectRuntimeInput) => run(input), [run]);
}

export function useOpenLine() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.openLine);
  return useCallback((input: MercurianOpenLineInput) => run(input), [run]);
}

export function useForkLine() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.forkLine);
  return useCallback((input: MercurianForkLineInput) => run(input), [run]);
}

/**
 * The birth act. A plan exists from the moment its first message lands, so
 * this is the only way to make one — and that first message composes with the
 * same powers as every later one, images included.
 */
/**
 * Say something in a plan, from wherever you are standing. `parentCommitId` is
 * that place: naming a commit that already has a child lands a fork whose
 * first commit is this message, which is the only way a fork is made.
 */
/**
 * Import a tracked issue as a plan. Idempotent by origin, so this never fails
 * for having been done before: an issue already imported answers with the plan
 * it already has, and an archived one comes back out of the archive. The
 * outcome says which, so the surface can navigate and explain rather than error.
 */
export function useImportPlan() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.importPlan);
  return useCallback((input: MercurianImportPlanInput) => run(input), [run]);
}

/**
 * A direct edit of the plan. The text is the artifact's whole new body — a
 * revision is a snapshot, and an empty one is a legal edit. It lands on the
 * branch its author was standing on, for the same reason a message does.
 *
 * Bound through the result variant: a refusal — a reply streaming on the
 * edit's own branch — is something the artifact pane has to say in place,
 * not a console line the editor swallows.
 */
export function useSavePlanRevision() {
  const run = useEnvironmentBoundCommandResult(mercurianPlanning.savePlanRevision);
  return useCallback((input: MercurianSavePlanRevisionInput) => run(input), [run]);
}

/** The spec's edit, with the same in-place refusals as the plan's. */
export function useSaveSpecRevision() {
  const run = useEnvironmentBoundCommandResult(mercurianPlanning.saveSpecRevision);
  return useCallback((input: MercurianSaveSpecRevisionInput) => run(input), [run]);
}

export function useRefreshSpec() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.refreshSpec);
  return useCallback((input: MercurianRefreshSpecInput) => run(input), [run]);
}

export function useConfirmMemoryAmendment() {
  const run = useEnvironmentBoundCommandResult(mercurianPlanning.confirmMemoryAmendment);
  return useCallback((input: MercurianConfirmMemoryAmendmentInput) => run(input), [run]);
}

export function useCancelMemoryAmendment() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.cancelMemoryAmendment);
  return useCallback((input: MercurianCancelMemoryAmendmentInput) => run(input), [run]);
}

export function useRecreateLineBranch() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.recreateLineBranch);
  return useCallback((input: MercurianRecreateLineBranchInput) => run(input), [run]);
}
/**
 * Record that you are looking at a plan. Unguarded on purpose: the server
 * writes only when the visit changes seen-ness, so a redundant call costs
 * nothing — no write, and no re-emit of the tree.
 */
export function useVisitPlan() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.visitPlan);
  return useCallback(
    (input: import("@t3tools/contracts").MercurianVisitPlanInput) => run(input),
    [run],
  );
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
 * Stop one reply streaming in a plan — replies on other branches keep going.
 * The partial lands as a commit marked interrupted, arriving on the same
 * subscription as everything else.
 */
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

/** Exact prompt reconstruction sizes at an immutable plan position. */
export function useGetSpecAt() {
  const run = useEnvironmentBoundCommand(mercurianPlanning.getSpecAt);
  return useCallback(
    (planId: PlanId, commitId: MercurianCommitId) => run({ planId, commitId }),
    [run],
  );
}
