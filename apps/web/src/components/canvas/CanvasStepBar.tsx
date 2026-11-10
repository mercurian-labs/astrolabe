import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, XIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import { Button } from "../ui/button";
import type { useCanvasWalk } from "./useCanvasWalk";

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
  walk,
}: {
  readonly walk: Pick<ReturnType<typeof useCanvasWalk>, "steps" | "step" | "go">;
}) {
  const { steps, step, go: onStep } = walk;
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
    <div className="@container flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border py-1.5 pr-1.5 pl-3">
      <p className="min-w-0 flex-1 text-sm @max-md:basis-full @max-md:pr-1.5" aria-live="polite">
        {current.frame.label === undefined ? null : (
          <span className="font-medium">{current.frame.label}. </span>
        )}
        {current.note}
      </p>
      <div className="flex shrink-0 items-center gap-0.5 @max-md:-ms-1.5 @max-md:me-auto">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={step === 0 ? "Show the whole board" : "Previous step"}
          onClick={() => onStep(step === 0 ? null : step - 1)}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
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
      </div>
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
