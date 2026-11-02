import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  createWorktreeEnvironmentAtoms,
  type WorktreeWatch,
} from "@t3tools/client-runtime/state/worktrees";
import type {
  EnvironmentId,
  ProjectId,
  ProjectWorktreeListResult,
  ProjectWorktreeOwner,
  ProjectWorktreeStatusResult,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect } from "react";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

/** Astrolabe: a repository's worktrees and the work its branches set aside. */
export const worktreeEnvironment = createWorktreeEnvironmentAtoms(connectionAtomRuntime);

const NONE = Atom.make(AsyncResult.initial<ProjectWorktreeListResult, never>()).pipe(
  Atom.withLabel("worktrees:none"),
);

/** Whose worktrees, on which environment: a project's, or a wiki's own folder. */
export type WorktreesTarget = { readonly environmentId: EnvironmentId } & ProjectWorktreeOwner;

/** A project's worktrees. */
export const projectWorktrees = (project: {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
}): WorktreesTarget => ({ environmentId: project.environmentId, projectId: project.id });

/** The owner part of a worktree request, without the environment. */
export const worktreeOwner = (target: WorktreesTarget): ProjectWorktreeOwner =>
  "wikiId" in target ? { wikiId: target.wikiId } : { projectId: target.projectId };

const listAtom = (target: WorktreesTarget) =>
  worktreeEnvironment.list({ environmentId: target.environmentId, input: worktreeOwner(target) });

const atomOf = (target: WorktreesTarget | null) => (target === null ? NONE : listAtom(target));

/**
 * A repository's worktrees as last read, for what only labels by them (a tab per file), so the
 * window coming back reads them once, not once per label.
 */
export function useListedProjectWorktrees(
  target: WorktreesTarget | null,
): ProjectWorktreeListResult | null {
  return Option.getOrNull(AsyncResult.value(useAtomValue(atomOf(target))));
}

/** A repository's worktrees, read again when the window comes back; null until the first answer. */
export function useProjectWorktrees(
  target: WorktreesTarget | null,
): ProjectWorktreeListResult | null {
  const atom = atomOf(target);
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  // oxlint-disable-next-line t3code/react-effect-budget -- edits outside the app (an editor, an agent) change what the worktrees hold
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  return Option.getOrNull(AsyncResult.value(result));
}

const manyAtom = Atom.family((key: string) =>
  Atom.make((get): ReadonlyArray<ProjectWorktreeListResult | null> =>
    (JSON.parse(key) as WorktreesTarget[]).map((target) =>
      Option.getOrNull(AsyncResult.value(get(atomOf(target)))),
    ),
  ).pipe(Atom.withLabel(`worktrees:many:${key}`)),
);

/**
 * Several repositories' worktrees, in `targets`' order, each null until its first answer; read
 * again, once each, when the window comes back.
 */
export function useManyProjectWorktrees(
  targets: ReadonlyArray<WorktreesTarget>,
): ReadonlyArray<ProjectWorktreeListResult | null> {
  const key = JSON.stringify(
    targets.map((target) => ({ environmentId: target.environmentId, ...worktreeOwner(target) })),
  );
  // oxlint-disable-next-line t3code/react-effect-budget -- edits outside the app (an editor, an agent) change what the worktrees hold
  useEffect(() => {
    const refresh = () => {
      for (const target of JSON.parse(key) as WorktreesTarget[]) {
        appAtomRegistry.refresh(atomOf(target));
      }
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [key]);
  return useAtomValue(manyAtom(key));
}

const NO_STATUS = Atom.make(AsyncResult.initial<ProjectWorktreeStatusResult, never>()).pipe(
  Atom.withLabel("worktrees:status:none"),
);

const statusAtom = (target: WorktreesTarget | null, path: string) =>
  target === null
    ? NO_STATUS
    : worktreeEnvironment.status({
        environmentId: target.environmentId,
        input: { ...worktreeOwner(target), path },
      });

/**
 * One worktree's uncommitted files, counted when something shows it (a list leaves them
 * uncounted, as counting runs git status in each); null until counted.
 */
export function useWorktreeChangedFiles(target: WorktreesTarget | null, path: string) {
  const result = useAtomValue(statusAtom(target, path));
  return Option.getOrNull(AsyncResult.value(result))?.changedFiles ?? null;
}

const NO_WATCH = Atom.make(AsyncResult.initial<WorktreeWatch, never>()).pipe(
  Atom.withLabel("worktrees:watch:none"),
);

const countsDue = new Map<string, ReturnType<typeof setTimeout>>();

/** Counts a worktree's uncommitted files again shortly, once for however many changes land. */
export function refreshWorktreeChangedFilesSoon(target: WorktreesTarget, path: string) {
  const key = JSON.stringify({
    environmentId: target.environmentId,
    ...worktreeOwner(target),
    path,
  });
  if (countsDue.has(key)) return;
  countsDue.set(
    key,
    setTimeout(() => {
      countsDue.delete(key);
      appAtomRegistry.refresh(statusAtom(target, path));
    }, 500),
  );
}

interface CountedWorktree {
  readonly target: WorktreesTarget;
  readonly path: string;
}

const manyCountsAtom = Atom.family((key: string) =>
  Atom.make((get): ReadonlyArray<number | null> =>
    (JSON.parse(key) as CountedWorktree[]).map(
      ({ target, path }) =>
        Option.getOrNull(AsyncResult.value(get(statusAtom(target, path))))?.changedFiles ?? null,
    ),
  ).pipe(Atom.withLabel(`worktrees:counts:${key}`)),
);

/** Several worktrees' uncommitted files, in `worktrees`' order, each null until counted. */
export function useManyWorktreeChangedFiles(
  worktrees: ReadonlyArray<CountedWorktree>,
): ReadonlyArray<number | null> {
  const key = JSON.stringify(
    worktrees.map(({ target, path }) => ({
      target: { environmentId: target.environmentId, ...worktreeOwner(target) },
      path,
    })),
  );
  return useAtomValue(manyCountsAtom(key));
}

/** Reads a repository's worktrees again, after anything that changed them. */
export function refreshProjectWorktrees(target: WorktreesTarget) {
  appAtomRegistry.refresh(listAtom(target));
}

const refreshesDue = new Map<string, ReturnType<typeof setTimeout>>();

/** Reads a repository's worktrees again shortly, once for however many changes land meanwhile. */
export function refreshProjectWorktreesSoon(target: WorktreesTarget) {
  const key = JSON.stringify({ environmentId: target.environmentId, ...worktreeOwner(target) });
  if (refreshesDue.has(key)) return;
  refreshesDue.set(
    key,
    setTimeout(() => {
      refreshesDue.delete(key);
      refreshProjectWorktrees(target);
    }, 500),
  );
}

/** A worktree's watch for changes on disk; null until it reports anything. */
export function useWorktreeWatch(
  target: WorktreesTarget | null,
  path: string,
): WorktreeWatch | null {
  const result = useAtomValue(
    target === null
      ? NO_WATCH
      : worktreeEnvironment.changes({
          environmentId: target.environmentId,
          input: { ...worktreeOwner(target), path },
        }),
  );
  return Option.getOrNull(AsyncResult.value(result));
}
