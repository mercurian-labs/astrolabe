import { useAtomValue } from "@effect/atom-react";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import { type ScopedThreadRef, TurnItemId } from "@t3tools/contracts";
import type { CanvasBoardHandle } from "@mercurian/wiki-editor/canvas-board";
import { Suspense, useRef } from "react";
import { canvasStoryEdit } from "@mercurian/wiki/canvas-edits";

import { TabHeader } from "~/panes/TabHeader";

import { canvasViewsAtom, canvasViewsKey } from "~/state/canvasViews";

import { canvasHost, LazyCanvasBoard } from "./CanvasFrame";
import { CanvasFramePopover } from "./CanvasFramePopover";
import { CanvasStoryPill, onStepKey } from "./CanvasStoryPill";
import { canvasMenuItems } from "./canvasMenuItems";
import { useKeepCanvas } from "./KeepCanvas";
import { useThreadCanvasStore } from "./threadCanvasStore";
import { useCanvasWalk } from "./useCanvasWalk";
import { useCanvasDocumentData, useThreadCanvasDocument } from "./useThreadCanvasDocument";

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
  const data = useCanvasDocumentData(canvas, view.data);
  const walk = useCanvasWalk({ title: view.title, data }, { threadId: threadRef.threadId, itemId });
  const board = useRef<CanvasBoardHandle>(null);
  const key = canvasViewsKey(threadRef);
  const readOnly = useThreadCanvasStore((store) => store.editingByThread[key] !== view.id);
  const keep = useKeepCanvas({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    itemId,
    title: view.title,
  });
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => onStepKey(event, walk.steps.length, walk.step, walk.go)}
    >
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
            story={walk.story}
            step={walk.step}
            openFrame={walk.frame?.step ?? null}
            onFrame={walk.toggleFrame}
            onPresent={() => walk.go(0)}
            menuItems={canvasMenuItems(walk, keep.item)}
            {...(canvas === null
              ? {}
              : {
                  document: canvas,
                  readOnly,
                  onReadOnly: (next: boolean) =>
                    useThreadCanvasStore.getState().setEditing(key, next ? null : view.id),
                  onStepAdded: (index: number) => {
                    if (walk.step !== null) walk.go(index);
                  },
                })}
            ref={board}
          >
            <CanvasStoryPill
              walk={walk}
              edit={
                canvas === null || readOnly
                  ? undefined
                  : (change) => canvas.commit(canvasStoryEdit(canvas.document, change, canvas.mint))
              }
            />
          </LazyCanvasBoard>
        </Suspense>
      </div>
      <CanvasFramePopover view={view} walk={walk} onCard={(id) => board.current?.focusCard(id)} />
      {keep.dialog}
    </div>
  );
}
