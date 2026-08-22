import type { PlanGraph } from "@t3tools/client-runtime/state/plan-graph";
import {
  confirmPayload,
  existingSplitsAt,
  partitionProposal,
  type LandedPlan,
  type SplitCard,
} from "@t3tools/client-runtime/state/plan-splits";
import type {
  MercurianCommitId,
  PlanImplementProposal,
  PlanSplitProposal,
} from "@t3tools/contracts";

export const PLAN_IMPLEMENT_COPY = {
  title: "Implement this plan",
  pendingDescription: "Review where the plan belongs. Nothing is added until you confirm.",
  landedDescription: "Choose a repository plan to go to it.",
  ready: "This plan is ready to implement.",
  multiRepository:
    "This plan covers work in more than one repository. A coding session works in one repository at a time.",
  existing: "This repository already has its own plan",
  addEach: "Add a plan for each repository",
  start: "Start a coding session",
  go: "Go to plan",
  cancel: "Cancel",
  done: "Done",
} as const;

export function derivePlanImplementSheetState(input: {
  readonly proposal: PlanImplementProposal;
  readonly graph: PlanGraph;
  readonly cards?: ReadonlyArray<SplitCard>;
}) {
  const partitioned = partitionProposal(
    input.proposal,
    existingSplitsAt(input.graph, input.proposal.parentCommitId),
  );
  const cards = input.cards ?? partitioned.cards;
  return {
    kind: input.proposal.verdict.kind,
    cards,
    alreadySplit: partitioned.alreadySplit,
    payload: confirmPayload(cards),
  } as const;
}

export function landedPlansFromConfirmation(
  commitIds: ReadonlyArray<MercurianCommitId>,
  plans: ReadonlyArray<PlanSplitProposal>,
): ReadonlyArray<LandedPlan> {
  return commitIds.flatMap((commitId, index) => {
    const plan = plans[index];
    return plan === undefined
      ? []
      : [{ commitId, repositoryId: plan.repositoryId, repositoryName: plan.repositoryName }];
  });
}

export function sessionDraftParams(planId: string, parentCommitId: MercurianCommitId) {
  return {
    planId,
    parentCommitId: String(parentCommitId),
  } as const;
}
