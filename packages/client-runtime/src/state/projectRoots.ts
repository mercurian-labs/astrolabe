import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** Astrolabe: a project's roots (its folder and the folders it tracks), and what Docs keeps of one. */
export function createProjectRootsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:project-roots:list",
      tag: WS_METHODS.projectRootsList,
      staleTimeMs: 10_000,
    }),
    docPaths: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:project-roots:doc-paths",
      tag: WS_METHODS.projectRootsDocPaths,
      staleTimeMs: 10_000,
    }),
  };
}
