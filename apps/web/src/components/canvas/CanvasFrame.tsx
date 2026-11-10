import {
  canvasBounds,
  canvasSteps,
  type CanvasCodeReference,
  type CanvasStep,
} from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { ScopedThreadRef, ThreadId, TurnItemId } from "@t3tools/contracts";
import { canvasContextRecord } from "@t3tools/shared/composerContextReferences";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";
import { readLocalApi } from "~/localApi";
import { useRightPanelStore } from "~/rightPanelStore";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CanvasStepBar, onStepKey } from "./CanvasStepBar";
import { KeepCanvasButton } from "./KeepCanvas";
import { showThreadCanvas } from "./threadCanvasStore";

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

/** Asking about a step puts the board and that step in the composer; none without a composer. */
export function useAskAboutStep(
  source: { readonly threadId: ThreadId; readonly itemId: TurnItemId } | null,
  title: string,
  steps: ReadonlyArray<CanvasStep>,
) {
  const composer = useComposerHandleContext();
  if (composer === null || source === null) return undefined;
  return (index: number) => {
    const step = steps[index];
    if (step === undefined) return;
    composer.current?.addCanvas(
      canvasContextRecord({
        ...source,
        title,
        walkStep: { index, count: steps.length, label: step.frame.label, note: step.note },
      }),
    );
  };
}

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
  source,
}: {
  readonly id: string;
  readonly view: CanvasView;
  readonly threadRef: ScopedThreadRef | null;
  /** The tool call that drew it, which a thread can hold from another thread. */
  readonly source: { readonly threadId: ThreadId; readonly itemId: TurnItemId };
}) {
  const { width, height } = canvasBounds(view.data);
  const steps = canvasSteps(view.data);
  const [step, setStep] = useState<number | null>(null);
  const onAsk = useAskAboutStep(threadRef === null ? null : source, view.title, steps);
  return (
    <figure
      className="m-0 overflow-hidden rounded-lg border border-border"
      onKeyDown={(event) => onStepKey(event, steps.length, step, setStep)}
    >
      <figcaption className="flex h-8 items-center gap-2 border-b border-border pr-1 pl-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{view.title}</span>
        {threadRef === null ? null : (
          <>
            <KeepCanvasButton
              environmentId={threadRef.environmentId}
              threadId={source.threadId}
              itemId={source.itemId}
              title={view.title}
              size="icon-xs"
            />
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
          </>
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
            step={step}
            onStep={setStep}
          />
        </Suspense>
      </div>
      <CanvasStepBar steps={steps} step={step} onStep={setStep} onAsk={onAsk} />
    </figure>
  );
}
