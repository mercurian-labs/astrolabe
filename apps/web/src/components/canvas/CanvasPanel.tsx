import { useAtomValue } from "@effect/atom-react";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import { type ScopedThreadRef, TurnItemId } from "@t3tools/contracts";
import { Suspense } from "react";

import { canvasViewsAtom, canvasViewsKey } from "~/state/canvasViews";

import { canvasHost, LazyCanvasBoard } from "./CanvasFrame";
import { CanvasStepBar, onStepKey } from "./CanvasStepBar";
import { KeepCanvasButton } from "./KeepCanvas";
import { useThreadCanvasStore } from "./threadCanvasStore";
import { useCanvasWalk } from "./useCanvasWalk";

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
  return <CanvasPanelBoard key={view.id} view={view} threadRef={threadRef} />;
}

function CanvasPanelBoard({
  view,
  threadRef,
}: {
  readonly view: CanvasView & { readonly id: string };
  readonly threadRef: ScopedThreadRef;
}) {
  const walk = useCanvasWalk(view, threadRef, {
    threadId: threadRef.threadId,
    itemId: TurnItemId.make(view.id),
  });
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => onStepKey(event, walk.steps.length, walk.step, walk.go)}
    >
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
            data={view.data}
            mode="free"
            host={canvasHost(threadRef)}
            label={view.title}
            step={walk.step}
            onStep={walk.go}
          />
        </Suspense>
      </div>
      <CanvasStepBar walk={walk} />
    </div>
  );
}
