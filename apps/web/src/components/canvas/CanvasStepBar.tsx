import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, XIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
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
  // A step's popover is portalled out of the board, though its keys still bubble through it.
  if (!event.currentTarget.contains(target)) return;
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

/** A board's stories: the whole board first, then each step of the picked one with its note. */
export function CanvasStepBar({ walk }: { readonly walk: ReturnType<typeof useCanvasWalk> }) {
  const { stories, story, pick, steps, step, go: onStep } = walk;
  const current = step === null ? undefined : steps[step];
  if (steps.length === 0) return null;
  if (step === null || current === undefined) {
    const count = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
    return (
      <div className="flex min-h-10 items-center gap-2 border-t border-border py-1.5 pr-1.5 pl-3">
        {stories.length > 1 ? (
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <Select
              value={String(story)}
              items={Object.fromEntries(stories.map((each, index) => [String(index), each.title]))}
              onValueChange={(value) => {
                if (typeof value === "string") pick(Number(value));
              }}
            >
              <SelectTrigger size="xs" variant="ghost" className="-ms-2 min-w-0" aria-label="Story">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {stories.map((each, index) => (
                  // oxlint-disable-next-line react/no-array-index-key -- a story is its place in the board's list; titles can repeat
                  <SelectItem key={String(index)} value={String(index)}>
                    {each.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
          </div>
        ) : (
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {stories[0] === undefined ? count : `${stories[0].title} · ${count}`}
          </p>
        )}
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
        {current.label === undefined ? null : (
          <span className="font-medium">{current.label}. </span>
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
