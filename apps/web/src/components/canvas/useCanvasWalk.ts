import { canvasSteps } from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { canvasContextRecord } from "@t3tools/shared/composerContextReferences";
import { useState } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";

import { toastManager } from "../ui/toast";

/**
 * A board's stories where it's read: the story picked, its step shown, and asking about the board,
 * or the step on screen, in the composer.
 */
export function useCanvasWalk(
  view: CanvasView,
  source: { readonly threadId: ThreadId; readonly itemId: TurnItemId } | null,
) {
  const stories = view.data.stories ?? [];
  const [picked, setPicked] = useState(0);
  const story = Math.min(picked, Math.max(0, stories.length - 1));
  const steps = canvasSteps(view.data, story);
  const [step, setStep] = useState<number | null>(null);
  const composer = useComposerHandleContext();
  const asked = step === null ? undefined : steps[step];
  return {
    stories,
    story,
    pick: (index: number) => {
      setPicked(index);
      setStep(null);
    },
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
                          story,
                          storyTitle: stories[story]?.title ?? "",
                          index: step,
                          count: steps.length,
                          label: asked.label,
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
