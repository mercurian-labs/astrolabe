/**
 * PlanTurnRegistry — the structural facts of the planning turns running right
 * now, and nothing else.
 *
 * This exists as its own service so the dependency arrows stay acyclic: the
 * assistant runtime drives turns and depends on {@link PlanningStore}, while
 * the store needs one fact — "is this commit on an active turn's chain?" — to
 * refuse human writes that would race the assistant's next commit into an
 * illegal fork. Both sides read and write this registry; neither depends on
 * the other for it.
 *
 * A turn claims a chain, not a plan: the commit it opened from plus every
 * commit it has landed. Turns whose chains are disjoint — replies on
 * different branches of one plan — run concurrently; a second claim on the
 * same chain refuses. One turn at a time is a per-branch server fact here,
 * not a UI habit.
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
  /** Keeps tool permissions explicit as additional one-shot turn shapes are introduced. */
  readonly flavor: "reply" | "implement";
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
  /**
   * The claim itself: the opening parent plus every commit this turn landed.
   * Membership is the one question the store's human-write guard asks.
   */
  readonly chain: ReadonlySet<CommitId>;
}

/** What a caller opens with; the registry seeds the chain from the parent. */
export type OpenPlanTurn = Omit<ActivePlanTurn, "chain">;

export class PlanTurnRegistry extends Context.Service<
  PlanTurnRegistry,
  {
    /**
     * Claim the turn's chain. Refuses when its opening parent already lies on
     * another active turn's chain — the same-branch case, including two
     * windows racing one send. Turns on disjoint chains coexist.
     */
    readonly open: (turn: OpenPlanTurn) => Effect.Effect<void, PlanTurnActiveError>;
    /** The turn is over — settled, failed, or torn down with its plan. */
    readonly close: (planId: PlanId, turnId: PlanTurnId) => Effect.Effect<void>;
    readonly getTurns: (planId: PlanId) => Effect.Effect<ReadonlyArray<ActivePlanTurn>>;
    /** The MCP door's lookup: which turn a provider session's tool call belongs to. */
    readonly getByThread: (threadId: ThreadId) => Effect.Effect<Option.Option<ActivePlanTurn>>;
    /** An assistant commit landed; the turn's next write parents on it. */
    readonly advanceTip: (
      planId: PlanId,
      turnId: PlanTurnId,
      tipCommitId: CommitId,
    ) => Effect.Effect<void>;
    /**
     * The turn moved to a fresh provider session mid-open (a continuation
     * whose live session turned out dead). The claim itself never lapses.
     */
    readonly reassignThread: (
      planId: PlanId,
      turnId: PlanTurnId,
      threadId: ThreadId,
    ) => Effect.Effect<void>;
    /** The store guard's one question: is this commit claimed by a live turn? */
    readonly activeChainMember: (planId: PlanId, commitId: CommitId) => Effect.Effect<boolean>;
  }
>()("t3/mercurian/planning/PlanTurnRegistry") {}

export const make = Effect.gen(function* () {
  const turns = yield* Ref.make(new Map<PlanId, Map<PlanTurnId, ActivePlanTurn>>());

  const open: PlanTurnRegistry["Service"]["open"] = (turn) =>
    Ref.modify(turns, (current) => {
      const planTurns = current.get(turn.planId);
      if (planTurns !== undefined) {
        for (const existing of planTurns.values()) {
          if (existing.chain.has(turn.parentCommitId)) {
            return [false, current] as const;
          }
        }
      }
      const next = new Map(current);
      const nextPlanTurns = new Map(planTurns ?? []);
      nextPlanTurns.set(turn.turnId, { ...turn, chain: new Set([turn.parentCommitId]) });
      next.set(turn.planId, nextPlanTurns);
      return [true, next] as const;
    }).pipe(
      Effect.flatMap((claimed) =>
        claimed ? Effect.void : new PlanTurnActiveError({ planId: turn.planId }),
      ),
    );

  const close: PlanTurnRegistry["Service"]["close"] = (planId, turnId) =>
    Ref.update(turns, (current) => {
      const planTurns = current.get(planId);
      if (planTurns === undefined || !planTurns.has(turnId)) return current;
      const next = new Map(current);
      const nextPlanTurns = new Map(planTurns);
      nextPlanTurns.delete(turnId);
      if (nextPlanTurns.size === 0) next.delete(planId);
      else next.set(planId, nextPlanTurns);
      return next;
    });

  const getTurns: PlanTurnRegistry["Service"]["getTurns"] = (planId) =>
    Ref.get(turns).pipe(Effect.map((current) => [...(current.get(planId)?.values() ?? [])]));

  const getByThread: PlanTurnRegistry["Service"]["getByThread"] = (threadId) =>
    Ref.get(turns).pipe(
      Effect.map((current) => {
        for (const planTurns of current.values()) {
          for (const turn of planTurns.values()) {
            if (turn.threadId === threadId) return Option.some(turn);
          }
        }
        return Option.none<ActivePlanTurn>();
      }),
    );

  const withTurn = (
    planId: PlanId,
    turnId: PlanTurnId,
    update: (turn: ActivePlanTurn) => ActivePlanTurn,
  ) =>
    Ref.update(turns, (current) => {
      const planTurns = current.get(planId);
      const turn = planTurns?.get(turnId);
      if (planTurns === undefined || turn === undefined) return current;
      const next = new Map(current);
      const nextPlanTurns = new Map(planTurns);
      nextPlanTurns.set(turnId, update(turn));
      next.set(planId, nextPlanTurns);
      return next;
    });

  const advanceTip: PlanTurnRegistry["Service"]["advanceTip"] = (planId, turnId, tipCommitId) =>
    withTurn(planId, turnId, (turn) => ({
      ...turn,
      tipCommitId,
      chain: new Set([...turn.chain, tipCommitId]),
    }));

  const reassignThread: PlanTurnRegistry["Service"]["reassignThread"] = (
    planId,
    turnId,
    threadId,
  ) => withTurn(planId, turnId, (turn) => ({ ...turn, threadId }));

  const activeChainMember: PlanTurnRegistry["Service"]["activeChainMember"] = (planId, commitId) =>
    Ref.get(turns).pipe(
      Effect.map((current) => {
        const planTurns = current.get(planId);
        if (planTurns === undefined) return false;
        for (const turn of planTurns.values()) {
          if (turn.chain.has(commitId)) return true;
        }
        return false;
      }),
    );

  return {
    open,
    close,
    getTurns,
    getByThread,
    advanceTip,
    reassignThread,
    activeChainMember,
  } satisfies PlanTurnRegistry["Service"];
});

export const layer = Layer.effect(PlanTurnRegistry, make);
