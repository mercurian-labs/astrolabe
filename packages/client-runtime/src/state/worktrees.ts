import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/**
 * Astrolabe: a repository's worktrees, the work its branches set aside, and opening, making,
 * keeping and deleting them.
 */
export function createWorktreeEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:worktrees:list",
      tag: WS_METHODS.worktreesList,
      staleTimeMs: 10_000,
    }),
    open: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktrees:open",
      tag: WS_METHODS.worktreesOpen,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktrees:create",
      tag: WS_METHODS.worktreesCreate,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktrees:remove",
      tag: WS_METHODS.worktreesRemove,
    }),
    setKept: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktrees:set-kept",
      tag: WS_METHODS.worktreesSetKept,
    }),
    discardSetAside: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:worktrees:discard-set-aside",
      tag: WS_METHODS.worktreesDiscardSetAside,
    }),
  };
}
