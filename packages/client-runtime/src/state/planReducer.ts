import * as Arr from "effect/Array";
import type {
  PlanDetail,
  PlanGroundingItem,
  PlanInFlightImplement,
  PlanInFlightTurn,
  PlanImplementProposal,
  PlanStreamItem,
  PlanTurnRefusalReason,
} from "@t3tools/contracts";

/**
 * What a subscribed planning space holds: the detail as of the last item
 * folded in, whether the server has said it is caught up, and — transient,
 * never part of the record — why the last message got no reply.
 */
export interface PlanSubscriptionState {
  readonly detail: PlanDetail | null;
  readonly synchronized: boolean;
  /**
   * The last `turn-refused` reason, cleared the moment a turn starts or a
   * fresh snapshot arrives. The composer's gate makes these rare; this is
   * the honest backstop for the window that raced a settings change.
   */
  readonly turnRefusal: PlanTurnRefusalReason | null;
  readonly implementFailure:
    | Extract<PlanStreamItem, { readonly kind: "implement-failed" }>["reason"]
    | null;
}

export const EMPTY_PLAN_STATE: PlanSubscriptionState = {
  detail: null,
  synchronized: false,
  turnRefusal: null,
  implementFailure: null,
};

const sameGroundingItem = (left: PlanGroundingItem, right: PlanGroundingItem): boolean =>
  left.kind === right.kind && left.label === right.label && left.detail === right.detail;

function withInFlightTurn(
  state: PlanSubscriptionState,
  inFlightTurn: PlanInFlightTurn | undefined,
): PlanSubscriptionState {
  if (state.detail === null) return state;
  const { inFlightTurn: _previous, ...rest } = state.detail;
  return {
    ...state,
    detail: { ...rest, ...(inFlightTurn === undefined ? {} : { inFlightTurn }) },
  };
}

function withInFlightImplement(
  state: PlanSubscriptionState,
  inFlightImplement: PlanInFlightImplement | undefined,
): PlanSubscriptionState {
  if (state.detail === null) return state;
  const { inFlightImplement: _previous, ...rest } = state.detail;
  return {
    ...state,
    detail: { ...rest, ...(inFlightImplement === undefined ? {} : { inFlightImplement }) },
  };
}

function withImplementProposal(
  state: PlanSubscriptionState,
  implementProposal: PlanImplementProposal | undefined,
): PlanSubscriptionState {
  if (state.detail === null) return state;
  const { implementProposal: _previous, ...rest } = state.detail;
  return {
    ...state,
    detail: { ...rest, ...(implementProposal === undefined ? {} : { implementProposal }) },
  };
}

/**
 * Fold one plan stream item into the local planning space. Pure, so web and
 * mobile share it and it can be tested without a socket.
 *
 * Commits are guarded by `snapshotSequence`: anything at or below what the
 * state already accounts for is a replay — the echo of an edit this window
 * just made, or an overlap after a resume — and folding it twice would
 * duplicate a row in the history.
 *
 * Turn frames are transient transport (ADR 002 §3) and fold into
 * `detail.inFlightTurn`. They carry no sequence; instead each delta carries
 * the offset of the text before it, so a frame replayed across the join —
 * the server attaches its frame feed before it reads the snapshot — folds
 * away instead of duplicating characters.
 */
