import { canvasData, placeCanvas, type CanvasData } from "@mercurian/wiki/canvas";
import { CANVAS_SHOW_TOOL_NAME, CanvasShowInput } from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import { compactDynamicToolOutput, toolArguments } from "@t3tools/shared/toolOutput";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { t3ToolResultIndicatesFailure } from "./t3ToolSummary.ts";

/**
 * Astrolabe: a canvas an agent drew in a thread. The server lays it out once and records it as a
 * `canvas` turn item, which is what clients draw. A call from before that has only its input, which
 * every client lays out the same.
 */
export interface CanvasView {
  readonly title: string;
  readonly data: CanvasData;
}

const decodeInput = Schema.decodeUnknownOption(CanvasShowInput);

interface CanvasItem {
  readonly type: string;
  readonly title?: string | null | undefined;
  readonly document?: unknown;
  readonly toolName?: string | null | undefined;
  readonly status?: string | undefined;
  readonly input?: unknown;
  readonly output?: unknown;
}

// A finished item never changes, and timelines re-derive their rows on every thread update.
const viewsByItem = new WeakMap<CanvasItem, CanvasView | null | undefined>();

function viewOf(item: CanvasItem): CanvasView | null | undefined {
  if (item.type === "canvas") {
    return { title: item.title ?? "Canvas", data: canvasData(item.document) };
  }
  if (t3ToolResultIndicatesFailure(item.output)) return undefined;
  // The board this call drew is its canvas item's, which draws in its place.
  if (compactDynamicToolOutput(item.output)?.canvasItemId !== undefined) return null;
  const input = Option.getOrUndefined(decodeInput(toolArguments(item.input)));
  return input === undefined ? undefined : { title: input.title, data: placeCanvas(input) };
}

/**
 * The canvas an item draws: a `canvas` item, or a finished `astrolabe_canvas_show` call that
 * recorded none. `null` for a call whose canvas item draws it instead, which shows nothing itself;
 * undefined for any other item.
 */
export function canvasViewFromItem(item: CanvasItem): CanvasView | null | undefined {
  const drawn =
    item.type === "canvas" ||
    (item.type === "dynamic_tool" &&
      item.status === "completed" &&
      resolveT3McpToolId(item.toolName) === CANVAS_SHOW_TOOL_NAME);
  if (!drawn) return undefined;
  if (viewsByItem.has(item)) return viewsByItem.get(item);
  const view = viewOf(item);
  viewsByItem.set(item, view);
  return view;
}

/** The thread's canvases, oldest first, each with the id of the item that draws it. */
export function canvasViews(
  items: ReadonlyArray<CanvasItem & { readonly id: string }>,
): ReadonlyArray<CanvasView & { readonly id: string }> {
  return items.flatMap((item) => {
    const view = canvasViewFromItem(item);
    return view === undefined || view === null ? [] : [{ ...view, id: item.id }];
  });
}
