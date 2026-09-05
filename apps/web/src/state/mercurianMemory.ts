import { useAtomValue } from "@effect/atom-react";
import { createMercurianMemoryAtoms } from "@t3tools/client-runtime/state/mercurian-memory";
import type {
  MemorySourcesSnapshot,
  EnvironmentId,
  MemoryLineRef,
  MercurianDesignateMemorySourceInput,
  MercurianProjectId,
  MercurianReadMemoryNoteInput,
  MercurianReadLineMemoryChangesInput,
  MercurianMarkMemoryChangeReviewedInput,
  MercurianRevertMemoryChangeInput,
  MercurianMergeMemoryHomeInput,
  ProjectMemorySource,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentBoundCommandResult } from "./useEnvironmentBoundCommand";

export const mercurianMemory = createMercurianMemoryAtoms(connectionAtomRuntime);

const EMPTY_MEMORY_SOURCES_ATOM = Atom.make(
  AsyncResult.initial<
    { readonly kind: "snapshot"; readonly snapshot: MemorySourcesSnapshot },
    never
  >(false),
);

const EMPTY_SNAPSHOT: MemorySourcesSnapshot = { sources: [] };

function errorMessage<A>(result: AsyncResult.AsyncResult<A, unknown>, fallback: string) {
  if (result._tag !== "Failure") return null;
  const cause = Cause.squash(result.cause);
  return cause instanceof Error ? cause.message : fallback;
}

export function useMemorySources() {
  const environmentId = usePrimaryEnvironmentId();
  const atom =
    environmentId === null
      ? EMPTY_MEMORY_SOURCES_ATOM
      : mercurianMemory.memorySources({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const item = Option.getOrNull(AsyncResult.value(result));
  return {
    snapshot: item?.snapshot ?? EMPTY_SNAPSHOT,
    isPending: item === null && environmentId !== null,
    error: errorMessage(result, "Could not load memory designations."),
  } as const;
}

export function useMemorySourceForProject(
  projectId: MercurianProjectId | null,
): ProjectMemorySource | null {
  const { snapshot } = useMemorySources();
  return useMemo(
    () => snapshot.sources.find((source) => source.projectId === projectId) ?? null,
    [projectId, snapshot.sources],
  );
}

export function useDesignateMemorySource() {
  const run = useEnvironmentBoundCommandResult(mercurianMemory.designateMemorySource);
  return useCallback((input: MercurianDesignateMemorySourceInput) => run(input), [run]);
}

export function useRemoveMemorySource() {
  const run = useEnvironmentBoundCommandResult(mercurianMemory.removeMemorySource);
  return useCallback((projectId: MercurianProjectId) => run({ projectId }), [run]);
}

export function useReadMemoryIndex() {
  const run = useEnvironmentBoundCommandResult(mercurianMemory.readMemoryIndex);
  return useCallback(
    (projectId: MercurianProjectId, line?: MemoryLineRef) =>
      run({ projectId, ...(line === undefined ? {} : { line }) }),
    [run],
  );
}

export function useReadMemoryNote() {
  const run = useEnvironmentBoundCommandResult(mercurianMemory.readMemoryNote);
  return useCallback((input: MercurianReadMemoryNoteInput) => run(input), [run]);
}

export function useReadLineMemoryChanges(environmentId?: EnvironmentId | null) {
  const run = useEnvironmentBoundCommandResult(
    mercurianMemory.readLineMemoryChanges,
    environmentId,
  );
  return useCallback((input: MercurianReadLineMemoryChangesInput) => run(input), [run]);
}

export function useMarkMemoryChangeReviewed(environmentId?: EnvironmentId | null) {
  const run = useEnvironmentBoundCommandResult(
    mercurianMemory.markMemoryChangeReviewed,
    environmentId,
  );
  return useCallback((input: MercurianMarkMemoryChangeReviewedInput) => run(input), [run]);
}

export function useRevertMemoryChange(environmentId?: EnvironmentId | null) {
  const run = useEnvironmentBoundCommandResult(mercurianMemory.revertMemoryChange, environmentId);
  return useCallback((input: MercurianRevertMemoryChangeInput) => run(input), [run]);
}

export function useMergeMemoryHome(environmentId?: EnvironmentId | null) {
  const run = useEnvironmentBoundCommandResult(mercurianMemory.mergeMemoryHome, environmentId);
  return useCallback((input: MercurianMergeMemoryHomeInput) => run(input), [run]);
}

export function useGenerateProductMap() {
  const run = useEnvironmentBoundCommandResult(mercurianMemory.generateProductMap);
  return useCallback((projectId: MercurianProjectId) => run({ projectId }), [run]);
}
