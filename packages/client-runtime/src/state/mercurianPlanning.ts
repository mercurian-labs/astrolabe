import { MERCURIAN_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * Mercurian's planning data: the project tree as one live subscription, a plan
 * as a plain query, and the three acts that write.
 *
 * The tree arrives as a whole snapshot each time it changes rather than as
 * sequenced deltas — projects and plans are few, and they move only when a
 * person creates or messages one.
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
    plan: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:mercurian:plan",
      tag: MERCURIAN_WS_METHODS.getPlan,
      staleTimeMs: 5_000,
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
      // Messages in one plan land in the order they were sent; different plans
      // do not wait on each other.
      concurrency: {
        mode: "serial" as const,
        key: ({ environmentId, input }: { environmentId: string; input: { planId: string } }) =>
          JSON.stringify([environmentId, input.planId]),
      },
    }),
  };
}
