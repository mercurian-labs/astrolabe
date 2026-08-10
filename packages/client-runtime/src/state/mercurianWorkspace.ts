import { MERCURIAN_WORKSPACE_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createAtomCommandScheduler, createEnvironmentRpcCommand } from "./runtime.ts";
import { createEnvironmentRpcSubscriptionAtomFamily } from "./runtime.ts";

/**
 * Mercurian's workspace settings: the ones that belong to the workspace rather
 * than to the machine it is being read on.
 *
 * The subscription re-sends the whole value on every change — there are a
 * handful of these settings and they move only when a person changes one, so
 * there is nothing worth cursoring through. The planning model arrives as the
 * abstract provider/model pair; turning that into an instance is a question
 * only the machine can answer, and `resolvePlanningModel` in contracts answers
 * it against live provider snapshots rather than anything stored.
 */
export function createMercurianWorkspaceAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const writeScheduler = createAtomCommandScheduler();
  return {
    settings: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mercurian:workspace-settings",
      tag: MERCURIAN_WORKSPACE_WS_METHODS.subscribeWorkspaceSettings,
    }),
    /**
     * Naming the workspace's planning model is a rare, deliberate act, so the
     * shared write scheduler's global ordering costs nothing and keeps two
     * windows from landing out of order.
     */
    setPlanningModel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:set-planning-model",
      tag: MERCURIAN_WORKSPACE_WS_METHODS.setPlanningModel,
      scheduler: writeScheduler,
    }),
  };
}
