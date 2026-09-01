import * as Schema from "effect/Schema";

import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";

export const WorktreeSlotId = TrimmedNonEmptyString.pipe(Schema.brand("WorktreeSlotId"));
export type WorktreeSlotId = typeof WorktreeSlotId.Type;

export const WorktreeSlotMember = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  relativePath: TrimmedNonEmptyString,
  currentBranch: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorktreeSlotMember = typeof WorktreeSlotMember.Type;

export const WorktreeSlot = Schema.Struct({
  slotId: WorktreeSlotId,
  projectId: MercurianProjectId,
  path: TrimmedNonEmptyString,
  currentLineRootCommitId: Schema.NullOr(MercurianCommitId),
  members: Schema.Array(WorktreeSlotMember),
  createdAt: Schema.DateTimeUtcFromString,
  lastUsedAt: Schema.DateTimeUtcFromString,
});
export type WorktreeSlot = typeof WorktreeSlot.Type;

export const SlotLeaseHolder = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("turn"), threadId: TrimmedNonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("terminal"),
    threadId: TrimmedNonEmptyString,
    terminalId: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("preview"),
    threadId: TrimmedNonEmptyString,
    previewId: TrimmedNonEmptyString,
  }),
]);
export type SlotLeaseHolder = typeof SlotLeaseHolder.Type;

export interface SlotLease {
  readonly holders: ReadonlyArray<SlotLeaseHolder>;
  readonly acquiredAt: string;
}
