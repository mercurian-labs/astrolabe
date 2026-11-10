import { canvasSteps } from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { canvasContextRecord } from "@t3tools/shared/composerContextReferences";
import { useState } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";

import { toastManager } from "../ui/toast";

/**
 * A board's walk where it's read: the step shown, and asking about the board, or the step on
 * screen, in the composer.
 */
export function useCanvasWalk(
  view: CanvasView,
  source: { readonly threadId: ThreadId; readonly itemId: TurnItemId } | null,
) {
  const steps = canvasSteps(view.data);
  const [step, setStep] = useState<number | null>(null);
  const composer = useComposerHandleContext();
  const asked = step === null ? undefined : steps[step];
  return {
    steps,
    step,
    go: setStep,
    ask:
      composer === null || source === null
        ? undefined
        : {
            label: step === null ? "Ask about this canvas" : `Ask about step ${step + 1}`,
            run: () => {
              const added = composer.current?.addCanvas(
                canvasContextRecord({
                  ...source,
                  title: view.title,
                  ...(step === null || asked === undefined
                    ? {}
                    : {
                        walkStep: {
                          index: step,
                          count: steps.length,
                          label: asked.frame.label,
                          note: asked.note,
                        },
                      }),
                }),
              );
              if (added === false) {
                toastManager.add({
                  type: "warning",
                  title: "The composer can't take this right now",
                  description: "Answer the agent's question first.",
                });
              }
            },
          },
  };
}
