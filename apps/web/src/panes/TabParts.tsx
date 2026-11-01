import { X } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

// Astrolabe: what a pane's tabs and the chat tabs draw alike, as Chrome's tabs do.

/**
 * A tab's `onMouseDown` and `onMouseUp`, where middle-click closes it: cancelling the press keeps
 * the browser from starting its autoscroll, and cancelling the release keeps Chromium on Linux
 * from pasting the primary selection (as T3 Code's panel tabs do).
 */
export function preventTabMiddleButtonDefault(event: MouseEvent) {
  if (event.button === 1) event.preventDefault();
}

/**
 * A tab's title, fading out at its end rather than cut short with an ellipsis, as Chrome's do.
 * Hovering it shows `tooltip`, or the title itself.
 */
export function TabTitle({ title, tooltip }: { title: string; tooltip?: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-1.25rem),transparent)]">
            {title}
          </span>
        }
      />
      <TooltipPopup>{tooltip ?? title}</TooltipPopup>
    </Tooltip>
  );
}

// Module-level so React runs it on mount only; a fresh function would select again each render.
function focusAndSelect(input: HTMLInputElement | null) {
  input?.focus();
  input?.select();
}

/**
 * Edits a tab's title in its place. Enter or leaving the field keeps the name typed; Escape
 * keeps the old one.
 */
export function TabTitleInput({
  title,
  label,
  onDone,
}: {
  title: string;
  label: string;
  /** Called as the field is left: with the name typed, or null when the title stays as it was. */
  onDone: (next: string | null) => void;
}) {
  return (
    <input
      aria-label={label}
      className="min-w-0 flex-1 rounded-sm bg-background px-1 outline-none ring-1 ring-inset ring-ring"
      defaultValue={title}
      ref={focusAndSelect}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        const next = event.currentTarget.value;
        onDone(next === title ? null : next);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = title;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * A small button inside a tab, as its ✕ or a playing browser tab's speaker. It takes a tooltip
 * trigger's props, so it can be one's `render`.
 */
export function TabIconButton({
  label,
  ...props
}: { label: string } & Omit<ComponentProps<"button">, "className" | "type">) {
  return (
    <button
      {...props}
      type="button"
      aria-label={label}
      className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    />
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
    <TabIconButton data-tab-close label={label} onClick={onClick}>
      <X className="size-3" />
    </TabIconButton>
  );
}
