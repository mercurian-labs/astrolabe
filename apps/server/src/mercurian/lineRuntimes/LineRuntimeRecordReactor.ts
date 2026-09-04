import type { OrchestrationEvent } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { LineRuntimeStore } from "./LineRuntimeStore.ts";

type MetaUpdated = Extract<OrchestrationEvent, { type: "thread.meta-updated" }>;

export function lineRuntimeBranchDrift(
  event: OrchestrationEvent,
): { readonly threadId: MetaUpdated["payload"]["threadId"]; readonly branch: string } | null {
  return event.type === "thread.meta-updated" && event.payload.branch != null
    ? { threadId: event.payload.threadId, branch: event.payload.branch }
    : null;
}

export const LineRuntimeRecordReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const lineRuntimes = yield* LineRuntimeStore;
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        const drift = lineRuntimeBranchDrift(event);
        if (drift === null) return Effect.void;
        return lineRuntimes.getByThreadId(drift.threadId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (runtime) =>
                lineRuntimes.updateWorkspace(drift.threadId, {
                  branch: drift.branch,
                  worktreePath: runtime.worktreePath,
                }),
            }),
          ),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("line-runtime branch record update failed", {
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
