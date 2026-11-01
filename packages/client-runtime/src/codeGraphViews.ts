import {
  CodeGraphShowInput,
  type CodeGraphLevel,
  type CodeGraphStepInput,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { t3ToolResultIndicatesFailure } from "./t3ToolSummary.ts";

/**
 * Astrolabe: the code graph views an agent showed in a thread, read from its finished
 * `astrolabe_code_graph_show` calls. Nothing else stores them: the call is the record, so a view
 * lives as long as the thread and reads the same on every client.
 */

/** A view as the Graph tab draws it: every step over the same roots, all the steps' nodes. */
export interface CodeGraphView {
  /** The tool call's turn item id: stable, so a client can remember which it shows. */
  readonly id: string;
  readonly title: string | null;
  readonly roots: readonly [string, ...string[]];
  readonly steps: ReadonlyArray<CodeGraphViewStep>;
}

export interface CodeGraphViewStep {
  readonly caption: string;
  readonly focus: readonly string[];
  readonly links: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  readonly level: CodeGraphLevel;
  readonly depth: 0 | 1 | 2 | 3;
  readonly expandNeighbours: readonly string[];
  readonly showContents: readonly string[];
}

const TOOL = "astrolabe_code_graph_show";

const decodeInput = Schema.decodeUnknownOption(CodeGraphShowInput);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A tool's input as an object: parsed from JSON text, out of Cursor's args envelope, or as given. */
function argumentsOf(input: unknown): unknown {
  if (typeof input === "string") {
    try {
      return argumentsOf(JSON.parse(input));
    } catch {
      return null;
    }
  }
  const record = asRecord(input);
  if (record !== null && typeof record.toolName === "string" && asRecord(record.args)) {
    return record.args;
  }
  return input;
}

const stepOf = (step: CodeGraphStepInput): CodeGraphViewStep => ({
  caption: step.caption,
  focus: step.focus,
  links: step.links ?? [],
  level: step.level ?? "file",
  depth: step.depth ?? 0,
  expandNeighbours: step.expandNeighbours ?? [],
  showContents: step.showContents ?? [],
});

type ToolItem = Extract<OrchestrationV2TurnItem, { readonly type: "dynamic_tool" }>;

/** The thread's finished, successful graph views, oldest first. */
export function codeGraphViews(
  items: ReadonlyArray<OrchestrationV2TurnItem | { readonly type: string }>,
): CodeGraphView[] {
  const views: Array<CodeGraphView & { readonly ordinal: number }> = [];
  for (const each of items) {
    if (each.type !== "dynamic_tool") continue;
    // A thread's structure keeps tool items whole: only streamed text is stripped from it.
    const item = each as ToolItem;
    if (item.status !== "completed") continue;
    if (!item.toolName?.endsWith(TOOL) || t3ToolResultIndicatesFailure(item.output)) continue;
    const input = Option.getOrNull(decodeInput(argumentsOf(item.input)));
    if (input === null) continue;
    const steps = input.steps.map(stepOf);
    const [first, ...rest] = [...new Set(steps.flatMap((step) => step.focus))];
    if (first === undefined) continue;
    views.push({
      id: item.id,
      ordinal: item.ordinal,
      title: input.title ?? null,
      roots: [first, ...rest],
      steps,
    });
  }
  return [...views]
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
    .map(({ ordinal: _, ...view }) => view);
}

/** The step a reader asks for, kept inside the view. */
export const clampStep = (view: CodeGraphView, step: number): number =>
  Math.max(0, Math.min(view.steps.length - 1, Math.trunc(step)));
