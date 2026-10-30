import {
  WS_METHODS,
  type CodeIndexStatus,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

const NO_STATUSES: ReadonlyMap<ProjectId, CodeIndexStatus> = new Map();

const count = (value: number, noun: string) =>
  `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;

/** One line for a repository's index: its state, how far it got, and how fresh it is. */
export function describeCodeIndexStatus(
  status: CodeIndexStatus,
  ago: (isoDate: string) => string,
): string {
  const progress = `${status.files.toLocaleString()} of ${count(status.totalFiles, "file")}`;
  switch (status.state) {
    case "off":
      return "Off";
    case "waiting":
      return status.files === 0
        ? "Waiting for background activity to allow indexing"
        : `Waiting for background activity · ${progress}`;
    case "indexing":
      return `Indexing · ${progress}`;
    case "failed":
      return `Failed${status.failure === null ? "" : `: ${status.failure}`}`;
    case "ready":
      return [
        `Ready · ${count(status.totalFiles, "file")}`,
        status.languages.length > 0 ? status.languages.join(", ") : null,
        status.updatedAt === null ? null : `updated ${ago(status.updatedAt)}`,
      ]
        .filter(Boolean)
        .join(" · ");
  }
}

/**
 * Astrolabe: each repository's code index. Statuses stream from the server, one repository at a
 * time, and are kept per project. Storage is read when a view asks and again after a cleanup or
 * clear; the maintenance commands are permission-guarded.
 */
export function createCodeIndexEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const statusStream = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:code-index:statuses",
    tag: WS_METHODS.codeIndexSubscribe,
    transform: (stream) =>
      stream.pipe(
        Stream.scan(
          (): ReadonlyMap<ProjectId, CodeIndexStatus> => NO_STATUSES,
          (byProject, status) => new Map(byProject).set(status.projectId, status),
        ),
      ),
  });

  /** Every repository's status on an environment; empty until the first arrives. */
  const statuses = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyMap<ProjectId, CodeIndexStatus> =>
      Option.getOrElse(
        AsyncResult.value(get(statusStream({ environmentId, input: {} }))),
        () => NO_STATUSES,
      ),
    ).pipe(Atom.withLabel(`environment-data:code-index:statuses:${environmentId}`)),
  );

  const statusByKey = Atom.family((key: string) => {
    const [environmentId, projectId] = JSON.parse(key) as [EnvironmentId, ProjectId];
    return Atom.make((get) => get(statuses(environmentId)).get(projectId) ?? null).pipe(
      Atom.withLabel(`environment-data:code-index:status:${key}`),
    );
  });

  const storageQuery = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:code-index:storage",
    tag: WS_METHODS.codeIndexStorage,
  });
  const storage = (environmentId: EnvironmentId) => storageQuery({ environmentId, input: {} });

  return {
    statuses,
    /** One repository's status; null until the environment reports it. */
    status: (environmentId: EnvironmentId, projectId: ProjectId) =>
      statusByKey(JSON.stringify([environmentId, projectId])),
    storage,
    rebuild: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:code-index:rebuild",
      tag: WS_METHODS.codeIndexRebuild,
    }),
    prune: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:code-index:prune",
      tag: WS_METHODS.codeIndexPrune,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(storage(environmentId))),
    }),
    clear: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:code-index:clear",
      tag: WS_METHODS.codeIndexClear,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(storage(environmentId))),
    }),
  };
}
