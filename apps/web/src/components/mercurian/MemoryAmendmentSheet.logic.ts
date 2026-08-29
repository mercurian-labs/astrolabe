import type { MercurianCommitId, MemoryAmendmentProposal, PlanId } from "@t3tools/contracts";

export type MemoryAmendmentBlockedReason = "no-proposal" | "memory-changed" | "not-designated";

export function memoryAmendmentBlockedNotice(
  reason: MemoryAmendmentBlockedReason | null,
): string | null {
  switch (reason) {
    case "memory-changed":
      return "The project memory changed after this amendment was proposed.";
    case "no-proposal":
      return "There is no memory amendment to confirm.";
    case "not-designated":
      return "This project has no designated memory.";
    case null:
      return null;
  }
}

export function confirmMemoryAmendmentBlockedReason(
  error: unknown,
): MemoryAmendmentBlockedReason | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { readonly _tag?: unknown; readonly reason?: unknown };
  if (candidate._tag !== "ConfirmMemoryAmendmentBlockedError") return null;
  return candidate.reason === "no-proposal" ||
    candidate.reason === "memory-changed" ||
    candidate.reason === "not-designated"
    ? candidate.reason
    : null;
}

export function memoryAmendmentConfirmPayload(planId: PlanId, parentCommitId: MercurianCommitId) {
  return { planId, parentCommitId } as const;
}

export function memoryAmendmentCancelPayload(planId: PlanId) {
  return { planId } as const;
}

export function memoryAmendmentPlacementLabel(
  placement: MemoryAmendmentProposal["placements"][number],
): string {
  return `Placed under ${placement.parent} in the ${placement.map} map`;
}

export function memoryAmendmentSheetState(input: {
  readonly proposal: MemoryAmendmentProposal | undefined;
  readonly turnActive: boolean;
  readonly parentCommitId: MercurianCommitId | null;
  readonly blockedReason: MemoryAmendmentBlockedReason | null;
}) {
  if (input.proposal === undefined) return null;
  return {
    title: input.proposal.title,
    patch: input.proposal.patch,
    placements: input.proposal.placements.map(memoryAmendmentPlacementLabel),
    confirmDisabled: input.turnActive || input.parentCommitId === null,
    blockedNotice: memoryAmendmentBlockedNotice(input.blockedReason),
  } as const;
}
