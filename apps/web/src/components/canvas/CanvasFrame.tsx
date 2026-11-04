import { canvasBounds, type CanvasCodeReference } from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Maximize2Icon } from "lucide-react";
import { lazy, Suspense } from "react";

import { readLocalApi } from "~/localApi";
import { useRightPanelStore } from "~/rightPanelStore";
import { canvasViewsKey } from "~/state/canvasViews";

import { Button } from "../ui/button";
import { useThreadCanvasStore } from "./threadCanvasStore";

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
 * board loads, with its pan and zoom one click away in the right panel.
 */
export function CanvasFrame({
  id,
  view,
  threadRef,
}: {
  readonly id: string;
  readonly view: CanvasView;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { width, height } = canvasBounds(view.data);
  return (
    <figure className="m-0 overflow-hidden rounded-lg border border-border">
      <figcaption className="flex h-8 items-center gap-2 border-b border-border pr-1 pl-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{view.title}</span>
        {threadRef === null ? null : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Open ${view.title} in a panel`}
            onClick={() => {
              useThreadCanvasStore.getState().show(canvasViewsKey(threadRef), id);
              useRightPanelStore.getState().open(threadRef, "canvas");
            }}
          >
            <Maximize2Icon />
          </Button>
        )}
      </figcaption>
      <div
        className="max-h-[520px] min-h-40 w-full"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <Suspense fallback={null}>
          <LazyCanvasBoard
            data={view.data}
            mode="fit"
            host={canvasHost(threadRef)}
            label={view.title}
          />
        </Suspense>
      </div>
    </figure>
  );
}
