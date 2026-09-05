import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  MERCURIAN_WS_METHODS,
  MercurianCommitId,
  MercurianProjectId,
  PlanId,
  type MercurianSubscribePlanInput,
  type PlanDetail,
  type PlanStreamItem,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { PrimaryConnectionTarget, AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { subscribeMercurianPlan } from "./mercurianPlanning.ts";
import type { PlanSubscriptionState } from "./planReducer.ts";

const planId = PlanId.make("same-plan-id");
const snapshot: PlanDetail = {
  plan: {
    planId,
    projectId: MercurianProjectId.make("project"),
    title: "Plan",
    createdAt: "2026-09-05T00:00:00Z",
    updatedAt: "2026-09-05T00:00:00Z",
  },
  planText: "",
  spec: null,
  timeline: [],
  snapshotSequence: 40,
  checkpoints: [],
  checkpointSequence: 7,
  codingSessions: [],
  lineRuntimes: [],
  inFlightTurns: [],
};
const harness = Effect.fn("checkpointSubscriptionHarness")(function* (environment: string) {
  const inputs = yield* Queue.unbounded<MercurianSubscribePlanInput>();
  const frames = yield* Queue.unbounded<PlanStreamItem>();
  const states = yield* Queue.unbounded<PlanSubscriptionState>();
  const client = {
    [MERCURIAN_WS_METHODS.subscribePlan]: (input: MercurianSubscribePlanInput) =>
      Stream.unwrap(Queue.offer(inputs, input).pipe(Effect.as(Stream.fromQueue(frames)))),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession = {
    client,
    initialConfig: Effect.never,
    subscribeServerConfig: () => Stream.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  const activeSession = yield* SubscriptionRef.make(Option.some(session));
  const supervisor = EnvironmentSupervisor.of({
    target: new PrimaryConnectionTarget({
      environmentId: EnvironmentId.make(environment),
      label: environment,
      httpBaseUrl: "https://example.test",
      wsBaseUrl: "wss://example.test",
    }),
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: activeSession,
    prepared: yield* SubscriptionRef.make(
      Option.none<import("../connection/model.ts").PreparedConnection>(),
    ),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  yield* subscribeMercurianPlan({ planId }).pipe(
    Stream.runForEach((state) => Queue.offer(states, state)),
    Effect.provideService(EnvironmentSupervisor, supervisor),
    Effect.forkScoped,
  );
  return {
    inputs,
    frames,
    states,
    reconnect: SubscriptionRef.set(activeSession, Option.some({ ...session })),
  };
});
it.effect(
  "resumes late checkpoint updates independently of commits and isolates identical plan IDs across environments",
  () =>
    Effect.gen(function* () {
      const first = yield* harness("first");
      assert.deepStrictEqual(yield* Queue.take(first.inputs), { planId });
      yield* Queue.offer(first.frames, { kind: "snapshot", snapshot });
      yield* Queue.take(first.states);
      yield* first.reconnect;
      assert.deepStrictEqual(yield* Queue.take(first.inputs), {
        planId,
        afterSequence: 40,
        afterCheckpointSequence: 7,
      });
      yield* Queue.offer(first.frames, {
        kind: "checkpoint-update",
        record: {
          ownerCommitId: MercurianCommitId.make("old-query"),
          planId,
          projectId: snapshot.plan.projectId,
          lineRootCommitId: MercurianCommitId.make("root"),
          revision: 3,
          updateSequence: 12,
        },
      });
      yield* Queue.take(first.states);
      yield* Queue.offer(first.frames, {
        kind: "checkpoint-synchronized",
        planId,
        checkpointSequence: 12,
      });
      yield* Queue.take(first.states);
      yield* first.reconnect;
      assert.deepStrictEqual(yield* Queue.take(first.inputs), {
        planId,
        afterSequence: 40,
        afterCheckpointSequence: 12,
      });
      const second = yield* harness("second");
      assert.deepStrictEqual(yield* Queue.take(second.inputs), { planId });
      yield* Queue.offer(second.frames, {
        kind: "snapshot",
        snapshot: { ...snapshot, checkpointSequence: 0, snapshotSequence: 1 },
      });
      assert.deepStrictEqual((yield* Queue.take(second.states)).detail?.checkpoints, []);
    }).pipe(Effect.scoped),
);
