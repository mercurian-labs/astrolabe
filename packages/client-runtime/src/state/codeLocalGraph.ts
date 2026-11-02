import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/**
 * Astrolabe: a file's local graph in Repositories, from its repository's code index. A view reads
 * it again when the repository's index changes state or is updated (see `codeIndex.ts`).
 */
export function createCodeLocalGraphAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    localGraph: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:code-index:local-graph",
      tag: WS_METHODS.codeIndexLocalGraph,
      staleTimeMs: 10_000,
    }),
  };
}
