import * as Schema from "effect/Schema";

import { MercurianProjectId, MercurianRepositoryId } from "@t3tools/contracts";

export const MemorySource = Schema.Struct({
  projectId: MercurianProjectId,
  repositoryId: MercurianRepositoryId,
  subpath: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type MemorySource = typeof MemorySource.Type;

export interface ResolvedMemorySource extends MemorySource {
  readonly repositoryName: string;
  readonly repositoryPath: string;
  readonly rootPath: string;
}

export type MemoryTreeSource =
  | { readonly kind: "worktree"; readonly rootPath: string }
  | {
      readonly kind: "ref";
      readonly repositoryPath: string;
      readonly ref: string;
      readonly treeOid?: string;
      readonly subpath: string;
    };
