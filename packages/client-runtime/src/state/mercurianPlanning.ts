import { MERCURIAN_WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { applyPlanStreamItem, EMPTY_PLAN_STATE } from "./planReducer.ts";

export type { PlanSubscriptionState } from "./planReducer.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Messages and edits on one plan land in the order they were made. */
const serialPerPlan = {
  mode: "serial" as const,
  key: ({ environmentId, input }: { environmentId: string; input: { planId: string } }) =>
    JSON.stringify([environmentId, input.planId]),
};

/**
 * Mercurian's planning data: the project tree and each planning space as live
 * subscriptions, plus the acts that write.
 *
 * The tree arrives as a whole snapshot each time it changes rather than as
 * sequenced deltas — projects and plans are few, and they move only when a
 * person creates or messages one. A plan is the opposite case and folds
 * sequenced commit events over a snapshot: its history grows without bound,
 * and the commit store is already the ordered log to cursor through.
 */
export function createMercurianPlanningAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const writeScheduler = createAtomCommandScheduler();
  return {
    tree: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mercurian:tree",
      tag: MERCURIAN_WS_METHODS.subscribeTree,
    }),
    plan: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mercurian:plan",
      tag: MERCURIAN_WS_METHODS.subscribePlan,
      transform: Stream.scan(EMPTY_PLAN_STATE, applyPlanStreamItem),
    }),
    createProject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:create-project",
      tag: MERCURIAN_WS_METHODS.createProject,
      scheduler: writeScheduler,
    }),
    createPlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:create-plan",
      tag: MERCURIAN_WS_METHODS.createPlan,
      scheduler: writeScheduler,
    }),
    appendPlanMessage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:append-plan-message",
      tag: MERCURIAN_WS_METHODS.appendPlanMessage,
      scheduler: writeScheduler,
      // Different plans do not wait on each other.
      concurrency: serialPerPlan,
    }),
    savePlanRevision: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:save-plan-revision",
      tag: MERCURIAN_WS_METHODS.savePlanRevision,
      scheduler: writeScheduler,
      // Shares the message key: an edit and a message both land at the tip, so
      // serializing them per plan is what keeps the local history linear.
      concurrency: serialPerPlan,
    }),
    /**
     * The lifecycle acts. All three ride `serialPerPlan` for the same reason a
     * message does: archiving a plan while its last edit is still in flight
     * should land after that edit, not race it.
     */
    archivePlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:archive-plan",
      tag: MERCURIAN_WS_METHODS.archivePlan,
      scheduler: writeScheduler,
      concurrency: serialPerPlan,
    }),
    unarchivePlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:unarchive-plan",
      tag: MERCURIAN_WS_METHODS.unarchivePlan,
      scheduler: writeScheduler,
      concurrency: serialPerPlan,
    }),
    deletePlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:delete-plan",
      tag: MERCURIAN_WS_METHODS.deletePlan,
      scheduler: writeScheduler,
      concurrency: serialPerPlan,
    }),
    /**
     * The artifact as of an earlier commit. A read, not a write — but history
     * above a commit is frozen, so there is nothing to order it against and no
     * concurrency key to give it.
     */
    getPlanTextAt: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:get-plan-text-at",
      tag: MERCURIAN_WS_METHODS.getPlanTextAt,
      scheduler: writeScheduler,
    }),
  };
}
