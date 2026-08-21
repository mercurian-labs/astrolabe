import type { PlanId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { AgentAwarenessRelay } from "../../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../../serverActivation.ts";
import { PlanningAssistant, type PlanTurnStatus } from "../assistant/PlanningAssistant.ts";
import { CodingSessionStore } from "../codingSessions/CodingSessionStore.ts";
import { PlanningStore, type PlanningTreeSnapshot } from "../planning/PlanningStore.ts";
import { planAwarenessThreadId, projectPlanAwareness } from "./planAwareness.ts";

function statusIdentity(status: PlanTurnStatus): string {
  return JSON.stringify(status);
}

export const PlanAwarenessReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const assistant = yield* PlanningAssistant;
    const planningStore = yield* PlanningStore;
    const codingSessionStore = yield* CodingSessionStore;
    const relay = yield* AgentAwarenessRelay;
    const environmentId = yield* (yield* ServerEnvironment).getEnvironmentId;
    const previousStatusesRef = yield* Ref.make(new Map<PlanId, PlanTurnStatus>());

    const publishPlan = Effect.fn("PlanAwarenessReactor.publishPlan")(function* (
      planId: PlanId,
      status: PlanTurnStatus | null,
      modelTitle: string,
      snapshot: PlanningTreeSnapshot,
    ) {
      const threadId = planAwarenessThreadId(planId);
      const plan = snapshot.plans.find((candidate) => candidate.planId === planId);
      if (plan === undefined || plan.archivedAt !== null) {
        yield* relay.publishState(threadId, null);
        return;
      }
      const project = snapshot.projects.find((candidate) => candidate.projectId === plan.projectId);
      if (project === undefined) {
        yield* relay.publishState(threadId, null);
        return;
      }
      yield* relay.publishState(
        threadId,
        projectPlanAwareness({ environmentId, plan, project, turnStatus: status, modelTitle }),
      );
    });

    const publishStatusDiff = Effect.fn("PlanAwarenessReactor.publishStatusDiff")(function* () {
      const currentStatuses = yield* assistant.status;
      const previousStatuses = yield* Ref.get(previousStatusesRef);
      const changed = [...currentStatuses].filter(([planId, status]) => {
        const previous = previousStatuses.get(planId);
        return previous === undefined || statusIdentity(previous) !== statusIdentity(status);
      });
      const settled = [...previousStatuses].filter(([planId]) => !currentStatuses.has(planId));
      if (changed.length === 0 && settled.length === 0) return;

      const snapshot = yield* planningStore.getTreeSnapshot;
      yield* Effect.forEach(
        changed,
        ([planId, status]) => publishPlan(planId, status, status.modelTitle, snapshot),
        { discard: true },
      );
      yield* Effect.forEach(
        settled,
        ([planId, previous]) => publishPlan(planId, null, previous.modelTitle, snapshot),
        { discard: true },
      );
      yield* Ref.set(previousStatusesRef, new Map(currentStatuses));
    });

    const publishSessionsForPlan = Effect.fn("PlanAwarenessReactor.publishSessionsForPlan")(
      function* (planId: PlanId) {
        const sessions = yield* codingSessionStore.listForPlan(planId);
        yield* Effect.forEach(sessions, (session) => relay.publishThread(session.threadId), {
          discard: true,
        });
      },
    );

    yield* forkParked(
      Stream.runForEach(assistant.changes, () =>
        publishStatusDiff().pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("plan awareness status publish failed", {
                  cause: Cause.pretty(cause),
                }),
          ),
        ),
      ),
    );
    yield* forkParked(
      Stream.runForEach(codingSessionStore.changes, (planId) =>
        publishSessionsForPlan(planId).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("coding-session awareness republish failed", {
                  cause: Cause.pretty(cause),
                }),
          ),
        ),
      ),
    );
  }),
);
