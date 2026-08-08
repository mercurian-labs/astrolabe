/**
 * PlanTurnRegistry — the structural facts of the planning turns running right
 * now, and nothing else.
 *
 * This exists as its own service so the dependency arrows stay acyclic: the
 * assistant runtime drives turns and depends on {@link PlanningStore}, while
 * the store needs one fact — "does this plan have an active turn?" — to refuse
 * human writes that would race the assistant's next commit into an illegal
 * fork. Both sides read and write this registry; neither depends on the other
 * for it.
 *
 * Everything here is runtime state (ADR 002 §3): nothing is persisted, and a
 * server restart rightly starts with no turns.
 *
 * @module PlanTurnRegistry
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { PlanId, PlanTurnActiveError, PlanTurnId, type ThreadId } from "@t3tools/contracts";

import type { CommitId } from "../commitTree/schema.ts";

/**
 * One running turn's structural identity: which plan, which provider thread
 * carries it, and where its commits stand. The conversational state — partial
 * text, grounding, questions — is the assistant runtime's own; this is only
 * what other services need to compose with the turn safely.
 */
export interface ActivePlanTurn {
  readonly planId: PlanId;
  readonly turnId: PlanTurnId;
  /** The provider session thread this turn is running on. */
  readonly threadId: ThreadId;
  /** The commit the turn opened from. */
  readonly parentCommitId: CommitId;
  /**
   * The commit the turn's next write parents on: the opening parent at first,
   * then each assistant commit — revision or settle — as it lands. Advancing
   * this is what keeps a turn's chain linear by construction.
   */
  readonly tipCommitId: CommitId;
}

export class PlanTurnRegistry extends Context.Service<
  PlanTurnRegistry,
  {
    /**
     * Claim the plan for one turn. Refuses when a turn is already running —
     * one turn at a time is a server fact here, not a UI habit.
     */
    readonly open: (turn: ActivePlanTurn) => Effect.Effect<void, PlanTurnActiveError>;
    /** The turn is over — settled, failed, or torn down with its plan. */
    readonly close: (planId: PlanId) => Effect.Effect<void>;
    readonly get: (planId: PlanId) => Effect.Effect<Option.Option<ActivePlanTurn>>;
    /** The MCP door's lookup: which turn a provider session's tool call belongs to. */
    readonly getByThread: (threadId: ThreadId) => Effect.Effect<Option.Option<ActivePlanTurn>>;
    /** An assistant commit landed; the turn's next write parents on it. */
    readonly advanceTip: (planId: PlanId, tipCommitId: CommitId) => Effect.Effect<void>;
    /**
     * The turn moved to a fresh provider session mid-open (a continuation
     * whose live session turned out dead). The claim itself never lapses.
     */
    readonly reassignThread: (planId: PlanId, threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/mercurian/planning/PlanTurnRegistry") {}

export const make = Effect.gen(function* () {
  const turns = yield* Ref.make(new Map<PlanId, ActivePlanTurn>());

  const open: PlanTurnRegistry["Service"]["open"] = (turn) =>
    Ref.modify(turns, (current) => {
      if (current.has(turn.planId)) {
        return [false, current] as const;
      }
      const next = new Map(current);
      next.set(turn.planId, turn);
      return [true, next] as const;
    }).pipe(
      Effect.flatMap((claimed) =>
        claimed ? Effect.void : new PlanTurnActiveError({ planId: turn.planId }),
      ),
    );

  const close: PlanTurnRegistry["Service"]["close"] = (planId) =>
    Ref.update(turns, (current) => {
      if (!current.has(planId)) return current;
      const next = new Map(current);
      next.delete(planId);
      return next;
    });

  const get: PlanTurnRegistry["Service"]["get"] = (planId) =>
    Ref.get(turns).pipe(Effect.map((current) => Option.fromNullishOr(current.get(planId))));

  const getByThread: PlanTurnRegistry["Service"]["getByThread"] = (threadId) =>
    Ref.get(turns).pipe(
      Effect.map((current) => {
        for (const turn of current.values()) {
          if (turn.threadId === threadId) return Option.some(turn);
        }
        return Option.none<ActivePlanTurn>();
      }),
    );

  const advanceTip: PlanTurnRegistry["Service"]["advanceTip"] = (planId, tipCommitId) =>
    Ref.update(turns, (current) => {
      const turn = current.get(planId);
      if (turn === undefined) return current;
      const next = new Map(current);
      next.set(planId, { ...turn, tipCommitId });
      return next;
    });

  const reassignThread: PlanTurnRegistry["Service"]["reassignThread"] = (planId, threadId) =>
    Ref.update(turns, (current) => {
      const turn = current.get(planId);
      if (turn === undefined) return current;
      const next = new Map(current);
      next.set(planId, { ...turn, threadId });
      return next;
    });

  return {
    open,
    close,
    get,
    getByThread,
    advanceTip,
    reassignThread,
  } satisfies PlanTurnRegistry["Service"];
});

export const layer = Layer.effect(PlanTurnRegistry, make);
