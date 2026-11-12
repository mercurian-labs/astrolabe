import { canvasBounds, type CanvasCodeReference } from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { ScopedThreadRef, ThreadId, TurnItemId } from "@t3tools/contracts";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import type { CanvasBoardHandle } from "@mercurian/wiki-editor/canvas-board";
import { lazy, Suspense, useRef } from "react";

import { readLocalApi } from "~/localApi";
import { useRightPanelStore } from "~/rightPanelStore";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CanvasFramePopover } from "./CanvasFramePopover";
import { CanvasStoryPill, onStepKey } from "./CanvasStoryPill";
import { canvasMenuItems } from "./canvasMenuItems";
import { useKeepCanvas } from "./KeepCanvas";
import { showThreadCanvas } from "./threadCanvasStore";
import { useCanvasWalk } from "./useCanvasWalk";
import { useCanvasDocumentData, useThreadCanvasDocument } from "./useThreadCanvasDocument";

// The board brings the Markdown parser; a thread with no canvas shouldn't load it.
export const LazyCanvasBoard = lazy(() =>
  import("@mercurian/wiki-editor/canvas-board").then((module) => ({
    default: module.CanvasBoard,
  })),
);

const openUrl = (href: string) => {
  const api = readLocalApi();
  if (api) void api.shell.openExternal(href);
  else window.open(href, "_blank", "noopener,noreferrer");
};

/** What a canvas's cards can reach from a thread; a guest page has no thread to open files in. */
export const canvasHost = (threadRef: ScopedThreadRef | null) => ({
  onOpenUrl: openUrl,
  ...(threadRef === null
    ? {}
    : {
        onOpenCode: (code: CanvasCodeReference) =>
          useRightPanelStore.getState().openFile(threadRef, code.path, code.lines?.[0]),
      }),
});

/**
 * A canvas in a thread: the whole board, sized by its own shape so the row never shifts when the
 * board loads. It pans and zooms in place; the wheel scrolls the thread until the board is clicked.
 */
export function CanvasFrame({
  id,
  view,
  threadRef,
  source,
}: {
  readonly id: string;
  readonly view: CanvasView;
  readonly threadRef: ScopedThreadRef | null;
  /** The tool call that drew it, which a thread can hold from another thread. */
  readonly source: { readonly threadId: ThreadId; readonly itemId: TurnItemId };
}) {
  const { width, height } = canvasBounds(view.data);
  const canvas = useThreadCanvasDocument(
    view,
    threadRef === null ? null : { environmentId: threadRef.environmentId, ...source },
  );
  const data = useCanvasDocumentData(canvas, view.data);
  const walk = useCanvasWalk({ title: view.title, data }, threadRef === null ? null : source);
  const board = useRef<CanvasBoardHandle>(null);
  const keep = useKeepCanvas(
    threadRef === null
      ? null
      : { environmentId: threadRef.environmentId, ...source, title: view.title },
  );
  return (
    <figure
      className="m-0 overflow-hidden rounded-lg border border-border"
      onKeyDown={(event) => onStepKey(event, walk.steps.length, walk.step, walk.go)}
    >
      <figcaption className="flex h-8 items-center gap-2 border-b border-border pr-1 pl-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{view.title}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {threadRef === null ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Open ${view.title} in a tab`}
                    onClick={() => showThreadCanvas(threadRef, id)}
                  />
                }
              >
                <SquareArrowOutUpRightIcon />
              </TooltipTrigger>
              <TooltipPopup side="bottom">Open in a tab</TooltipPopup>
            </Tooltip>
          )}
        </div>
      </figcaption>
      {/* A story's note and controls float over the board, which keeps room to show it beside them. */}
      <div
        className={`max-h-[520px] w-full ${walk.steps.length === 0 ? "min-h-40" : "min-h-80"}`}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <Suspense fallback={null}>
          <LazyCanvasBoard
            data={view.data}
            mode="free"
            wheelOnceFocused
            host={canvasHost(threadRef)}
            label={view.title}
            story={walk.story}
            step={walk.step}
            openFrame={walk.frame?.step ?? null}
            onFrame={walk.toggleFrame}
            onPresent={() => walk.go(0)}
            menuItems={canvasMenuItems(walk, keep.item)}
            {...(canvas === null || threadRef === null
              ? {}
              : {
                  document: canvas,
                  // The chat column is too narrow to edit in: Edit opens the board in its tab.
                  readOnly: true,
                  onReadOnly: (readOnly: boolean) => {
                    if (!readOnly) showThreadCanvas(threadRef, id, true);
                  },
                })}
            ref={board}
          >
            <CanvasStoryPill walk={walk} />
          </LazyCanvasBoard>
        </Suspense>
      </div>
      <CanvasFramePopover view={view} walk={walk} onCard={(id) => board.current?.focusCard(id)} />
      {keep.dialog}
    </figure>
  );
}
