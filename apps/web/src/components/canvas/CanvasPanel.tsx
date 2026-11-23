import { useAtomValue } from "@effect/atom-react";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import { type ScopedThreadRef, TurnItemId } from "@t3tools/contracts";
import { Suspense } from "react";

import { TabHeader } from "~/panes/TabHeader";

import { canvasViewsAtom, canvasViewsKey } from "~/state/canvasViews";

import { canvasHost, LazyCanvasBoard } from "./CanvasFrame";
import { useCanvasMenuItems } from "./canvasMenuItems";
import { useKeepCanvas } from "./KeepCanvas";
import { useThreadCanvasStore } from "./threadCanvasStore";
import { useThreadCanvasDocument } from "./useThreadCanvasDocument";

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
  const canvas = useThreadCanvasDocument(view, {
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    itemId,
  });
  const key = canvasViewsKey(threadRef);
  const readOnly = useThreadCanvasStore((store) => store.editingByThread[key] !== view.id);
  const asked = useThreadCanvasStore((store) => store.focusByThread[key]);
  const keep = useKeepCanvas({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    itemId,
    title: view.title,
  });
  const menuItems = useCanvasMenuItems(
    { threadId: threadRef.threadId, itemId, title: view.title },
    keep.item,
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabHeader.Root>
        <TabHeader.Title label="Canvas">{view.title}</TabHeader.Title>
      </TabHeader.Root>
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <LazyCanvasBoard
            data={view.data}
            mode="free"
            host={canvasHost(threadRef)}
            label={view.title}
            focus={asked?.id === view.id ? asked : null}
            menuItems={menuItems}
            {...(canvas === null
              ? {}
              : {
                  document: canvas,
                  readOnly,
                  onReadOnly: (next: boolean) =>
                    useThreadCanvasStore.getState().setEditing(key, next ? null : view.id),
                })}
          />
        </Suspense>
      </div>
      {keep.dialog}
    </div>
  );
}
