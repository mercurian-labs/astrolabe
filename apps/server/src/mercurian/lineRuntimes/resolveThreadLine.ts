import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { MercurianCommitId, MercurianRepositoryId, ThreadId } from "@t3tools/contracts";

import type { LegacySessionStore } from "./LegacySessionStore.ts";
import type { LineRuntimeStore } from "./LineRuntimeStore.ts";

export interface ResolvedThreadLine {
  readonly planId: import("@t3tools/contracts").PlanId;
  readonly lineRootCommitId: MercurianCommitId;
  readonly homeRepositoryId: MercurianRepositoryId;
  readonly repositories: ReadonlyArray<
    import("./LegacySessionSchema.ts").CodingSessionRepositoryRecord
  >;
  readonly branch: string;
  readonly worktreePath: string;
  readonly runtime: import("./schema.ts").LineRuntimeRecord | null;
  readonly legacySession: import("./LegacySessionSchema.ts").CodingSessionRecord | null;
}

/** Resolve either generation of Mercurian thread ownership through one read seam. */
export const resolveThreadLine = Effect.fn("LineRuntimes.resolveThreadLine")(function* (
  lineRuntimes: LineRuntimeStore["Service"],
  legacySessions: LegacySessionStore["Service"],
  threadId: ThreadId,
) {
  const runtime = yield* lineRuntimes.getByThreadId(threadId);
  if (Option.isSome(runtime)) {
    const value = runtime.value;
    return Option.some<ResolvedThreadLine>({
      planId: value.planId,
      lineRootCommitId: value.lineRootCommitId,
      homeRepositoryId: value.homeRepositoryId,
      repositories: value.repositories ?? [],
      branch: value.branch,
      worktreePath: value.worktreePath,
      runtime: value,
      legacySession: null,
    });
  }
  const legacy = yield* legacySessions.getByThreadId(threadId);
  if (Option.isNone(legacy) || legacy.value.repositoryId == null) {
    return Option.none<ResolvedThreadLine>();
  }
  const value = legacy.value;
  const homeRepositoryId = value.repositoryId;
  if (homeRepositoryId == null) return Option.none<ResolvedThreadLine>();
  return Option.some<ResolvedThreadLine>({
    planId: value.planId,
    // Legacy rows predate line runtimes; their leaf id remains the stable line key
    // used by the compatibility path while slot selection continues by branch.
    lineRootCommitId: value.commitId,
    homeRepositoryId,
    repositories: value.repositories ?? [],
    branch: value.branch,
    worktreePath: value.worktreePath,
    runtime: null,
    legacySession: value,
  });
});
