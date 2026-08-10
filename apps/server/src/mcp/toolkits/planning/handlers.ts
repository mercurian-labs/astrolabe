import * as Effect from "effect/Effect";

import { PlanningAssistant } from "../../../mercurian/assistant/PlanningAssistant.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { PlanningToolkit } from "./tools.ts";

/**
 * Both handlers resolve the caller the same way: the MCP credential names
 * the provider session's thread, and the assistant's registry says whether
 * that thread is an active planning turn. The revision commits at the
 * turn's own tip and streams to every window as an ordinary commit event —
 * equal standing, live, mid-turn.
 */
const handlers = {
  save_plan_revision: (input) =>
    Effect.gen(function* () {
      const invocation = yield* McpInvocationContext.McpInvocationContext;
      const assistant = yield* PlanningAssistant;
      yield* assistant.saveRevisionFromThread({
        threadId: invocation.threadId,
        text: input.text,
      });
      return { saved: true as const };
    }),
  save_technical_plan: (input) =>
    Effect.gen(function* () {
      const invocation = yield* McpInvocationContext.McpInvocationContext;
      const assistant = yield* PlanningAssistant;
      yield* assistant.saveTechnicalPlanFromThread({
        threadId: invocation.threadId,
        text: input.text,
      });
      return { saved: true as const };
    }),
  read_plan: () =>
    Effect.gen(function* () {
      const invocation = yield* McpInvocationContext.McpInvocationContext;
      const assistant = yield* PlanningAssistant;
      const text = yield* assistant.readPlanFromThread({ threadId: invocation.threadId });
      return { text };
    }),
} satisfies Parameters<typeof PlanningToolkit.toLayer>[0];

export const PlanningToolkitHandlersLive = PlanningToolkit.toLayer(handlers);
