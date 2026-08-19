import type { OrchestrationEvent } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { CodingSessionStore } from "./CodingSessionStore.ts";

type MetaUpdated = Extract<OrchestrationEvent, { type: "thread.meta-updated" }>;

export function codingSessionBranchDrift(
  event: OrchestrationEvent,
): { readonly threadId: MetaUpdated["payload"]["threadId"]; readonly branch: string } | null {
  return event.type === "thread.meta-updated" && event.payload.branch != null
    ? { threadId: event.payload.threadId, branch: event.payload.branch }
    : null;
}

export const CodingSessionRecordReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const sessions = yield* CodingSessionStore;
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        const drift = codingSessionBranchDrift(event);
        if (drift === null) return Effect.void;
        return sessions.updateBranch(drift.threadId, drift.branch).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("coding-session branch record update failed", {
                  threadId: drift.threadId,
                  branch: drift.branch,
                  cause: Cause.pretty(cause),
                }),
          ),
        );
      }),
    );
  }),
);
