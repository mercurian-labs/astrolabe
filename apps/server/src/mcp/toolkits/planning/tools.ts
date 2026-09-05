/** Reviewed memory amendments; plans and specs use ordinary filesystem tools. */
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import {
  LineTurnReactor,
  PlanningTurnNotFoundError,
} from "../../../mercurian/assistant/LineTurnReactor.ts";
import { MemoryAmendmentValidationError } from "../../../mercurian/memory/MemoryIndex.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, LineTurnReactor];

export const ProposeMemoryAmendmentInput = Schema.Struct({
  title: Schema.String,
  notes: Schema.Array(Schema.Struct({ name: Schema.String, markdown: Schema.String })),
  placements: Schema.optional(
    Schema.Array(
      Schema.Struct({
        map: Schema.String,
        parent: Schema.String,
        note: Schema.String,
        type: Schema.optional(Schema.String),
      }),
    ),
  ),
});
export const ProposeMemoryAmendmentResult = Schema.Struct({ saved: Schema.Literal(true) });

export const ProposeMemoryAmendmentTool = Tool.make("propose_memory_amendment", {
  description:
    "Land an amendment on this line's memory branch. Supply every changed note as its complete markdown and optional typed-edge placements in named maps. One call creates one memory-only commit.",
  parameters: ProposeMemoryAmendmentInput,
  success: ProposeMemoryAmendmentResult,
  failure: Schema.Union([PlanningTurnNotFoundError, MemoryAmendmentValidationError]),
  dependencies,
})
  .annotate(Tool.Title, "Land memory amendment")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false);

export const PlanningToolkit = Toolkit.make(ProposeMemoryAmendmentTool);
