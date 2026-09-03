import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { PlanId, PlanTurnId, ThreadId } from "@t3tools/contracts";

import { CommitId } from "../commitTree/schema.ts";
import * as PlanTurnRegistry from "./PlanTurnRegistry.ts";

const plan = PlanId.make("plan-1");
const openInput = (turn: string, parent: string) => ({
  planId: plan,
  turnId: PlanTurnId.make(turn),
  threadId: ThreadId.make(`thread-${turn}`),
  parentCommitId: CommitId.make(parent),
  tipCommitId: CommitId.make(parent),
});

describe("PlanTurnRegistry", () => {
  it.effect("turns on disjoint chains coexist; a claimed parent refuses", () =>
    Effect.gen(function* () {
      const registry = yield* PlanTurnRegistry.make;
      yield* registry.open(openInput("turn-a", "commit-a"));
      yield* registry.open(openInput("turn-b", "commit-b"));
      assert.strictEqual((yield* registry.getTurns(plan)).length, 2);

      // Two windows racing one send: the second claim on the same parent loses.
      const refused = yield* Effect.flip(registry.open(openInput("turn-c", "commit-a")));
      assert.strictEqual(refused._tag, "PlanTurnActiveError");
    }),
  );

  it.effect("advanceTip grows the chain the claim covers", () =>
    Effect.gen(function* () {
      const registry = yield* PlanTurnRegistry.make;
      yield* registry.open(openInput("turn-a", "commit-a"));
      yield* registry.advanceTip(plan, PlanTurnId.make("turn-a"), CommitId.make("revision-1"));

      assert.ok(yield* registry.activeChainMember(plan, CommitId.make("commit-a")));
      assert.ok(yield* registry.activeChainMember(plan, CommitId.make("revision-1")));
      assert.ok(!(yield* registry.activeChainMember(plan, CommitId.make("commit-b"))));

      // A turn opening from the grown chain is the same-branch case.
      const refused = yield* Effect.flip(registry.open(openInput("turn-b", "revision-1")));
      assert.strictEqual(refused._tag, "PlanTurnActiveError");
      const tip = (yield* registry.getTurns(plan)).find(
        (turn) => turn.turnId === PlanTurnId.make("turn-a"),
      );
      assert.strictEqual(tip?.tipCommitId, CommitId.make("revision-1"));
    }),
  );

  it.effect("close releases only its own turn's claim", () =>
    Effect.gen(function* () {
      const registry = yield* PlanTurnRegistry.make;
      yield* registry.open(openInput("turn-a", "commit-a"));
      yield* registry.open(openInput("turn-b", "commit-b"));

      yield* registry.close(plan, PlanTurnId.make("turn-a"));
      assert.ok(!(yield* registry.activeChainMember(plan, CommitId.make("commit-a"))));
      assert.ok(yield* registry.activeChainMember(plan, CommitId.make("commit-b")));
      // The freed chain is claimable again.
      yield* registry.open(openInput("turn-c", "commit-a"));
    }),
  );

  it.effect("getByThread resolves a tool call to its own turn, across reassignment", () =>
    Effect.gen(function* () {
      const registry = yield* PlanTurnRegistry.make;
      yield* registry.open(openInput("turn-a", "commit-a"));
      yield* registry.open(openInput("turn-b", "commit-b"));

      const found = yield* registry.getByThread(ThreadId.make("thread-turn-b"));
      assert.ok(Option.isSome(found) && found.value.turnId === PlanTurnId.make("turn-b"));

      yield* registry.reassignThread(plan, PlanTurnId.make("turn-a"), ThreadId.make("moved"));
      const moved = yield* registry.getByThread(ThreadId.make("moved"));
      assert.ok(Option.isSome(moved) && moved.value.turnId === PlanTurnId.make("turn-a"));
      assert.ok(Option.isNone(yield* registry.getByThread(ThreadId.make("thread-turn-a"))));
    }),
  );
});
