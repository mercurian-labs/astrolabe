import type { WorktreeSlotSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { WorktreeSlot } from "./schema.ts";

export const toWireSlotSnapshot = (
  slots: ReadonlyArray<WorktreeSlot>,
  leasedSlotIds: ReadonlySet<string>,
): WorktreeSlotSnapshot => ({
  slots: slots.map((slot) => ({
    slotId: slot.slotId,
    projectId: slot.projectId,
    path: slot.path,
    currentLineRootCommitId: slot.currentLineRootCommitId,
    members: slot.members.map((member) => ({ ...member })),
    leased: leasedSlotIds.has(slot.slotId),
    createdAt: DateTime.formatIso(slot.createdAt),
    lastUsedAt: DateTime.formatIso(slot.lastUsedAt),
  })),
});
