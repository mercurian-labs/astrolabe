import * as StorageSourceStore from "../storage/StorageSourceStore.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  MemorySourceInvalidError,
  MercurianProjectId,
  MercurianRepositoryId,
} from "@t3tools/contracts";

import { PersistenceDecodeError, PersistenceSqlError } from "../../persistence/Errors.ts";
import type { MemorySource, ResolvedMemorySource } from "./schema.ts";

export type MemorySourceStoreError =
  | MemorySourceInvalidError
  | PersistenceSqlError
  | PersistenceDecodeError;

export interface DesignateMemorySourceInput {
  readonly projectId: MercurianProjectId;
  readonly repositoryId: MercurianRepositoryId;
  readonly subpath?: string | undefined;
  readonly now: typeof Schema.DateTimeUtcFromString.Type;
}

export class MemorySourceStore extends Context.Service<
  MemorySourceStore,
  {
    readonly designate: (
      input: DesignateMemorySourceInput,
    ) => Effect.Effect<void, MemorySourceStoreError>;
    readonly remove: (projectId: MercurianProjectId) => Effect.Effect<void, MemorySourceStoreError>;
    readonly getSnapshot: Effect.Effect<ReadonlyArray<MemorySource>, MemorySourceStoreError>;
    readonly getSource: (
      projectId: MercurianProjectId,
    ) => Effect.Effect<Option.Option<MemorySource>, MemorySourceStoreError>;
    readonly getResolvedSource: (
      projectId: MercurianProjectId,
    ) => Effect.Effect<Option.Option<ResolvedMemorySource>, MemorySourceStoreError>;
    readonly changes: Stream.Stream<void>;
  }
>()("t3/mercurian/memory/MemorySourceStore") {}

/** Memory behavior consumes the shared location authority. */
export const make = Effect.gen(function* () {
  const storage = yield* StorageSourceStore.StorageSourceStore;
  return MemorySourceStore.of({
    designate: (input) => storage.designate({ ...input, kind: "memory" }),
    remove: (projectId) => storage.remove(projectId, "memory"),
    getSnapshot: storage.getSnapshot.pipe(
      Effect.map((sources) => sources.filter((source) => source.kind === "memory")),
    ),
    getSource: (projectId) => storage.getSource(projectId, "memory"),
    getResolvedSource: (projectId) => storage.getResolvedSource(projectId, "memory"),
    changes: storage.changes,
  });
});
export const layer = Layer.effect(MemorySourceStore, make).pipe(
  Layer.provideMerge(StorageSourceStore.layer),
);
