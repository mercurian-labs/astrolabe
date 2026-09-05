import * as Schema from "effect/Schema";
import { IsoDateTime } from "./baseSchemas.ts";
import { MercurianProjectId } from "./mercurian.ts";
import { MercurianRepositoryId } from "./mercurianRepositories.ts";

export const ProjectStorageKind = Schema.Literals(["memory", "plan", "spec"]);
export type ProjectStorageKind = typeof ProjectStorageKind.Type;
export const ProjectStorageSource = Schema.Struct({
  projectId: MercurianProjectId,
  kind: ProjectStorageKind,
  repositoryId: MercurianRepositoryId,
  subpath: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectStorageSource = typeof ProjectStorageSource.Type;
export const StorageSourcesSnapshot = Schema.Struct({
  sources: Schema.Array(ProjectStorageSource),
});
export type StorageSourcesSnapshot = typeof StorageSourcesSnapshot.Type;
export const StorageSourcesStreamItem = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  snapshot: StorageSourcesSnapshot,
});
export const MercurianSubscribeStorageSourcesInput = Schema.Struct({});
export const MercurianDesignateStorageSourceInput = Schema.Struct({
  projectId: MercurianProjectId,
  kind: ProjectStorageKind,
  repositoryId: MercurianRepositoryId,
  subpath: Schema.optional(Schema.String),
});
export type MercurianDesignateStorageSourceInput = typeof MercurianDesignateStorageSourceInput.Type;
export const MercurianRemoveStorageSourceInput = Schema.Struct({
  projectId: MercurianProjectId,
  kind: ProjectStorageKind,
});
export const MERCURIAN_STORAGE_WS_METHODS = {
  subscribeStorageSources: "mercurian.subscribeStorageSources",
  designateStorageSource: "mercurian.designateStorageSource",
  removeStorageSource: "mercurian.removeStorageSource",
} as const;
export class MercurianStorageError extends Schema.TaggedErrorClass<MercurianStorageError>()(
  "MercurianStorageError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return `Project storage operation ${this.operation} failed`;
  }
}
