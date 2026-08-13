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
import { SpecDocument } from "@t3tools/contracts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, PlanningAssistant];

export const SavePlanRevisionInput = Schema.Struct({
  /** The plan document's whole text after the edit — a snapshot, not a diff. */
  text: Schema.String,
});

export const SavePlanRevisionResult = Schema.Struct({
  saved: Schema.Literal(true),
});

export const SaveSpecRevisionInput = Schema.Struct({ document: SpecDocument });
export const SaveSpecRevisionResult = Schema.Struct({ saved: Schema.Literal(true) });

export const SaveImplementProposalInput = Schema.Struct({
  repositories: Schema.Array(Schema.String),
  rationale: Schema.optional(Schema.String),
  splits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        repository: Schema.String,
        text: Schema.String,
      }),
    ),
  ),
});

export const SaveImplementProposalResult = Schema.Struct({ saved: Schema.Literal(true) });

export const ReadPlanResult = Schema.Struct({
  /** The plan document's current text. Empty is a real state. */
  text: Schema.String,
});
export const ReadSpecResult = Schema.Struct({ spec: Schema.NullOr(SpecDocument) });

// Unlike an empty Struct, this emits the object-root inputSchema MCP clients require.
const ReadPlanInput = Schema.Record(Schema.String, Schema.Never);
const ReadSpecInput = Schema.Record(Schema.String, Schema.Never);

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

export const SaveSpecRevisionTool = Tool.make("save_spec_revision", {
  description:
    "Replace the spec artifact with the complete behavioral contract. The spec contains the user story, acceptance criteria, and observable behavior; it does not contain implementation approach. Call read_spec first.",
  parameters: SaveSpecRevisionInput,
  success: SaveSpecRevisionResult,
  failure: PlanningTurnNotFoundError,
  dependencies,
})
  .annotate(Tool.Title, "Save spec revision")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const SaveImplementProposalTool = Tool.make("save_implement_proposal", {
  description:
    "Save the complete implement analysis. Name every repository the plan requires; when several are required, include one complete plan projection per repository. Calling again replaces the pending proposal until analysis completes.",
  parameters: SaveImplementProposalInput,
  success: SaveImplementProposalResult,
  failure: PlanningTurnNotFoundError,
  dependencies,
})
  .annotate(Tool.Title, "Save implement proposal")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const ReadPlanTool = Tool.make("read_plan", {
  description:
    "Read the plan document's current text, as of this conversation's tip. Use before save_plan_revision so the revision builds on what is actually there.",
  parameters: ReadPlanInput,
  success: ReadPlanResult,
  failure: PlanningTurnNotFoundError,
  dependencies,
})
  .annotate(Tool.Title, "Read the plan")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ReadSpecTool = Tool.make("read_spec", {
  description:
    "Read the spec artifact at this conversation's current tip. Null means the plan was born without a contract. Use before save_spec_revision.",
  parameters: ReadSpecInput,
  success: ReadSpecResult,
  failure: PlanningTurnNotFoundError,
  dependencies,
})
  .annotate(Tool.Title, "Read the spec")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const PlanningToolkit = Toolkit.make(
  SavePlanRevisionTool,
  SaveSpecRevisionTool,
  SaveImplementProposalTool,
  ReadPlanTool,
  ReadSpecTool,
);
