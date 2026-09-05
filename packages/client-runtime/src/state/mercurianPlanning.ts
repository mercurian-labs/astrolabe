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
    /**
     * Import an issue as a plan. On the write scheduler with no concurrency key
     * of its own: it names no plan yet, and the server's origin uniqueness — not
     * client ordering — is what makes importing one issue twice idempotent.
     */
    importPlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:import-plan",
      tag: MERCURIAN_WS_METHODS.importPlan,
      scheduler: writeScheduler,
    }),
    ensureProjectRuntime: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:ensure-project-runtime",
      tag: MERCURIAN_WS_METHODS.ensureProjectRuntime,
      scheduler: writeScheduler,
    }),
    forkLine: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:fork-line",
      tag: MERCURIAN_WS_METHODS.forkLine,
      scheduler: writeScheduler,
      concurrency: serialPerPlan,
    }),
    openLine: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:open-line",
      tag: MERCURIAN_WS_METHODS.openLine,
      scheduler: writeScheduler,
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
    saveSpecRevision: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:save-spec-revision",
      tag: MERCURIAN_WS_METHODS.saveSpecRevision,
      scheduler: writeScheduler,
      concurrency: serialPerPlan,
    }),
    refreshSpec: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:refresh-spec",
      tag: MERCURIAN_WS_METHODS.refreshSpec,
      scheduler: writeScheduler,
      concurrency: serialPerPlan,
    }),
    recreateLineBranch: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:recreate-line-branch",
      tag: MERCURIAN_WS_METHODS.recreateLineBranch,
      scheduler: writeScheduler,
    }),
    /**
     * You opened a plan. A write: what it changes is read by every window off
     * the tree, so it shares the plan's key — a visit and a mark-unread on one
     * plan must not land out of the order they were made in.
     */
    visitPlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:visit-plan",
      tag: MERCURIAN_WS_METHODS.visitPlan,
      scheduler: writeScheduler,
      concurrency: serialPerPlan,
    }),
    markPlanUnread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:mark-plan-unread",
      tag: MERCURIAN_WS_METHODS.markPlanUnread,
      scheduler: writeScheduler,
      concurrency: serialPerPlan,
    }),
    /**
     * The lifecycle acts, on the same key for the same reason: archiving a plan
     * while its last edit is still in flight should land after that edit, not
     * race it.
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
    getSpecAt: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:get-spec-at",
      tag: MERCURIAN_WS_METHODS.getSpecAt,
      scheduler: writeScheduler,
    }),
  };
}
