import type { CanvasStep } from "@mercurian/wiki/canvas";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MessageSquarePlusIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import type { KeyboardEvent } from "react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Arrow keys walk a board while focus is anywhere in it; Escape goes back to the whole board. */
export function onStepKey(
  event: KeyboardEvent,
  count: number,
  step: number | null,
  onStep: (step: number | null) => void,
) {
  if (count === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as Element;
  if (target.closest("input, textarea, [contenteditable='true']") !== null) return;
  const next =
    event.key === "ArrowRight"
      ? Math.min(count - 1, (step ?? -1) + 1)
      : event.key === "ArrowLeft"
        ? step === null || step === 0
          ? null
          : step - 1
        : event.key === "Escape" && step !== null
          ? null
          : undefined;
  if (next === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  onStep(next);
}

/** A board's walk: the whole board first, then each frame with its note. */
export function CanvasStepBar({
  steps,
  step,
  onStep,
  onAsk,
}: {
  readonly steps: ReadonlyArray<CanvasStep>;
  readonly step: number | null;
  readonly onStep: (step: number | null) => void;
  /** Puts this step in the composer, to ask about; left out where there's no composer. */
  readonly onAsk?: ((step: number) => void) | undefined;
}) {
  const current = step === null ? undefined : steps[step];
  if (steps.length === 0) return null;
  if (step === null || current === undefined) {
    return (
      <div className="flex min-h-10 items-center gap-2 border-t border-border py-1.5 pr-1.5 pl-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{steps.length} steps</p>
        <Button size="xs" variant="ghost" onClick={() => onStep(0)}>
          <PlayIcon />
          Walk through
        </Button>
      </div>
    );
  }
  // A narrow board puts the note on its own row, above the controls.
  return (
    <div className="@container flex min-h-10 flex-wrap items-center gap-1.5 border-t border-border px-1.5 py-1.5">
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={step === 0 ? "Show the whole board" : "Previous step"}
        onClick={() => onStep(step === 0 ? null : step - 1)}
      >
        <ChevronLeftIcon />
      </Button>
      <p
        className="min-w-0 flex-1 text-sm @max-md:order-first @max-md:basis-full @max-md:px-1.5"
        aria-live="polite"
      >
        {current.frame.label === undefined ? null : (
          <span className="font-medium">{current.frame.label}. </span>
        )}
        {current.note}
      </p>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums @max-md:ms-auto">
        {step + 1} / {steps.length}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Next step"
        disabled={step === steps.length - 1}
        onClick={() => onStep(step + 1)}
      >
        <ChevronRightIcon />
      </Button>
      {onAsk === undefined ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Ask about this step"
                onClick={() => onAsk(step)}
              />
            }
          >
            <MessageSquarePlusIcon />
          </TooltipTrigger>
          <TooltipPopup side="top">Ask about this step</TooltipPopup>
        </Tooltip>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Show the whole board"
        onClick={() => onStep(null)}
      >
        <XIcon />
      </Button>
    </div>
  );
}
