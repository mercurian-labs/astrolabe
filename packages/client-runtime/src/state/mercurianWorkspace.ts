import { MERCURIAN_WORKSPACE_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcSubscriptionAtomFamily } from "./runtime.ts";

/**
 * Mercurian's workspace-scoped last-used planning seed.
 *
 * The subscription re-sends the whole value on every change — there are a
 * single small snapshot and it moves only when a stamped turn opens, so there
 * is nothing worth cursoring through. The planning model arrives as the
 * abstract provider/model pair; turning that into an instance is a question
 * only the machine can answer, and `resolvePlanningModel` in contracts answers
 * it against live provider snapshots rather than anything stored.
 */
export function createMercurianWorkspaceAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    settings: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mercurian:workspace-settings",
      tag: MERCURIAN_WORKSPACE_WS_METHODS.subscribeWorkspaceSettings,
    }),
  };
}
