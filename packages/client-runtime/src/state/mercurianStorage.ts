import { MERCURIAN_STORAGE_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Environment-scoped project-storage designation and fresh disk reads. */
export function createMercurianStorageAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const writeScheduler = createAtomCommandScheduler();
  return {
    storageSources: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mercurian:storage-sources",
      tag: MERCURIAN_STORAGE_WS_METHODS.subscribeStorageSources,
    }),
    designateStorageSource: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:designate-storage-source",
      tag: MERCURIAN_STORAGE_WS_METHODS.designateStorageSource,
      scheduler: writeScheduler,
    }),
    removeStorageSource: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:remove-storage-source",
      tag: MERCURIAN_STORAGE_WS_METHODS.removeStorageSource,
      scheduler: writeScheduler,
    }),
  };
}
