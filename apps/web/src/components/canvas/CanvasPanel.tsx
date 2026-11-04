import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Suspense } from "react";

import { canvasViewsAtom, canvasViewsKey } from "~/state/canvasViews";

import { canvasHost, LazyCanvasBoard } from "./CanvasFrame";
import { useThreadCanvasStore } from "./threadCanvasStore";

/** A thread's Canvas tab: the canvas opened from the thread, to pan and zoom. */
export function CanvasPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const key = canvasViewsKey(threadRef);
  const views = useAtomValue(canvasViewsAtom(key));
  const shown = useThreadCanvasStore((store) => store.shownByThread[key]);
  const view = views.find((each) => each.id === shown) ?? views.at(-1);
  if (view === undefined) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Canvases an agent draws in this thread open here.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="truncate border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        {view.title}
      </p>
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <LazyCanvasBoard
            key={view.id}
            data={view.data}
            mode="free"
            host={canvasHost(threadRef)}
            label={view.title}
          />
        </Suspense>
      </div>
    </div>
  );
}
