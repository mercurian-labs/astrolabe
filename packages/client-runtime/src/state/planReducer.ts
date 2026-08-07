import * as Arr from "effect/Array";
import type { PlanDetail, PlanStreamItem } from "@t3tools/contracts";

/**
 * What a subscribed planning space holds: the detail as of the last item
 * folded in, and whether the server has said it is caught up.
 */
export interface PlanSubscriptionState {
  readonly detail: PlanDetail | null;
  readonly synchronized: boolean;
}

export const EMPTY_PLAN_STATE: PlanSubscriptionState = { detail: null, synchronized: false };

/**
 * Fold one plan stream item into the local planning space. Pure, so web and
 * mobile share it and it can be tested without a socket.
 *
 * Commits are guarded by `snapshotSequence`: anything at or below what the
 * state already accounts for is a replay — the echo of an edit this window
 * just made, or an overlap after a resume — and folding it twice would
 * duplicate a row in the history.
 */
export function applyPlanStreamItem(
  state: PlanSubscriptionState,
  item: PlanStreamItem,
): PlanSubscriptionState {
  switch (item.kind) {
    case "snapshot":
      return { detail: item.snapshot, synchronized: state.synchronized };
    case "synchronized":
      return { detail: state.detail, synchronized: true };
    case "commit": {
      const detail = state.detail;
      if (detail === null || item.sequence <= detail.snapshotSequence) return state;
      return {
        detail: {
          ...detail,
          // Text arrives only on commits that changed the artifact; a message
          // leaves the plan exactly as it was.
          planText: item.planText ?? detail.planText,
          timeline: Arr.append(detail.timeline, item.item),
          snapshotSequence: item.sequence,
        },
        synchronized: state.synchronized,
      };
    }
    default:
      return state;
  }
}
