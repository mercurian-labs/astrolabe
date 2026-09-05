import { MERCURIAN_DOCUMENT_WS_METHODS, MERCURIAN_STORAGE_WS_METHODS } from "@t3tools/contracts";
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
    refreshProjectSpec: createEnvironmentRpcCommand(runtime, {
      label: "project-documents:refresh",
      tag: MERCURIAN_DOCUMENT_WS_METHODS.refreshProjectSpec,
      scheduler: writeScheduler,
    }),
    listProjectDocuments: createEnvironmentRpcCommand(runtime, {
      label: "project-documents:list",
      tag: MERCURIAN_DOCUMENT_WS_METHODS.listProjectDocuments,
      scheduler: writeScheduler,
    }),
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
