import { X } from "lucide-react";
import type { MouseEvent } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

// Astrolabe: what a pane's tabs and the chat tabs draw alike, as Chrome's tabs do.

/** A tab's title, fading out at its end rather than cut short with an ellipsis, as Chrome's do. */
export function TabTitle({ title }: { title: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)]">
            {title}
          </span>
        }
      />
      <TooltipPopup>{title}</TooltipPopup>
    </Tooltip>
  );
}

/** A tab's ✕, always shown at its end, as Chrome's is. */
export function TabCloseButton({
  label,
  onClick,
}: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={onClick}
    >
      <X className="size-3" />
    </button>
  );
}
