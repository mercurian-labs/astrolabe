import { CodeGraphShowInput } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * Astrolabe: an `astrolabe_code_graph_show` call's input, read as every client reads it: the
 * Graph tab draws it (`codeGraphViews.ts`) and the work log names what it showed.
 */

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

/** The call's story, or null when its input is not one. */
export const codeGraphShowInput = (input: unknown): CodeGraphShowInput | null =>
  Option.getOrNull(decodeInput(argumentsOf(input)));

/** What the call pictured, after its verb: `“Title” · 3 steps`, or `a picture of the code`. */
export function codeGraphStoryLabel(story: CodeGraphShowInput): string {
  const subject = story.title === undefined ? "a picture of the code" : `“${story.title}”`;
  return story.steps.length > 1 ? `${subject} · ${story.steps.length} steps` : subject;
}

/** The story's captions as a row's detail lists them: numbered when there are several. */
export const codeGraphStoryLines = (story: CodeGraphShowInput): string[] =>
  story.steps.length === 1
    ? [story.steps[0]!.caption]
    : story.steps.map((step, index) => `${index + 1}. ${step.caption}`);
