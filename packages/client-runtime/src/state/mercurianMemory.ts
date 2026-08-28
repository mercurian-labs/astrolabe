import { MERCURIAN_MEMORY_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Environment-scoped project-memory designation and fresh disk reads. */
export function createMercurianMemoryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const writeScheduler = createAtomCommandScheduler();
  return {
    memorySources: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mercurian:memory-sources",
      tag: MERCURIAN_MEMORY_WS_METHODS.subscribeMemorySources,
    }),
    designateMemorySource: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:designate-memory-source",
      tag: MERCURIAN_MEMORY_WS_METHODS.designateMemorySource,
      scheduler: writeScheduler,
    }),
    removeMemorySource: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:remove-memory-source",
      tag: MERCURIAN_MEMORY_WS_METHODS.removeMemorySource,
      scheduler: writeScheduler,
    }),
    readMemoryIndex: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:read-memory-index",
      tag: MERCURIAN_MEMORY_WS_METHODS.readMemoryIndex,
      scheduler: writeScheduler,
    }),
    readMemoryNote: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:read-memory-note",
      tag: MERCURIAN_MEMORY_WS_METHODS.readMemoryNote,
      scheduler: writeScheduler,
    }),
    writeMemoryNote: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:write-memory-note",
      tag: MERCURIAN_MEMORY_WS_METHODS.writeMemoryNote,
      scheduler: writeScheduler,
    }),
    generateProductMap: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:generate-product-map",
      tag: MERCURIAN_MEMORY_WS_METHODS.generateProductMap,
      scheduler: writeScheduler,
    }),
  };
}
