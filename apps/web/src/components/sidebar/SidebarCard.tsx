import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

/**
 * The sidebar's card: a header line (where it lives, and its time or status), its title, and a
 * footer line, in a fixed-height row. Thread rows and the Wikis sidebar's document and change
 * rows all draw through these parts, so the lists read as one.
 */

/**
 * The interactive surface every row shares; status lives in the row's content, not here. Focused
 * from the keyboard, a row wears the inputs' light ring (a thin edge and a soft band in the focus
 * color), which reads apart from the current row's fill.
 */
export const SIDEBAR_ROW_SURFACE_CLASS =
  "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none focus-visible:inset-ring focus-visible:inset-ring-ring focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/24";
export const SIDEBAR_ROW_ACTIVE_CLASS = "bg-sidebar-row-active text-sidebar-foreground";
export const SIDEBAR_ROW_SELECTED_CLASS = "bg-sidebar-row-selected text-sidebar-foreground";
export const SIDEBAR_ROW_IDLE_CLASS =
  "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover";

/** A card's outer box; it holds its height while scrolled out of view. */
export const SIDEBAR_CARD_ITEM_CLASS =
  // Matches the h-[4.875rem] content box; the py-0.5 padding is added on top.
  "py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_78px]";

/** The list item. */
export function SidebarCardItem({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("list-none", SIDEBAR_CARD_ITEM_CLASS, className)} {...props} />;
}

export function SidebarCardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative z-10 h-[4.875rem] px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarCardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex h-5 min-w-0 items-center gap-1.5", className)} {...props} />;
}

export function SidebarCardTitle({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-1 flex min-w-0", className)} {...props} />;
}

export function SidebarCardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs",
        className,
      )}
      {...props}
    />
  );
}
