import { canvasCardName } from "@mercurian/wiki/canvas";
import type { CanvasView } from "@t3tools/client-runtime/canvasViews";
import { MessageSquarePlusIcon, PlayIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle } from "../ui/popover";
import type { useCanvasWalk } from "./useCanvasWalk";

/** A step's details, opened from its frame's number: what it says, what it shows, and where to go. */
export function CanvasFramePopover({
  view,
  walk,
  onCard,
}: {
  readonly view: CanvasView;
  readonly walk: ReturnType<typeof useCanvasWalk>;
  /** Brings one of the step's cards into view. */
  readonly onCard: (id: string) => void;
}) {
  const { frame, steps, stories, story } = walk;
  const shown = frame === null ? undefined : steps[frame.step];
  const index = frame?.step ?? 0;
  const cards = view.data.nodes.filter((node) => shown?.cards.has(node.id) === true);
  const storyTitle = stories.length > 1 ? stories[story]?.title : undefined;
  return (
    <Popover
      open={shown !== undefined}
      onOpenChange={(open, details) => {
        // A press on the number that opened it toggles it from there, not as a press outside.
        const target = details.event?.target;
        if (!open && target instanceof Node && frame?.chip.contains(target) === true) return;
        if (!open) walk.closeFrame();
      }}
    >
      <PopoverPopup anchor={frame?.chip} side="top" align="end" width="sm" padding="compact">
        {shown === undefined ? null : (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                {`Step ${index + 1} of ${steps.length}`}
                {storyTitle === undefined ? "" : ` · ${storyTitle}`}
              </p>
              {shown.label === undefined ? null : <PopoverTitle>{shown.label}</PopoverTitle>}
              <p className="text-pretty">{shown.note}</p>
            </div>
            {cards.length === 0 ? null : (
              <ul className="-mx-1 flex max-h-40 flex-col overflow-y-auto">
                {cards.map((card) => (
                  <li key={card.id}>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="w-full justify-start"
                      onClick={() => {
                        // A card hidden by another step's walk shows once its own step is walked.
                        if (walk.step !== null && walk.step !== index) walk.go(index);
                        else onCard(card.id);
                      }}
                    >
                      <span className="truncate">{canvasCardName({ ...card })}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5">
              {walk.step === index ? null : (
                <Button size="xs" onClick={() => walk.go(index)}>
                  <PlayIcon />
                  Walk from here
                </Button>
              )}
              {walk.askAbout === undefined ? null : (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    walk.askAbout?.(index);
                    walk.closeFrame();
                  }}
                >
                  <MessageSquarePlusIcon />
                  Ask about this step
                </Button>
              )}
            </div>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}
