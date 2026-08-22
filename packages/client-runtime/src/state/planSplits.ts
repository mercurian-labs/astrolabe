import type {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanImplementProposal,
  PlanSplitProposal,
} from "@t3tools/contracts";

import type { PlanGraph } from "./planGraph.ts";

export interface ExistingSplit {
  readonly repositoryId: MercurianRepositoryId;
  readonly repositoryName: string;
  readonly commitId: MercurianCommitId;
}

export interface SplitCard extends PlanSplitProposal {
  readonly removed?: boolean;
}

export interface LandedPlan {
  readonly commitId: MercurianCommitId;
  readonly repositoryId: MercurianRepositoryId;
  readonly repositoryName: string;
}

export function existingSplitsAt(
  graph: PlanGraph,
  commitId: MercurianCommitId,
): ReadonlyMap<MercurianRepositoryId, ExistingSplit> {
  const parent = graph.byId.get(commitId);
  if (parent === undefined) return new Map();
  const entries = parent.childrenIds.flatMap((childId) => {
    const item = graph.byId.get(childId)?.item;
    if (item?._tag !== "plan-revision" || item.split === undefined) return [];
    return [
      [
        item.split.repositoryId,
        {
          repositoryId: item.split.repositoryId,
          repositoryName: item.split.repositoryName,
          commitId: item.commitId,
        },
      ] as const,
    ];
  });
  return new Map(entries);
}

export function partitionProposal(
  proposal: PlanImplementProposal,
  existing: ReadonlyMap<MercurianRepositoryId, ExistingSplit>,
): {
  readonly cards: ReadonlyArray<SplitCard>;
  readonly alreadySplit: ReadonlyArray<ExistingSplit>;
} {
  if (proposal.verdict.kind === "atomic") return { cards: [], alreadySplit: [] };
  const cards: Array<SplitCard> = [];
  const alreadySplit: Array<ExistingSplit> = [];
  if (proposal.verdict.kind === "already-covered") {
    for (const repository of proposal.verdict.repositories) {
      const landed = existing.get(repository.repositoryId);
      if (landed !== undefined) alreadySplit.push(landed);
    }
    return { cards, alreadySplit };
  }
  for (const repository of proposal.verdict.splits) {
    const landed = existing.get(repository.repositoryId);
    if (landed !== undefined) alreadySplit.push(landed);
    else cards.push(repository);
  }
  return { cards, alreadySplit };
}

export function confirmPayload(
  cards: ReadonlyArray<SplitCard>,
): ReadonlyArray<PlanSplitProposal> | null {
  const active = cards.filter((card) => card.removed !== true);
  if (active.length === 0) return null;
  const payload = active.map((card) => ({
    repositoryId: card.repositoryId,
    repositoryName: card.repositoryName,
    text: card.text.trim(),
  }));
  return payload.some((split) => split.text.length === 0) ? null : payload;
}

export function implementDisabledReason(input: {
  readonly turnActive: boolean;
  readonly planTextEmpty: boolean;
  readonly isDraft: boolean;
}): string | null {
  if (input.isDraft) return "Save this draft before implementing it.";
  if (input.turnActive) return "Wait for the current plan turn to finish.";
  if (input.planTextEmpty) return "Write a plan before implementing it.";
  return null;
}

export type ImplementFlowEvent =
  | { readonly kind: "invoke"; readonly planMayBeStale: boolean }
  | { readonly kind: "review-plan" }
  | { readonly kind: "continue-anyway" };

export function implementFlowAction(
  event: ImplementFlowEvent,
): "show-warning" | "show-plan" | "evaluate-readiness" {
  if (event.kind === "review-plan") return "show-plan";
  if (event.kind === "continue-anyway") return "evaluate-readiness";
  return event.planMayBeStale ? "show-warning" : "evaluate-readiness";
}
