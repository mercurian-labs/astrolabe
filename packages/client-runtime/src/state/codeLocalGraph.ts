import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** How often a local graph reads again while its repository's index is still building. */
const LOCAL_GRAPH_INDEXING_REFRESH_MS = 2_000;

/**
 * Astrolabe: a file's local graph in Repositories, from its repository's code index. While the
 * index builds (`usedByPending`) the graph reads again until it is whole, which is also how its
 * progress moves on; once whole, it reads again only when it goes stale and a view asks.
 */
export function createCodeLocalGraphAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    localGraph: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:code-index:local-graph",
      tag: WS_METHODS.codeIndexLocalGraph,
      staleTimeMs: 10_000,
      refreshIntervalMs: LOCAL_GRAPH_INDEXING_REFRESH_MS,
      isFinal: (graph) => !graph.usedByPending,
    }),
  };
}
