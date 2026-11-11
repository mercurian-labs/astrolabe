import { canvasSteps } from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { canvasContextRecord } from "@t3tools/shared/composerContextReferences";
import { useState } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";

import { toastManager } from "../ui/toast";

/**
 * A board's stories where it's read: the story picked, its step shown, a step's details opened from
 * its frame, and asking about the board, or a step, in the composer.
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
  const [frame, setFrame] = useState<{ readonly step: number; readonly chip: HTMLElement } | null>(
    null,
  );
  const composer = useComposerHandleContext();
  const askAbout =
    composer === null || source === null
      ? undefined
      : (index: number | null) => {
          const asked = index === null ? undefined : steps[index];
          const added = composer.current?.addCanvas(
            canvasContextRecord({
              ...source,
              title: view.title,
              ...(index === null || asked === undefined
                ? {}
                : {
                    walkStep: {
                      story,
                      storyTitle: stories[story]?.title ?? "",
                      index,
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
        };
  const go = (next: number | null) => {
    setStep(next);
    setFrame(null);
  };
  return {
    stories,
    story,
    pick: (index: number) => {
      setPicked(index);
      go(null);
    },
    steps,
    step,
    go,
    frame,
    /** Opens a step's details beside its frame's number, or closes them if they're open. */
    toggleFrame: (index: number, chip: HTMLElement) =>
      setFrame((open) => (open?.step === index ? null : { step: index, chip })),
    closeFrame: () => setFrame(null),
    askAbout,
    ask:
      askAbout === undefined
        ? undefined
        : {
            label: step === null ? "Ask about this canvas" : `Ask about step ${step + 1}`,
            run: () => askAbout(step),
          },
  };
}
