/**
 * The planning toolkit: the assistant's one write door.
 *
 * A planning turn's filesystem is read-only by policy, so revising the plan
 * artifact happens through these tools and nowhere else. The handlers map
 * the calling session's thread to its live planning turn — a session that
 * is not an active planning turn is refused, which is what keeps coding
 * sessions from ever holding plan-revision powers by accident.
 */
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import {
  PlanningAssistant,
  PlanningTurnNotFoundError,
} from "../../../mercurian/assistant/PlanningAssistant.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, PlanningAssistant];

export const SavePlanRevisionInput = Schema.Struct({
  /** The plan document's whole text after the edit — a snapshot, not a diff. */
  text: Schema.String,
});

export const SavePlanRevisionResult = Schema.Struct({
  saved: Schema.Literal(true),
});

export const ReadPlanResult = Schema.Struct({
  /** The plan document's current text. Empty is a real state. */
  text: Schema.String,
});

export const SavePlanRevisionTool = Tool.make("save_plan_revision", {
  description:
    "Replace the plan document's whole text with the given text. This is the only way to change the plan — a revision is a snapshot of the entire document, not a diff, so pass the complete text you want the plan to contain. Call read_plan first so you revise what is actually there.",
  parameters: SavePlanRevisionInput,
  success: SavePlanRevisionResult,
  failure: PlanningTurnNotFoundError,
  dependencies,
})
  .annotate(Tool.Title, "Save plan revision")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const ReadPlanTool = Tool.make("read_plan", {
  description:
    "Read the plan document's current text, as of this conversation's tip. Use before save_plan_revision so the revision builds on what is actually there.",
  parameters: Schema.Struct({}),
  success: ReadPlanResult,
  failure: PlanningTurnNotFoundError,
  dependencies,
})
  .annotate(Tool.Title, "Read the plan")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const PlanningToolkit = Toolkit.make(SavePlanRevisionTool, ReadPlanTool);
