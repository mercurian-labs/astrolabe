import { placeCanvas, type CanvasData } from "@mercurian/wiki/canvas";
import { CANVAS_SHOW_TOOL_NAME, CanvasShowInput } from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import { toolArguments } from "@t3tools/shared/toolOutput";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { t3ToolResultIndicatesFailure } from "./t3ToolSummary.ts";

/**
 * Astrolabe: a canvas an agent drew in a thread, read from its finished `astrolabe_canvas_show`
 * call. Nothing else stores it: the call is the record, and every client lays it out the same.
 */
export interface CanvasView {
  readonly title: string;
  readonly data: CanvasData;
}

const decodeInput = Schema.decodeUnknownOption(CanvasShowInput);

interface CanvasToolItem {
  readonly toolName?: string | null | undefined;
  readonly status?: string | undefined;
  readonly input?: unknown;
  readonly output?: unknown;
}

// A finished call never changes, and timelines re-derive their rows on every thread update.
const viewsByItem = new WeakMap<CanvasToolItem, CanvasView | null>();

/** The canvas a tool item drew, or undefined for any other item and for a failed call. */
export function canvasViewFromToolItem(item: CanvasToolItem): CanvasView | undefined {
  if (item.status !== "completed") return undefined;
  if (resolveT3McpToolId(item.toolName) !== CANVAS_SHOW_TOOL_NAME) return undefined;
  const cached = viewsByItem.get(item);
  if (cached !== undefined) return cached ?? undefined;
  const input = t3ToolResultIndicatesFailure(item.output)
    ? null
    : Option.getOrNull(decodeInput(toolArguments(item.input)));
  const view = input === null ? null : { title: input.title, data: placeCanvas(input) };
  viewsByItem.set(item, view);
  return view ?? undefined;
}

/** The thread's finished canvases, oldest first, each with its tool call's item id. */
export function canvasViews(
  items: ReadonlyArray<CanvasToolItem & { readonly id: string; readonly type: string }>,
): ReadonlyArray<CanvasView & { readonly id: string }> {
  return items.flatMap((item) => {
    if (item.type !== "dynamic_tool") return [];
    const view = canvasViewFromToolItem(item);
    return view === undefined ? [] : [{ ...view, id: item.id }];
  });
}
