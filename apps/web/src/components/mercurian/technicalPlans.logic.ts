import type {
  MercurianRepository,
  MercurianRepositoryId,
  PlanTechnicalPlan,
  PlanTimelineItem,
} from "@t3tools/contracts";

export type TechnicalPlanState = "never-derived" | "up-to-date" | "stale";
export type DeriveDisabledReason = "plan-empty" | "turn-active" | "up-to-date";

export interface DeriveMenuItem {
  readonly repository: MercurianRepository;
  readonly state: TechnicalPlanState;
  readonly disabled: boolean;
  readonly disabledReason?: DeriveDisabledReason;
}

/** The newest technical plan for each repository on this rendered path. */
export function latestTechnicalPlansOnPath(
  path: ReadonlyArray<PlanTimelineItem>,
): ReadonlyMap<MercurianRepositoryId, PlanTechnicalPlan> {
  const latest = new Map<MercurianRepositoryId, PlanTechnicalPlan>();
  for (const item of path) {
    if (item._tag === "technical-plan") latest.set(item.repositoryId, item);
  }
  return latest;
}

/** The source revision a derivation at the end of this path would carry. */
export function sourceRevisionOnPath(
  path: ReadonlyArray<PlanTimelineItem>,
): PlanTimelineItem["commitId"] | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const item = path[index];
    if (item?._tag === "plan-revision") return item.commitId;
  }
  return undefined;
}

/** Staleness is only this comparison; no server-side state participates. */
export function isStale(item: PlanTechnicalPlan, path: ReadonlyArray<PlanTimelineItem>): boolean {
  return item.sourceRevisionCommitId !== sourceRevisionOnPath(path);
}

/**
 * The Derive menu's complete state at the position being rendered. Passing a
 * truncated path is what makes looking back judge that point's truth.
 */
export function deriveMenuItems(
  projectRepositories: ReadonlyArray<MercurianRepository>,
  path: ReadonlyArray<PlanTimelineItem>,
  planText: string,
  turnActive = false,
): ReadonlyArray<DeriveMenuItem> {
  const latest = latestTechnicalPlansOnPath(path);
  const sourceRevisionCommitId = sourceRevisionOnPath(path);
  return projectRepositories.map((repository) => {
    const technicalPlan = latest.get(repository.repositoryId);
    const state: TechnicalPlanState =
      technicalPlan === undefined
        ? "never-derived"
        : technicalPlan.sourceRevisionCommitId === sourceRevisionCommitId
          ? "up-to-date"
          : "stale";
    const disabledReason: DeriveDisabledReason | undefined = turnActive
      ? "turn-active"
      : planText.length === 0 || sourceRevisionCommitId === undefined
        ? "plan-empty"
        : state === "up-to-date"
          ? "up-to-date"
          : undefined;
    return {
      repository,
      state,
      disabled: disabledReason !== undefined,
      ...(disabledReason === undefined ? {} : { disabledReason }),
    };
  });
}
