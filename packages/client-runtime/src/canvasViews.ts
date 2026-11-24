import {
  canvasData,
  canvasFileName,
  canvasNameKey,
  placeCanvas,
  type CanvasData,
} from "@mercurian/wiki/canvas";
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
  readonly id?: string | undefined;
  readonly type: string;
  readonly runId?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly document?: unknown;
  readonly sourceToolItemIds?: ReadonlyArray<string> | undefined;
  readonly toolName?: string | null | undefined;
  readonly status?: string | undefined;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly updatedAt?: unknown;
}

/**
 * Recorded `canvas` items already present in a thread, used to suppress `dynamic_tool` fallbacks
 * for providers (such as Antigravity) whose tool output holds a human summary instead of the raw
 * MCP JSON with `canvasItemId`.
 */
export interface RecordedCanvases {
  readonly toolItemIds: ReadonlySet<string>;
  readonly names: ReadonlySet<string>;
  readonly namesByRun: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Collects the tool item ids and normalized canvas names that already have persisted `canvas` items. */
export function recordedCanvasesIn(items: ReadonlyArray<CanvasItem>): RecordedCanvases {
  const toolItemIds = new Set<string>();
  const names = new Set<string>();
  const namesByRun = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.type !== "canvas") continue;
    for (const toolItemId of item.sourceToolItemIds ?? []) {
      if (toolItemId.length > 0) toolItemIds.add(toolItemId);
    }
    const runNames =
      typeof item.runId === "string" && item.runId.length > 0
        ? (namesByRun.get(item.runId) ??
          (() => {
            const set = new Set<string>();
            namesByRun.set(item.runId, set);
            return set;
          })())
        : undefined;
    if (typeof item.id === "string" && item.id.length > 0) {
      runNames?.add(item.id);
    }
    if (typeof item.title === "string" && item.title.trim().length > 0) {
      const fileKey = canvasNameKey(canvasFileName(item.title));
      const titleKey = canvasNameKey(item.title);
      if (fileKey.length > 0) {
        names.add(fileKey);
        runNames?.add(fileKey);
      }
      if (titleKey.length > 0) {
        names.add(titleKey);
        runNames?.add(titleKey);
      }
    }
  }
  return { toolItemIds, names, namesByRun };
}

// An item changes only as a new object, and timelines re-derive their rows on every thread update.
const viewsByItem = new WeakMap<
  CanvasItem,
  {
    readonly view: CanvasView | null | undefined;
    readonly titleNames?: ReadonlyArray<string>;
    readonly updateNames?: ReadonlyArray<string>;
  }
>();

function viewOf(item: CanvasItem): {
  readonly view: CanvasView | null | undefined;
  readonly titleNames?: ReadonlyArray<string>;
  readonly updateNames?: ReadonlyArray<string>;
} {
  if (item.type === "canvas") {
    return {
      view: {
        title: item.title ?? "Canvas",
        data: canvasData(item.document),
        recorded: { document: item.document, revision: String(item.updatedAt ?? "") },
      },
    };
  }
  if (t3ToolResultIndicatesFailure(item.output)) return { view: undefined };
  // The board this call drew is its canvas item's, which draws in its place.
  if (compactDynamicToolOutput(item.output)?.canvasItemId !== undefined) return { view: null };
  const input = Option.getOrUndefined(decodeInput(toolArguments(item.input)));
  if (input === undefined) return { view: undefined };
  const titleNames = [
    canvasNameKey(canvasFileName(input.title)),
    canvasNameKey(input.title),
  ].filter((name) => name.length > 0);
  const updateTarget = input.update?.trim();
  const updateNames =
    updateTarget !== undefined && updateTarget.length > 0
      ? [
          updateTarget,
          canvasNameKey(canvasFileName(updateTarget)),
          canvasNameKey(updateTarget),
        ].filter((name) => name.length > 0)
      : undefined;
  return {
    view: { title: input.title, data: placeCanvas(input) },
    titleNames,
    ...(updateNames === undefined ? {} : { updateNames }),
  };
}

/**
 * The canvas an item draws: a `canvas` item, or a finished `astrolabe_canvas_show` call that
 * recorded none. `null` for a call whose canvas item draws it instead, which shows nothing itself;
 * undefined for any other item.
 */
