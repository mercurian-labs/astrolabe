import { MERCURIAN_MEMORY_WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
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
    readMemoryCatalog: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:read-memory-catalog",
      tag: MERCURIAN_MEMORY_WS_METHODS.readMemoryCatalog,
    }),
    readMemoryDashboard: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:readMemoryDashboard",
      tag: MERCURIAN_MEMORY_WS_METHODS.readMemoryDashboard,
    }),
    readMemoryDocument: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:readMemoryDocument",
      tag: MERCURIAN_MEMORY_WS_METHODS.readMemoryDocument,
    }),
    readMemoryComparison: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:readMemoryComparison",
      tag: MERCURIAN_MEMORY_WS_METHODS.readMemoryComparison,
    }),
    // Every signal is the same `{ kind: "invalidate" }`; the index makes each one a distinct value
    // so subscribers refresh on every emission rather than on wrapper identity.
    subscribeMemoryInvalidations: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mercurian:subscribeMemoryInvalidations",
      tag: MERCURIAN_MEMORY_WS_METHODS.subscribeMemoryInvalidations,
      transform: Stream.zipWithIndex,
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
    readLineMemoryChanges: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:read-line-memory-changes",
      tag: MERCURIAN_MEMORY_WS_METHODS.readLineMemoryChanges,
      scheduler: writeScheduler,
    }),
    markMemoryChangeReviewed: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:mark-memory-change-reviewed",
      tag: MERCURIAN_MEMORY_WS_METHODS.markMemoryChangeReviewed,
      scheduler: writeScheduler,
    }),
    revertMemoryChange: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:revert-memory-change",
      tag: MERCURIAN_MEMORY_WS_METHODS.revertMemoryChange,
      scheduler: writeScheduler,
    }),
    mergeMemoryHome: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:merge-memory-home",
      tag: MERCURIAN_MEMORY_WS_METHODS.mergeMemoryHome,
      scheduler: writeScheduler,
    }),
    generateProductMap: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:generate-product-map",
      tag: MERCURIAN_MEMORY_WS_METHODS.generateProductMap,
      scheduler: writeScheduler,
    }),
  };
}
