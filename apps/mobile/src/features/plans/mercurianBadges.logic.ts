import type { MercurianCommitId, PlanImplementReady } from "@t3tools/contracts";

export const READY_TO_IMPLEMENT_LABEL = "Ready to implement";

export function badgeStateAt(input: {
  readonly commitId: MercurianCommitId;
  readonly readyCommits: ReadonlyMap<MercurianCommitId, PlanImplementReady>;
  readonly stalePlanIds: ReadonlySet<string>;
  readonly staleSpecIds: ReadonlySet<string>;
}) {
  return {
    ready: input.readyCommits.has(input.commitId),
    stalePlan: input.stalePlanIds.has(input.commitId),
    staleSpec: input.staleSpecIds.has(input.commitId),
  } as const;
}
