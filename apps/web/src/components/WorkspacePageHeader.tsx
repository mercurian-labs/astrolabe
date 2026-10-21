import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";

/**
 * Shared workspace top-bar geometry. The height is `!important` so callers cannot
 * grow the bar and pull its content off the sidebar header's center line.
 *
 * Astrolabe: as the title bar it is drawn as the tab strips are, the strip's fill over a bottom
 * border, so it runs on from the sidebar's header as one band. `titlebar={false}` is for a header
 * under a tab strip, which is the title bar instead; it neither drags the window nor clears the
 * window's or a collapsed sidebar's controls.
 */
export function WorkspacePageHeader({
  electron = false,
  reserveNativeControls = electron,
  titlebar = true,
  className,
  ...props
}: ComponentPropsWithoutRef<"header"> & {
  readonly electron?: boolean;
  readonly reserveNativeControls?: boolean;
  readonly titlebar?: boolean;
}) {
  return (
    <header
      className={cn(
        "flex h-[var(--workspace-topbar-height)]! min-h-[var(--workspace-topbar-height)]! max-h-[var(--workspace-topbar-height)]! shrink-0 items-center gap-3 pl-(--workspace-gutter-start) pr-(--workspace-gutter-end) [[data-panel-animations=true]_&]:motion-safe:transition-[padding-left,padding-right] [[data-panel-animations=true]_&]:motion-safe:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:motion-safe:ease-out",
        titlebar && "border-b border-border bg-muted",
        titlebar && electron && "drag-region",
        titlebar && reserveNativeControls && "wco:pr-(--workspace-native-controls-inset)",
        titlebar && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        className,
      )}
      {...props}
    />
  );
}
