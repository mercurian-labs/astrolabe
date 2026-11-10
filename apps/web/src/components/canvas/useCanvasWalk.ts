import { canvasSteps, type CanvasCodeReference, type CanvasStep } from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId, TurnItemId } from "@t3tools/contracts";
import { canvasContextRecord } from "@t3tools/shared/composerContextReferences";
import { useRef, useState } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";
import { rightPanelHostRef, useRightPanelStore } from "~/rightPanelStore";

/** The code a step shows first: a card of its own before one it brings back from elsewhere. */
function stepCode(view: CanvasView, step: CanvasStep): CanvasCodeReference | undefined {
  const codeOf = (docked: boolean) =>
    view.data.nodes.find(
      (node) =>
        node.type === "link" &&
        node.astrolabe?.code !== undefined &&
        step.cards.has(node.id) &&
        step.docked.has(node.id) === docked,
    );
  const node = codeOf(false) ?? codeOf(true);
  return node?.type === "link" ? node.astrolabe?.code : undefined;
}

/**
 * A board's walk where it's read: the step shown, asking about one in the composer, and, while
 * the reader follows the code, each step's code opened in the thread's file panel.
 */
export function useCanvasWalk(
  view: CanvasView,
  threadRef: ScopedThreadRef | null,
  source: { readonly threadId: ThreadId; readonly itemId: TurnItemId },
) {
  const steps = canvasSteps(view.data);
  const [step, setStep] = useState<number | null>(null);
  const [followingCode, setFollowingCode] = useState(false);
  const composer = useComposerHandleContext();
  // The file tab the walk opened itself, which it closes as it moves on; the reader's stay.
  const walkTab = useRef<`file:${string}` | null>(null);
  const showCode = (index: number | null) => {
    const shown = index === null ? undefined : steps[index];
    const code = shown === undefined ? undefined : stepCode(view, shown);
    if (threadRef === null || code === undefined) return;
    const panel = useRightPanelStore.getState();
    const tab = `file:${code.path}` as const;
    const open = (
      panel.byThreadKey[scopedThreadKey(rightPanelHostRef(threadRef))]?.surfaces ?? []
    ).map((surface): string => surface.id);
    if (walkTab.current !== null && walkTab.current !== tab && open.includes(walkTab.current)) {
      panel.closeSurface(threadRef, walkTab.current);
    }
    if (!open.includes(tab)) walkTab.current = tab;
    else if (walkTab.current !== tab) walkTab.current = null;
    panel.openFile(threadRef, code.path, code.lines?.[0]);
  };
  const go = (index: number | null) => {
    setStep(index);
    if (followingCode) showCode(index);
  };
  const hasCode = threadRef !== null && steps.some((each) => stepCode(view, each) !== undefined);
  return {
    steps,
    step,
    go,
    followCode: hasCode
      ? {
          on: followingCode,
          toggle: () => {
            if (!followingCode) showCode(step ?? 0);
            if (!followingCode && step === null) setStep(0);
            setFollowingCode(!followingCode);
          },
        }
      : undefined,
    ask:
      composer === null || threadRef === null
        ? undefined
        : (index: number) => {
            const asked = steps[index];
            if (asked === undefined) return;
            composer.current?.addCanvas(
              canvasContextRecord({
                ...source,
                title: view.title,
                walkStep: {
                  index,
                  count: steps.length,
                  label: asked.frame.label,
                  note: asked.note,
                },
              }),
            );
          },
  };
}
