import { MERCURIAN_REPOSITORY_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * Mercurian's repository registry: what code the app can reach, live, plus the
 * four acts that change it.
 *
 * The registry arrives as a whole snapshot each time it changes rather than as
 * sequenced deltas — repositories are few, and they move only when a person
 * adds, removes, or reassigns one. Project sets ride the same snapshot,
 * including the cascade a removal leaves behind: freshness follows the signal
 * that owns the change.
 *
 * The writes share one scheduler and take no concurrency key. Repository
 * mutations are rare and a person makes them one at a time, so global ordering
 * costs nothing and keeps every reader's view of "what happened last" simple.
 */
export function createMercurianRepositoryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const writeScheduler = createAtomCommandScheduler();
  return {
    repositories: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:mercurian:repositories",
      tag: MERCURIAN_REPOSITORY_WS_METHODS.subscribeRepositories,
    }),
    addRepository: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:add-repository",
      tag: MERCURIAN_REPOSITORY_WS_METHODS.addRepository,
      scheduler: writeScheduler,
    }),
    removeRepository: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:remove-repository",
      tag: MERCURIAN_REPOSITORY_WS_METHODS.removeRepository,
      scheduler: writeScheduler,
    }),
    saveRepositoryScripts: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:save-repository-scripts",
      tag: MERCURIAN_REPOSITORY_WS_METHODS.saveRepositoryScripts,
      scheduler: writeScheduler,
    }),
    setProjectRepositories: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:mercurian:set-project-repositories",
      tag: MERCURIAN_REPOSITORY_WS_METHODS.setProjectRepositories,
      scheduler: writeScheduler,
    }),
  };
}
