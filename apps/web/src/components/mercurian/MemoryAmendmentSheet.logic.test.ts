import {
  MercurianCommitId,
  PlanId,
  PlanTurnId,
  type MemoryAmendmentProposal,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  confirmMemoryAmendmentBlockedReason,
  memoryAmendmentBlockedNotice,
  memoryAmendmentCancelPayload,
  memoryAmendmentConfirmPayload,
  memoryAmendmentSheetState,
} from "./MemoryAmendmentSheet.logic";

const proposal: MemoryAmendmentProposal = {
  turnId: PlanTurnId.make("turn-1"),
  title: "Record the composer boundary",
  changes: [{ path: "Composer.md", before: "old", after: "new" }],
  patch: "raw patch",
  placements: [{ map: "product", parent: "Planning", note: "Composer" }],
};

describe("memoryAmendmentSheetState", () => {
  it("derives the proposal review state and placement copy", () => {
    expect(
      memoryAmendmentSheetState({
        proposal,
        turnActive: false,
        parentCommitId: MercurianCommitId.make("head"),
        blockedReason: null,
      }),
    ).toMatchObject({
      title: "Record the composer boundary",
      patch: "raw patch",
      placements: ["Placed under Planning in the product map"],
      confirmDisabled: false,
      blockedNotice: null,
    });
    expect(
      memoryAmendmentSheetState({
        proposal: undefined,
        turnActive: false,
        parentCommitId: null,
        blockedReason: null,
      }),
    ).toBeNull();
  });

  it("disables confirmation while a turn is active or no acting head exists", () => {
    expect(
      memoryAmendmentSheetState({
        proposal,
        turnActive: true,
        parentCommitId: MercurianCommitId.make("head"),
        blockedReason: null,
      })?.confirmDisabled,
    ).toBe(true);
    expect(
      memoryAmendmentSheetState({
        proposal,
        turnActive: false,
        parentCommitId: null,
        blockedReason: null,
      })?.confirmDisabled,
    ).toBe(true);
  });

  it("builds the exact confirm and decline payloads", () => {
    const planId = PlanId.make("plan-1");
    const parentCommitId = MercurianCommitId.make("head");
    expect(memoryAmendmentConfirmPayload(planId, parentCommitId)).toEqual({
      planId,
      parentCommitId,
    });
    expect(memoryAmendmentCancelPayload(planId)).toEqual({ planId });
  });

  it("maps tagged blocked reasons to inline notices", () => {
    expect(
      confirmMemoryAmendmentBlockedReason({
        _tag: "ConfirmMemoryAmendmentBlockedError",
        reason: "memory-changed",
      }),
    ).toBe("memory-changed");
    expect(memoryAmendmentBlockedNotice("memory-changed")).toBe(
      "The project memory changed after this amendment was proposed.",
    );
    expect(confirmMemoryAmendmentBlockedReason(new Error("no"))).toBeNull();
  });
});
