import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** Astrolabe: a checkout's Git tab: its changes by turn, its commits, and what to do with them. */
export function createGitClientEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-client:status",
      tag: WS_METHODS.gitClientStatus,
      // The worktree's watch and the status stream say when it changes.
      staleTimeMs: 30_000,
    }),
    log: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-client:log",
      tag: WS_METHODS.gitClientLog,
      staleTimeMs: 30_000,
    }),
    stage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-client:stage",
      tag: WS_METHODS.gitClientStage,
    }),
    unstage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-client:unstage",
      tag: WS_METHODS.gitClientUnstage,
    }),
    discard: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-client:discard",
      tag: WS_METHODS.gitClientDiscard,
    }),
    commit: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-client:commit",
      tag: WS_METHODS.gitClientCommit,
    }),
    generateCommitMessage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-client:generate-commit-message",
      tag: WS_METHODS.gitClientGenerateCommitMessage,
    }),
    undo: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-client:undo",
      tag: WS_METHODS.gitClientUndo,
    }),
    fetch: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-client:fetch",
      tag: WS_METHODS.gitClientFetch,
    }),
    pull: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-client:pull",
      tag: WS_METHODS.gitClientPull,
    }),
  };
}
