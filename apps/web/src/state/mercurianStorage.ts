import { useAtomValue } from "@effect/atom-react";
import { createMercurianStorageAtoms } from "@t3tools/client-runtime/state/mercurian-storage";
import type {
  StorageSourcesSnapshot,
  RefreshProjectSpecInput,
  ListProjectDocumentsInput,
  MercurianDesignateStorageSourceInput,
  MercurianProjectId,
  ProjectStorageSource,
  ProjectStorageKind,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentBoundCommandResult } from "./useEnvironmentBoundCommand";

export const mercurianStorage = createMercurianStorageAtoms(connectionAtomRuntime);

const EMPTY_STORAGE_SOURCES_ATOM = Atom.make(
  AsyncResult.initial<
    { readonly kind: "snapshot"; readonly snapshot: StorageSourcesSnapshot },
    never
  >(false),
);

const EMPTY_SNAPSHOT: StorageSourcesSnapshot = { sources: [] };

function errorMessage<A>(result: AsyncResult.AsyncResult<A, unknown>, fallback: string) {
  if (result._tag !== "Failure") return null;
  const cause = Cause.squash(result.cause);
  return cause instanceof Error ? cause.message : fallback;
}

export function useStorageSources() {
  const environmentId = usePrimaryEnvironmentId();
  const atom =
    environmentId === null
      ? EMPTY_STORAGE_SOURCES_ATOM
      : mercurianStorage.storageSources({ environmentId, input: {} });
  const result = useAtomValue(atom);
  const item = Option.getOrNull(AsyncResult.value(result));
  return {
    snapshot: item?.snapshot ?? EMPTY_SNAPSHOT,
    isPending: item === null && environmentId !== null,
    error: errorMessage(result, "Could not load storage designations."),
  } as const;
}

export function useStorageSourceForProject(
  projectId: MercurianProjectId | null,
  kind: ProjectStorageKind,
): ProjectStorageSource | null {
  const { snapshot } = useStorageSources();
  return useMemo(
    () =>
      snapshot.sources.find((source) => source.projectId === projectId && source.kind === kind) ??
      null,
    [projectId, kind, snapshot.sources],
  );
}

export function useDesignateStorageSource() {
  const run = useEnvironmentBoundCommandResult(mercurianStorage.designateStorageSource);
  return useCallback((input: MercurianDesignateStorageSourceInput) => run(input), [run]);
}

export function useRemoveStorageSource() {
  const run = useEnvironmentBoundCommandResult(mercurianStorage.removeStorageSource);
  return useCallback(
    (projectId: MercurianProjectId, kind: ProjectStorageKind) => run({ projectId, kind }),
    [run],
  );
}

export function useListProjectDocuments() {
  const run = useEnvironmentBoundCommandResult(mercurianStorage.listProjectDocuments);
  return useCallback((input: ListProjectDocumentsInput) => run(input), [run]);
}

export function useRefreshProjectSpec() {
  const run = useEnvironmentBoundCommandResult(mercurianStorage.refreshProjectSpec);
  return useCallback((input: RefreshProjectSpecInput) => run(input), [run]);
}