export function canvasViewFromItem(
  item: CanvasItem,
  recorded?: RecordedCanvases,
): CanvasView | null | undefined {
  const drawn =
    item.type === "canvas" ||
    (item.type === "dynamic_tool" &&
      item.status === "completed" &&
      resolveT3McpToolId(item.toolName) === CANVAS_SHOW_TOOL_NAME);
  if (!drawn) return undefined;
  let cached = viewsByItem.get(item);
  if (cached === undefined) {
    cached = viewOf(item);
    viewsByItem.set(item, cached);
  }
  if (
    item.type === "dynamic_tool" &&
    cached.view !== undefined &&
    cached.view !== null &&
    recorded
  ) {
    if (typeof item.id === "string" && recorded.toolItemIds.has(item.id)) return null;
    if (
      typeof item.runId === "string" &&
      cached.updateNames !== undefined &&
      cached.updateNames.some((name) => recorded.namesByRun.get(item.runId!)?.has(name) === true)
    ) {
      return null;
    }
    if (
      recorded.names.size > 0 &&
      cached.titleNames?.some((name) => recorded.names.has(name)) === true
    ) {
      return null;
    }
  }
  return cached.view;
}

/** The thread's canvases, oldest first, each with the id of the item that draws it. */
export function canvasViews(
  items: ReadonlyArray<CanvasItem & { readonly id: string }>,
): ReadonlyArray<CanvasView & { readonly id: string }> {
  const recorded = recordedCanvasesIn(items);
  return items.flatMap((item) => {
    const view = canvasViewFromItem(item, recorded);
    return view === undefined || view === null ? [] : [{ ...view, id: item.id }];
  });
}

/** What a reply calls a thread's canvas: the file name its title gives, as the tool returned it. */
export const canvasViewFile = (view: Pick<CanvasView, "title">): string =>
  canvasFileName(view.title);

/**
 * The canvas a reply's `[[Name.canvas]]` or `![[Name.canvas#Group]]` names: by file name, with or
 * without `.canvas` and ignoring case, else by title. Names are unique in a thread from the server;
 * where older threads repeat one, the latest drawn wins, the one a reply just made.
 */
export function canvasViewNamed<View extends Pick<CanvasView, "title">>(
  views: ReadonlyArray<View>,
  name: string,
): View | undefined {
  const wanted = canvasNameKey(name);
  if (wanted === "") return undefined;
  return (
    views.findLast((view) => canvasNameKey(canvasViewFile(view)) === wanted) ??
    views.findLast((view) => canvasNameKey(view.title) === wanted)
  );
}

/** A board the user edited since the agent's last prompt, at the edit `editedAt` names. */
export interface EditedBoard {
  readonly id: string;
  readonly title: string;
  readonly editedAt: string;
  /** The user left this edit out of their next message; a later edit brings the board back. */
  readonly dismissed: boolean;
}

interface PromptedThread {
  readonly runs: ReadonlyArray<{
    readonly userMessageId: string;
    readonly requestedAt: DateTime.Utc;
    readonly startedAt: DateTime.Utc | null;
  }>;
  readonly messages: ReadonlyArray<{ readonly id: string; readonly text: string }>;
}

interface EditedBoardsThread extends PromptedThread {
  readonly turnItems: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly title?: string | null | undefined;
    readonly editedAt?: DateTime.Utc | undefined;
  }>;
}

/** When the latest prompt started, which a slash command is not; null before any. */
function lastPromptAt(thread: PromptedThread): DateTime.Utc | null {
  const lastPrompt = thread.runs.findLast(
    (run) =>
      !(thread.messages.find((message) => message.id === run.userMessageId)?.text ?? "")
        .trimStart()
        .startsWith("/"),
  );
  return lastPrompt === undefined ? null : (lastPrompt.startedAt ?? lastPrompt.requestedAt);
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
  const since = lastPromptAt(thread);
  if (since === null) return [];
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

/** Astrolabe: a file the user edited in the thread's linked file tabs since the last prompt. */
export interface EditedFile {
  /** Its path in the thread's checkout. */
  readonly path: string;
  readonly editedAt: string;
  /** The user left this edit out of their next message; a later edit brings the file back. */
  readonly dismissed: boolean;
}

interface EditedFilesThread extends PromptedThread {
  readonly thread: {
    readonly editedFiles?:
      | ReadonlyArray<{ readonly path: string; readonly editedAt: DateTime.Utc }>
      | undefined;
  };
}

/**
 * The files the agent's next turn is told about, by the server's `editedFilesSince` rule, newest
 * first; as `editedBoardsSinceLastPrompt`, `dismissed` maps a file's path to the edit left out.
 */
export function editedFilesSinceLastPrompt(
  thread: EditedFilesThread,
  dismissed: Readonly<Record<string, string>>,
): ReadonlyArray<EditedFile> {
  const since = lastPromptAt(thread);
  if (since === null) return [];
  return (thread.thread.editedFiles ?? []).flatMap((file) => {
    if (!DateTime.isGreaterThan(file.editedAt, since)) return [];
    const editedAt = DateTime.formatIso(file.editedAt);
    return [{ path: file.path, editedAt, dismissed: dismissed[file.path] === editedAt }];
  });
}
