import { canvasData, placeCanvas, type CanvasData } from "@mercurian/wiki/canvas";
import { CANVAS_SHOW_TOOL_NAME, CanvasShowInput } from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import { compactDynamicToolOutput, toolArguments } from "@t3tools/shared/toolOutput";
import * as DateTime from "effect/DateTime";
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
  /** A recorded board's file, which a person's edits replay on, and the version it is. */
  readonly recorded?: { readonly document: unknown; readonly revision: string };
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
  readonly updatedAt?: unknown;
}

// An item changes only as a new object, and timelines re-derive their rows on every thread update.
const viewsByItem = new WeakMap<CanvasItem, CanvasView | null | undefined>();

function viewOf(item: CanvasItem): CanvasView | null | undefined {
  if (item.type === "canvas") {
    return {
      title: item.title ?? "Canvas",
      data: canvasData(item.document),
      recorded: { document: item.document, revision: String(item.updatedAt ?? "") },
    };
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

/** A board the user edited since the agent's last prompt, at the edit `editedAt` names. */
export interface EditedBoard {
  readonly id: string;
  readonly title: string;
  readonly editedAt: string;
  /** The user left this edit out of their next message; a later edit brings the board back. */
  readonly dismissed: boolean;
}

interface EditedBoardsThread {
  readonly runs: ReadonlyArray<{
    readonly userMessageId: string;
    readonly requestedAt: DateTime.Utc;
    readonly startedAt: DateTime.Utc | null;
  }>;
  readonly messages: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  readonly turnItems: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly title?: string | null | undefined;
    readonly editedAt?: DateTime.Utc | undefined;
  }>;
}

/**
 * The boards the agent's next turn is told about, by the server's `editedCanvasNote` rule: edited
 * since the latest prompt, which a slash command is not. `dismissed` maps a board to the edit the
 * user left out. A queued message counts as sent, since its turn will tell the agent.
 */
export function editedBoardsSinceLastPrompt(
  thread: EditedBoardsThread,
  dismissed: Readonly<Record<string, string>>,
): ReadonlyArray<EditedBoard> {
  const lastPrompt = thread.runs.findLast(
    (run) =>
      !(thread.messages.find((message) => message.id === run.userMessageId)?.text ?? "")
        .trimStart()
        .startsWith("/"),
  );
  if (lastPrompt === undefined) return [];
  const since = lastPrompt.startedAt ?? lastPrompt.requestedAt;
  return thread.turnItems.flatMap((item) => {
    if (item.type !== "canvas" || item.editedAt === undefined) return [];
    if (!DateTime.isGreaterThan(item.editedAt, since)) return [];
    const editedAt = DateTime.formatIso(item.editedAt);
    return [
      {
        id: item.id,
        title: item.title ?? "Canvas",
        editedAt,
        dismissed: dismissed[item.id] === editedAt,
      },
    ];
  });
}
