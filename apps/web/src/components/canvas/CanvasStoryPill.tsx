import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MaximizeIcon,
  MinimizeIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import { type KeyboardEvent, useRef, useSyncExternalStore } from "react";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import type { useCanvasWalk } from "./useCanvasWalk";

const FORWARD = new Set(["ArrowRight", "PageDown"]);
const BACK = new Set(["ArrowLeft", "PageUp"]);
/** Past this, a dot per step stops being something to aim at. */
const MOST_DOTS = 12;

/**
 * Arrow keys walk a board while focus is anywhere in it, as do a presentation clicker's Page Up and
 * Page Down; Escape goes back to the whole board.
 */
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
  const next = FORWARD.has(event.key)
    ? Math.min(count - 1, (step ?? -1) + 1)
    : BACK.has(event.key)
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

const onFullscreenChange = (done: () => void) => {
  document.addEventListener("fullscreenchange", done);
  return () => document.removeEventListener("fullscreenchange", done);
};

/**
 * A board's stories, floating over its foot: the story and Present at rest; while presenting, the
 * step's note above a pill that moves through the steps and can take the board full screen.
 */
export function CanvasStoryPill({ walk }: { readonly walk: ReturnType<typeof useCanvasWalk> }) {
  const { stories, story, pick, steps, step, go } = walk;
  const pill = useRef<HTMLDivElement>(null);
  const board = () => pill.current?.closest<HTMLElement>(".cv-board") ?? null;
  const fullscreen = useSyncExternalStore(
    onFullscreenChange,
    () => document.fullscreenElement !== null && document.fullscreenElement === board(),
  );
  if (steps.length === 0) return null;
  const current = step === null ? undefined : steps[step];
  const stop = () => {
    go(null);
    if (fullscreen) void document.exitFullscreen();
  };
  return (
    <>
      {current === undefined ? null : (
        <p
          className="max-w-[min(36rem,100%)] rounded-lg border border-border bg-popover px-3 py-2 text-sm text-pretty text-popover-foreground shadow-lg"
          aria-live="polite"
        >
          {current.label === undefined ? null : (
            <span className="font-medium">{current.label}. </span>
          )}
          {current.note}
        </p>
      )}
      <div
        ref={pill}
        tabIndex={-1}
        role="toolbar"
        aria-label="Story"
        className="flex max-w-full items-center gap-0.5 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
      >
        {step === null ? (
          <>
            {stories.length > 1 ? (
              <Select
                value={String(story)}
                items={Object.fromEntries(
                  stories.map((each, index) => [String(index), each.title]),
                )}
                onValueChange={(value) => {
                  if (typeof value === "string") pick(Number(value));
                }}
              >
                <SelectTrigger size="xs" variant="ghost" className="min-w-0" aria-label="Story">
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
            ) : (
              <span className="min-w-0 truncate px-2 text-xs">{stories[0]?.title}</span>
            )}
            <span className="shrink-0 px-1.5 text-xs text-muted-foreground">
              {`${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
            </span>
            <Button
              size="xs"
              className="ms-1 shrink-0"
              onClick={() => {
                // The pill stays as Present goes, so the arrow keys keep walking from here.
                pill.current?.focus();
                go(0);
              }}
            >
              <PlayIcon />
              Present
            </Button>
          </>
        ) : (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={step === 0 ? "Show the whole board" : "Previous step"}
              onClick={() => go(step === 0 ? null : step - 1)}
            >
              <ChevronLeftIcon />
            </Button>
            {steps.length > MOST_DOTS ? null : (
              <div className="flex items-center px-1">
                {steps.map((each, index) => (
                  <button
                    // oxlint-disable-next-line react/no-array-index-key -- a step is its place in the story; labels can repeat
                    key={index}
                    type="button"
                    aria-label={`Step ${index + 1}${each.label === undefined ? "" : `: ${each.label}`}`}
                    aria-current={index === step ? "step" : undefined}
                    className="group grid h-6 w-3 cursor-pointer place-items-center data-current:w-5"
                    data-current={index === step || undefined}
                    onClick={() => go(index)}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 transition-[width] group-hover:bg-muted-foreground group-data-current:w-3.5 group-data-current:bg-primary" />
                  </button>
                ))}
              </div>
            )}
            <span className="px-1 text-xs text-muted-foreground tabular-nums">
              {step + 1} / {steps.length}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Next step"
              disabled={step === steps.length - 1}
              onClick={() => go(step + 1)}
            >
              <ChevronRightIcon />
            </Button>
            <span className="mx-1 h-4 w-px bg-border" />
            {document.fullscreenEnabled ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={fullscreen ? "Leave full screen" : "Full screen"}
                onClick={() => {
                  if (fullscreen) void document.exitFullscreen();
                  else void board()?.requestFullscreen();
                }}
              >
                {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
              </Button>
            ) : null}
            <Button size="icon-xs" variant="ghost" aria-label="Stop presenting" onClick={stop}>
              <XIcon />
            </Button>
          </>
        )}
      </div>
    </>
  );
}