export function applyPlanStreamItem(
  state: PlanSubscriptionState,
  item: PlanStreamItem,
): PlanSubscriptionState {
  switch (item.kind) {
    case "snapshot":
      return {
        detail: item.snapshot,
        synchronized: state.synchronized,
        turnRefusal: null,
        implementFailure: null,
      };
    case "synchronized":
      return { ...state, synchronized: true };
    case "commit": {
      const detail = state.detail;
      if (detail === null || item.sequence <= detail.snapshotSequence) return state;
      // The settled assistant reply arriving as a commit is the record
      // replacing the stream: whichever of it and `turn-settled` lands
      // first closes the in-flight turn. Mid-turn plan revisions are
      // assistant commits too and close nothing.
      const closesTurn =
        detail.inFlightTurn !== undefined &&
        item.item._tag === "message" &&
        item.item.authorKind === "assistant";
      const closesImplementProposal =
        item.item._tag === "plan-revision" && item.item.split !== undefined;
      const { inFlightTurn, implementProposal, ...rest } = detail;
      return {
        ...state,
        detail: {
          ...rest,
          ...(closesTurn || inFlightTurn === undefined ? {} : { inFlightTurn }),
          ...(closesImplementProposal || implementProposal === undefined
            ? {}
            : { implementProposal }),
          // Text arrives only on commits that changed the artifact; a message
          // leaves the plan exactly as it was.
          planText: item.planText ?? detail.planText,
          timeline: Arr.append(detail.timeline, item.item),
          snapshotSequence: item.sequence,
        },
      };
    }
    case "turn-started":
      return {
        ...withInFlightTurn(withImplementProposal(state, undefined), {
          turnId: item.turnId,
          parentCommitId: item.parentCommitId,
          text: "",
          grounding: [],
          ...(item.groundingScope === undefined ? {} : { groundingScope: item.groundingScope }),
        }),
        turnRefusal: null,
      };
    case "implement-started":
      return {
        ...withInFlightImplement(withImplementProposal(state, undefined), item.implement),
        implementFailure: null,
      };
    case "turn-delta": {
      const turn = state.detail?.inFlightTurn;
      if (turn === undefined || turn.turnId !== item.turnId) return state;
      // A delta wholly below the text this window already holds is a replay
      // across the snapshot join.
      if (item.offset !== undefined && item.offset < turn.text.length) return state;
      return withInFlightTurn(state, { ...turn, text: turn.text + item.textDelta });
    }
    case "turn-grounding": {
      const turn = state.detail?.inFlightTurn;
      if (turn !== undefined && turn.turnId === item.turnId) {
        if (turn.grounding.some((existing) => sameGroundingItem(existing, item.item))) return state;
        return withInFlightTurn(state, {
          ...turn,
          grounding: Arr.append(turn.grounding, item.item),
        });
      }
      const implement = state.detail?.inFlightImplement;
      if (implement === undefined || implement.turnId !== item.turnId) return state;
      if (implement.grounding.some((existing) => sameGroundingItem(existing, item.item))) {
        return state;
      }
      return withInFlightImplement(state, {
        ...implement,
        grounding: Arr.append(implement.grounding, item.item),
      });
    }
    case "turn-question": {
      const turn = state.detail?.inFlightTurn;
      if (turn === undefined || turn.turnId !== item.turnId) return state;
      return withInFlightTurn(state, { ...turn, questions: item.questions });
    }
    case "turn-question-answered": {
      const turn = state.detail?.inFlightTurn;
      if (turn === undefined || turn.turnId !== item.turnId) return state;
      const { questions: _answered, ...rest } = turn;
      return withInFlightTurn(state, rest);
    }
    case "turn-settled": {
      const turn = state.detail?.inFlightTurn;
      if (turn === undefined || turn.turnId !== item.turnId) return state;
      return withInFlightTurn(state, undefined);
    }
    case "turn-refused":
      return { ...state, turnRefusal: item.reason };
    case "implement-analyzed": {
      const implement = state.detail?.inFlightImplement;
      if (implement === undefined || implement.turnId !== item.proposal.turnId) return state;
      return withImplementProposal(withInFlightImplement(state, undefined), item.proposal);
    }
    case "implement-cancelled": {
      const proposal = state.detail?.implementProposal;
      if (proposal === undefined || proposal.turnId !== item.turnId) return state;
      return withImplementProposal(state, undefined);
    }
    case "implement-failed": {
      const implement = state.detail?.inFlightImplement;
      if (implement === undefined || implement.turnId !== item.turnId) return state;
      return {
        ...withInFlightImplement(state, undefined),
        implementFailure: item.reason,
      };
    }
    default:
      return state;
  }
}
