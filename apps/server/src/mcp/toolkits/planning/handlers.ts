import * as Effect from "effect/Effect";

import { LineTurnReactor } from "../../../mercurian/assistant/LineTurnReactor.ts";
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
      const assistant = yield* LineTurnReactor;
      yield* assistant.saveRevisionFromThread({
        threadId: invocation.threadId,
        text: input.text,
      });
      return { saved: true as const };
    }),
  save_spec_revision: (input) =>
    Effect.gen(function* () {
      const invocation = yield* McpInvocationContext.McpInvocationContext;
      const assistant = yield* LineTurnReactor;
      yield* assistant.saveSpecRevisionFromThread({
        threadId: invocation.threadId,
        document: input.document,
      });
      return { saved: true as const };
    }),
  propose_memory_amendment: (input) =>
    Effect.gen(function* () {
      const invocation = yield* McpInvocationContext.McpInvocationContext;
      const assistant = yield* LineTurnReactor;
      yield* assistant.proposeMemoryAmendmentFromThread({
        threadId: invocation.threadId,
        title: input.title,
        notes: input.notes,
        placements: (input.placements ?? []).map((placement) => ({
          map: placement.map,
          parent: placement.parent,
          note: placement.note,
          ...(placement.type === undefined ? {} : { type: placement.type }),
        })),
      });
      return { saved: true as const };
    }),
  read_plan: () =>
    Effect.gen(function* () {
      const invocation = yield* McpInvocationContext.McpInvocationContext;
      const assistant = yield* LineTurnReactor;
      const text = yield* assistant.readPlanFromThread({ threadId: invocation.threadId });
      return { text };
    }),
  read_spec: () =>
    Effect.gen(function* () {
      const invocation = yield* McpInvocationContext.McpInvocationContext;
      const assistant = yield* LineTurnReactor;
      const spec = yield* assistant.readSpecFromThread({ threadId: invocation.threadId });
      return { spec };
    }),
} satisfies Parameters<typeof PlanningToolkit.toLayer>[0];

export const PlanningToolkitHandlersLive = PlanningToolkit.toLayer(handlers);
