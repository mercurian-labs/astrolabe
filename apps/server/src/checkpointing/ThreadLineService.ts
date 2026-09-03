import type {
  BranchMovement,
  MercurianCommitId,
  MercurianRepositoryId,
  SnapshotKind,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export interface ThreadLineRepository {
  readonly repositoryId: MercurianRepositoryId;
  readonly repositoryName: string;
}

export interface ThreadLineRecord {
  readonly lineRootCommitId: MercurianCommitId;
  readonly homeRepositoryId: MercurianRepositoryId;
  readonly repositories: ReadonlyArray<ThreadLineRepository>;
  readonly branch: string;
}

export interface ThreadLineSnapshot {
  readonly snapshotOid: string;
  readonly kind: SnapshotKind;
  readonly branchTipOid: string;
  readonly departedRef: string | null;
  readonly branchMovement: BranchMovement;
}

export class ThreadLineService extends Context.Service<
  ThreadLineService,
  {
    readonly resolve: (threadId: ThreadId) => Effect.Effect<Option.Option<ThreadLineRecord>, Error>;
    readonly updateBranch: (threadId: ThreadId, branch: string) => Effect.Effect<void, Error>;
    readonly recordSnapshot: (
      threadId: ThreadId,
      snapshot: ThreadLineSnapshot,
    ) => Effect.Effect<void, Error>;
    readonly recordRepositorySnapshot: (
      threadId: ThreadId,
      repositoryId: MercurianRepositoryId,
      snapshot: ThreadLineSnapshot,
    ) => Effect.Effect<void, Error>;
  }
>()("t3/checkpointing/ThreadLineService") {}
