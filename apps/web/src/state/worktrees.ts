import { useAtomValue } from "@effect/atom-react";
import { createWorktreeEnvironmentAtoms } from "@t3tools/client-runtime/state/worktrees";
import type { EnvironmentId, ProjectId, ProjectWorktreeListResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

/** Astrolabe: a repository's worktrees and the work its branches set aside. */
export const worktreeEnvironment = createWorktreeEnvironmentAtoms(connectionAtomRuntime);

const NONE = Atom.make(AsyncResult.initial<ProjectWorktreeListResult, never>()).pipe(
  Atom.withLabel("worktrees:none"),
);

const listAtom = (environmentId: EnvironmentId, projectId: ProjectId) =>
  worktreeEnvironment.list({ environmentId, input: { projectId } });

/** A repository's worktrees; null until the first answer. */
export function useProjectWorktrees(
  target: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId } | null,
): ProjectWorktreeListResult | null {
  const result = useAtomValue(
    target === null ? NONE : listAtom(target.environmentId, target.projectId),
  );
  return Option.getOrNull(AsyncResult.value(result));
}

/** Reads a repository's worktrees again, after anything that changed them. */
export function refreshProjectWorktrees(environmentId: EnvironmentId, projectId: ProjectId) {
  appAtomRegistry.refresh(listAtom(environmentId, projectId));
}
