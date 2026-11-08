import { useAtomValue } from "@effect/atom-react";
import { type ScopedThreadRef, TurnItemId } from "@t3tools/contracts";
import { Suspense } from "react";

import { canvasViewsAtom, canvasViewsKey } from "~/state/canvasViews";

import { canvasHost, LazyCanvasBoard } from "./CanvasFrame";
import { KeepCanvasButton } from "./KeepCanvas";
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
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border pr-1 pl-3">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{view.title}</p>
        <KeepCanvasButton
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          itemId={TurnItemId.make(view.id)}
          title={view.title}
          size="xs"
        />
      </div>
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
