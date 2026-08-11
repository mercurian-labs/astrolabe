import { useAtomValue } from "@effect/atom-react";
import { createMercurianRepositoryAtoms } from "@t3tools/client-runtime/state/mercurian-repositories";
import type {
  MercurianAddRepositoryInput,
  MercurianProjectId,
  MercurianRepositoriesSnapshot,
  MercurianRepository,
  MercurianRepositoryId,
  MercurianRepositoryScriptInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import {
  useEnvironmentBoundCommand,
  useEnvironmentBoundCommandResult,
} from "./useEnvironmentBoundCommand";

export const mercurianRepositories = createMercurianRepositoryAtoms(connectionAtomRuntime);

const EMPTY_REPOSITORIES_ATOM = Atom.make(
  AsyncResult.initial<
    { readonly kind: "snapshot"; readonly snapshot: MercurianRepositoriesSnapshot },
    never
  >(false),
);

const EMPTY_SNAPSHOT: MercurianRepositoriesSnapshot = {
  repositories: [],
  projectRepositories: [],
};

function errorMessage<A>(result: AsyncResult.AsyncResult<A, unknown>, fallback: string) {
  if (result._tag !== "Failure") return null;
  const cause = Cause.squash(result.cause);
  return cause instanceof Error ? cause.message : fallback;
}

export interface MercurianRepositoriesState {
  readonly snapshot: MercurianRepositoriesSnapshot;
  /** `true` until the first snapshot lands; the page renders its empty state meanwhile. */
  readonly isPending: boolean;
  readonly error: string | null;
}

/**
 * The registry, live. One subscription answers both "what code can Mercurian
 * reach" and "which repositories is this project working in" — a set changes
 * when the registry does, including the cascade a removal leaves behind.
 */
export function useRepositories(): MercurianRepositoriesState {
  const environmentId = usePrimaryEnvironmentId();
  const atom =
    environmentId === null
      ? EMPTY_REPOSITORIES_ATOM
      : mercurianRepositories.repositories({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const item = Option.getOrNull(AsyncResult.value(result));
  return {
    snapshot: item?.snapshot ?? EMPTY_SNAPSHOT,
    isPending: item === null && environmentId !== null,
    error: errorMessage(result, "Could not load repositories."),
  };
}

/** The repositories a project is working in, in registry order. */
export function useProjectRepositories(
  projectId: MercurianProjectId | null,
): ReadonlyArray<MercurianRepository> {
  const { snapshot } = useRepositories();
  return useMemo(() => {
    if (projectId === null) return [];
    const inSet = new Set(
      snapshot.projectRepositories
        .filter((link) => link.projectId === projectId)
        .map((link) => link.repositoryId),
    );
    return snapshot.repositories.filter((repository) => inSet.has(repository.repositoryId));
  }, [projectId, snapshot]);
}

/**
 * Register a directory. Its refusals are the surface's — a path that is not a
 * directory, or one already registered — so they come back rather than
 * becoming a toast the dialog cannot answer.
 */
export function useAddRepository() {
  const run = useEnvironmentBoundCommandResult(mercurianRepositories.addRepository);
  return useCallback((input: MercurianAddRepositoryInput) => run(input), [run]);
}

/** Re-probe git and hosting facts, then re-emit the repository snapshot. */
export function useRefreshRepositories() {
  const run = useEnvironmentBoundCommand(mercurianRepositories.refreshRepositories);
  return useCallback(() => run({}), [run]);
}

/**
 * Disconnect a repository. Refused while the app holds live worktrees on it,
 * and the confirm dialog says so in place — there is no force path.
 */
export function useRemoveRepository() {
  const run = useEnvironmentBoundCommandResult(mercurianRepositories.removeRepository);
  return useCallback((repositoryId: MercurianRepositoryId) => run({ repositoryId }), [run]);
}

/** The repository's whole script list after the edit. */
export function useSaveRepositoryScripts() {
  const run = useEnvironmentBoundCommand(mercurianRepositories.saveRepositoryScripts);
  return useCallback(
    (repositoryId: MercurianRepositoryId, scripts: ReadonlyArray<MercurianRepositoryScriptInput>) =>
      run({ repositoryId, scripts }),
    [run],
  );
}

/** The project's whole set after the edit. Context, never a stamp. */
export function useSetProjectRepositories() {
  const run = useEnvironmentBoundCommand(mercurianRepositories.setProjectRepositories);
  return useCallback(
    (projectId: MercurianProjectId, repositoryIds: ReadonlyArray<MercurianRepositoryId>) =>
      run({ projectId, repositoryIds }),
    [run],
  );
}
