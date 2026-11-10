import { useAtomValue } from "@effect/atom-react";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import { type ScopedThreadRef, TurnItemId } from "@t3tools/contracts";
import { MessageSquarePlusIcon } from "lucide-react";
import { Suspense } from "react";

import { TabHeader } from "~/panes/TabHeader";

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
  const itemId = TurnItemId.make(view.id);
  const walk = useCanvasWalk(view, { threadId: threadRef.threadId, itemId });
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => onStepKey(event, walk.steps.length, walk.step, walk.go)}
    >
      <TabHeader.Root>
        <TabHeader.Title label="Canvas">{view.title}</TabHeader.Title>
        <TabHeader.Actions>
          {walk.ask === undefined ? null : (
            <TabHeader.Action label={walk.ask.label} onClick={walk.ask.run}>
              <MessageSquarePlusIcon />
            </TabHeader.Action>
          )}
          <KeepCanvasButton
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            itemId={itemId}
            title={view.title}
            size="icon-sm"
          />
        </TabHeader.Actions>
      </TabHeader.Root>
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <LazyCanvasBoard
            data={view.data}
            mode="free"
            host={canvasHost(threadRef)}
            label={view.title}
            story={walk.story}
            step={walk.step}
            onStep={walk.go}
          />
        </Suspense>
      </div>
      <CanvasStepBar walk={walk} />
    </div>
  );
}
