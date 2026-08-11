import type {
  MercurianCommitId,
  MercurianRepositoryId,
  PlanImplementProposal,
  PlanSplitProposal,
} from "@t3tools/contracts";

import type { PlanGraph } from "./PlanGraph.logic";

export interface ExistingSplit {
  readonly repositoryId: MercurianRepositoryId;
  readonly repositoryName: string;
  readonly commitId: MercurianCommitId;
}

export interface SplitCard extends PlanSplitProposal {
  readonly removed?: boolean;
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
  for (const split of proposal.verdict.splits) {
    const landed = existing.get(split.repositoryId);
    if (landed === undefined) cards.push(split);
    else alreadySplit.push(landed);
  }
  return { cards, alreadySplit };
}

export function confirmPayload(
  cards: ReadonlyArray<SplitCard>,
): ReadonlyArray<{ readonly repositoryId: MercurianRepositoryId; readonly text: string }> | null {
  const active = cards.filter((card) => card.removed !== true);
  if (active.length === 0) return null;
  const payload = active.map((card) => ({
    repositoryId: card.repositoryId,
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
