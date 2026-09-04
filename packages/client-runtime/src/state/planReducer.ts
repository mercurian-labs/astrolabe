import * as Arr from "effect/Array";
import type {
  MercurianCommitId,
  PlanDetail,
  PlanGroundingItem,
  PlanInFlightTurn,
  PlanCodingSessionRecord,
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
  readonly codingSessions: ReadonlyMap<MercurianCommitId, PlanCodingSessionRecord>;
  readonly synchronized: boolean;
  /**
   * The last `turn-refused` reason, cleared the moment a turn starts or a
   * fresh snapshot arrives. The composer's gate makes these rare; this is
   * the honest backstop for the window that raced a settings change.
   */
  readonly turnRefusal: PlanTurnRefusalReason | null;
  readonly memoryAmendmentFailure: Extract<
    PlanStreamItem,
    { readonly kind: "memory-amendment-failed" }
  > | null;
}

export const EMPTY_PLAN_STATE: PlanSubscriptionState = {
  detail: null,
  codingSessions: new Map(),
  synchronized: false,
  turnRefusal: null,
  memoryAmendmentFailure: null,
};

const sameGroundingItem = (left: PlanGroundingItem, right: PlanGroundingItem): boolean =>
  left.kind === right.kind && left.label === right.label && left.detail === right.detail;

function withInFlightTurns(
  state: PlanSubscriptionState,
  inFlightTurns: ReadonlyArray<PlanInFlightTurn>,
): PlanSubscriptionState {
  if (state.detail === null) return state;
  return { ...state, detail: { ...state.detail, inFlightTurns } };
}

/** Address one streaming turn among the branch's peers; unknown ids fold away. */
function updateInFlightTurn(
  state: PlanSubscriptionState,
  turnId: PlanInFlightTurn["turnId"],
  update: (turn: PlanInFlightTurn) => PlanInFlightTurn | undefined,
): PlanSubscriptionState {
  const turns = state.detail?.inFlightTurns;
  const current = turns?.find((turn) => turn.turnId === turnId);
  if (turns === undefined || current === undefined) return state;
  const updated = update(current);
  return withInFlightTurns(
    state,
    updated === undefined
      ? turns.filter((turn) => turn.turnId !== turnId)
      : turns.map((turn) => (turn.turnId === turnId ? updated : turn)),
  );
}

/**
 * Which streaming turn a settled assistant reply belongs to: the one whose
 * opening parent the reply descends from along first parents. Mid-turn
 * revisions land as commits between the two, so the walk crosses them; it
 * stops at the first human message — another branch's history is never
 * consulted — and is bounded against malformed data.
 */
function turnSettledByCommit(
  detail: PlanDetail,
  parents: ReadonlyArray<MercurianCommitId>,
): PlanInFlightTurn | undefined {
  if (detail.inFlightTurns.length === 0) return undefined;
  const byId = new Map(detail.timeline.map((entry) => [entry.commitId, entry] as const));
  let cursor = parents[0];
  for (let step = 0; step < 100 && cursor !== undefined; step += 1) {
    const match = detail.inFlightTurns.find((turn) => turn.parentCommitId === cursor);
    if (match !== undefined) return match;
    const entry = byId.get(cursor);
    if (entry === undefined || entry._tag === "message") return undefined;
    cursor = entry.parents[0];
  }
  return undefined;
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
 * `detail.inFlightTurns`, keyed by their turn. They carry no sequence; each delta carries
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
        codingSessions: new Map(
          item.snapshot.codingSessions.map((session) => [session.commitId, session]),
        ),
        synchronized: state.synchronized,
        turnRefusal: null,
        memoryAmendmentFailure: null,
      };
    case "synchronized":
      return { ...state, synchronized: true };
    case "coding-sessions": {
      const codingSessions = new Map(item.sessions.map((session) => [session.commitId, session]));
      return {
        ...state,
        codingSessions,
        ...(state.detail === null
          ? {}
          : { detail: { ...state.detail, codingSessions: item.sessions } }),
      };
    }
    case "commit": {
      const detail = state.detail;
      if (detail === null || item.sequence <= detail.snapshotSequence) return state;
      // The settled assistant reply arriving as a commit is the record
      // replacing the stream: whichever of it and `turn-settled` lands
      // first closes that branch's in-flight turn — and only that one; a
      // reply settling on one branch says nothing about another still
      // streaming. Mid-turn plan revisions are assistant commits too and
      // close nothing.
      const settled =
        item.item._tag === "message" && item.item.authorKind === "assistant"
          ? turnSettledByCommit(detail, item.item.parents)
          : undefined;
      const inFlightTurns =
        settled === undefined
          ? detail.inFlightTurns
          : detail.inFlightTurns.filter((turn) => turn.turnId !== settled.turnId);
      return {
        ...state,
        detail: {
          ...detail,
          inFlightTurns,
          // Text arrives only on commits that changed the artifact; a message
          // leaves the plan exactly as it was.
          planText: item.planText ?? detail.planText,
          spec: item.spec ?? detail.spec,
          timeline: Arr.append(detail.timeline, item.item),
          snapshotSequence: item.sequence,
        },
      };
    }
    case "turn-started": {
      const existing = state.detail?.inFlightTurns ?? [];
      return {
        ...withInFlightTurns(state, [
          ...existing.filter((turn) => turn.turnId !== item.turnId),
          {
            turnId: item.turnId,
            parentCommitId: item.parentCommitId,
            text: "",
            grounding: [],
            ...(item.groundingScope === undefined ? {} : { groundingScope: item.groundingScope }),
          },
        ]),
        turnRefusal: null,
        memoryAmendmentFailure: null,
      };
    }
    case "turn-delta":
      return updateInFlightTurn(state, item.turnId, (turn) =>
        // A delta wholly below the text this window already holds is a replay
        // across the snapshot join.
        item.offset !== undefined && item.offset < turn.text.length
          ? turn
          : { ...turn, text: turn.text + item.textDelta },
      );
    case "turn-grounding": {
      const turn = state.detail?.inFlightTurns.find(
        (candidate) => candidate.turnId === item.turnId,
      );
      if (turn !== undefined) {
        return updateInFlightTurn(state, item.turnId, (current) =>
          current.grounding.some((existing) => sameGroundingItem(existing, item.item))
            ? current
            : { ...current, grounding: Arr.append(current.grounding, item.item) },
        );
      }
      return state;
    }
    case "turn-question":
      return updateInFlightTurn(state, item.turnId, (turn) => ({
        ...turn,
        questions: item.questions,
      }));
    case "turn-question-answered":
      return updateInFlightTurn(state, item.turnId, (turn) => {
        const { questions: _answered, ...rest } = turn;
        return rest;
      });
    case "turn-settled":
      return updateInFlightTurn(state, item.turnId, () => undefined);
    case "turn-refused":
      return { ...state, turnRefusal: item.reason };
    case "memory-amendment-failed": {
      const relevant = state.detail?.inFlightTurns.some((turn) => turn.turnId === item.turnId);
      if (relevant !== true) return state;
      return {
        ...state,
        memoryAmendmentFailure: item,
      };
    }
    default:
      return state;
  }
}
