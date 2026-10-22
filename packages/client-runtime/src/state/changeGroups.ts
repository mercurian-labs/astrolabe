import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/**
 * Astrolabe: what people decided about each change group on an environment, and deciding more.
 * The groups themselves are derived where they are shown (`@t3tools/shared/changeGroups`).
 */
export function createChangeGroupEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    decisions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:change-groups:decisions",
      tag: WS_METHODS.changeGroupsList,
      staleTimeMs: 30_000,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:change-groups:update",
      tag: WS_METHODS.changeGroupsUpdate,
    }),
  };
}
