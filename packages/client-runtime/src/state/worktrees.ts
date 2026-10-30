import { type ProjectWorktreeChange, WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** What a worktree's watch has reported so far. The counts move with each change. */
export interface WorktreeWatch {
  /** Changes of any kind, to files, folders or git state. */
  readonly changes: number;
  /** Changes that added or removed something in a folder. */
  readonly listings: number;
  /** Why the worktree can't be watched; null while it is. */
  readonly unwatched: string | null;
}

const WATCH_START: WorktreeWatch = { changes: 0, listings: 0, unwatched: null };

const foldWorktreeChange = (watch: WorktreeWatch, change: ProjectWorktreeChange): WorktreeWatch =>
  change._tag === "unwatched"
    ? { ...watch, unwatched: change.reason }
    : {
        ...watch,
        changes: watch.changes + 1,
        listings:
          change.directories === null || change.directories.length > 0
            ? watch.listings + 1
            : watch.listings,
      };

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
    changes: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:worktrees:changes",
      tag: WS_METHODS.worktreesSubscribeChanges,
      // The server keeps watching while anyone subscribes, so let go soon after nobody reads.
      idleTtlMs: 10_000,
      transform: (changes) =>
        changes.pipe(
          Stream.mapAccum(
            () => WATCH_START,
            (watch, change) => {
              const next = foldWorktreeChange(watch, change);
              return [next, [next]] as const;
            },
          ),
        ),
    }),
  };
}
