import * as Schema from "effect/Schema";
import { MercurianProjectId, MercurianRepositoryId, ProjectStorageKind } from "@t3tools/contracts";
export const StorageSource = Schema.Struct({
  projectId: MercurianProjectId,
  kind: ProjectStorageKind,
  repositoryId: MercurianRepositoryId,
  subpath: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type StorageSource = typeof StorageSource.Type;
export interface ResolvedStorageSource extends StorageSource {
  readonly repositoryName: string;
  readonly repositoryPath: string;
  readonly rootPath: string;
}
